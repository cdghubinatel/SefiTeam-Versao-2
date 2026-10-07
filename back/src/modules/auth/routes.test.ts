import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import { criarUsuario, limparBanco } from '../../test/db.js';
import { erroDa } from '../../test/http.js';
import type { loginRespostaSchema } from './schemas.js';
import { senhaDoAluno } from './service.js';

type LoginResposta = z.infer<typeof loginRespostaSchema>;

describe('rotas /auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    await limparBanco(app.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  function login(body: object) {
    return app.inject({ method: 'POST', url: '/auth/login', payload: body });
  }

  function criarAluno(email: string) {
    return criarUsuario(app.prisma, {
      email,
      senha: senhaDoAluno({ curso: 'GES', matricula: '589' }),
      curso: 'GES',
      matricula: '589',
    });
  }

  describe('POST /auth/login', () => {
    it('devolve token e usuário com credenciais válidas', async () => {
      const aluno = await criarAluno('maria@inatel.br');

      const resposta = await login({ email: 'maria@inatel.br', senha: 'GES589' });

      expect(resposta.statusCode).toBe(200);
      const corpo = resposta.json<LoginResposta>();
      expect(corpo.usuario).toEqual({
        id: aluno.id,
        email: 'maria@inatel.br',
        nome: aluno.nome,
        papel: 'ALUNO',
      });
      expect(app.jwt.verify(corpo.token)).toMatchObject({ sub: String(aluno.id), papel: 'ALUNO' });
    });

    it('aceita o e-mail com maiúsculas e espaços nas pontas', async () => {
      await criarAluno('maria@inatel.br');

      const resposta = await login({ email: '  Maria@Inatel.BR ', senha: 'GES589' });

      expect(resposta.statusCode).toBe(200);
    });

    it('aceita a senha do aluno em minúsculas', async () => {
      await criarAluno('maria@inatel.br');

      const resposta = await login({ email: 'maria@inatel.br', senha: 'ges589' });

      expect(resposta.statusCode).toBe(200);
    });

    it('diferencia maiúsculas na senha do admin', async () => {
      await criarUsuario(app.prisma, {
        email: 'admin@inatel.br',
        senha: 'Senha-Do-Admin-123',
        papel: 'ADMIN',
      });

      const exata = await login({ email: 'admin@inatel.br', senha: 'Senha-Do-Admin-123' });
      const minusculas = await login({ email: 'admin@inatel.br', senha: 'senha-do-admin-123' });

      expect(exata.statusCode).toBe(200);
      expect(minusculas.statusCode).toBe(401);
    });

    it('responde 401 genérico para senha errada e para e-mail inexistente', async () => {
      await criarAluno('maria@inatel.br');

      const senhaErrada = await login({ email: 'maria@inatel.br', senha: 'GES590' });
      const emailInexistente = await login({ email: 'ninguem@inatel.br', senha: 'GES589' });

      for (const resposta of [senhaErrada, emailInexistente]) {
        expect(resposta.statusCode).toBe(401);
        expect(resposta.json()).toEqual({
          erro: { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'E-mail ou senha inválidos.' },
        });
      }
    });

    it('responde 400 com os campos inválidos', async () => {
      const resposta = await login({ email: '' });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
      expect(erroDa(resposta).detalhes?.map((d) => d.campo)).toEqual(
        expect.arrayContaining(['email', 'senha']),
      );
    });

    it('responde 400 para e-mail em formato inválido', async () => {
      const resposta = await login({ email: 'GES589', senha: 'GES589' });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes?.map((d) => d.campo)).toEqual(['email']);
    });

    it('limita tentativas por e-mail (normalizado) e responde 429', async () => {
      for (let i = 0; i < 10; i++) {
        // Alterna maiúsculas: o limite conta o mesmo e-mail normalizado.
        await login({ email: i % 2 ? 'Alvo@inatel.br' : 'alvo@inatel.br', senha: 'errada' });
      }

      const bloqueado = await login({ email: 'alvo@inatel.br', senha: 'errada' });
      const outroEmail = await login({ email: 'outro@inatel.br', senha: 'errada' });

      expect(bloqueado.statusCode).toBe(429);
      expect(erroDa(bloqueado).codigo).toBe('MUITAS_TENTATIVAS');
      // Outro aluno no mesmo IP continua podendo tentar.
      expect(outroEmail.statusCode).toBe(401);
    });
  });

  describe('com token', () => {
    async function tokenDe(email: string) {
      await criarAluno(email);
      const resposta = await login({ email, senha: 'GES589' });
      return resposta.json<LoginResposta>().token;
    }

    it('GET /auth/me devolve o usuário logado', async () => {
      const token = await tokenDe('maria@inatel.br');

      const resposta = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ email: 'maria@inatel.br', papel: 'ALUNO' });
    });

    it('POST /auth/logout responde 204', async () => {
      const token = await tokenDe('maria@inatel.br');

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).toBe(204);
    });

    it('POST /auth/logout invalida os tokens de todos os dispositivos', async () => {
      await criarAluno('maria@inatel.br');
      const entrar = async () =>
        (await login({ email: 'maria@inatel.br', senha: 'GES589' })).json<LoginResposta>().token;
      const me = (token: string) =>
        app.inject({
          method: 'GET',
          url: '/auth/me',
          headers: { authorization: `Bearer ${token}` },
        });
      const celular = await entrar();
      const notebook = await entrar();

      await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${celular}` },
      });

      expect(erroDa(await me(celular)).codigo).toBe('TOKEN_INVALIDO');
      expect(erroDa(await me(notebook)).codigo).toBe('TOKEN_INVALIDO');
      // Um novo login volta a funcionar normalmente.
      expect((await me(await entrar())).statusCode).toBe(200);
    });

    it('POST /auth/logout aceita Content-Type JSON com corpo vazio (como o Swagger envia)', async () => {
      const token = await tokenDe('maria@inatel.br');

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });

      expect(resposta.statusCode).toBe(204);
    });
  });

  it('responde 400 REQUISICAO_INVALIDA para JSON malformado', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    });

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).codigo).toBe('REQUISICAO_INVALIDA');
  });
});
