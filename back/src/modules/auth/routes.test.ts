import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import { criarAluno, criarUsuario, limparBanco } from '../../test/db.js';
import { erroDa } from '../../test/http.js';
import type { loginRespostaSchema } from './schemas.js';

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

  /** Aluno GES589, "Maria Clara Souza": login GES589, senha MARIA. */
  function criarMaria() {
    return criarAluno(app.prisma, '589', 'Maria Clara Souza');
  }

  describe('POST /auth/login', () => {
    it('devolve token e usuário com credenciais válidas', async () => {
      const aluno = await criarMaria();

      const resposta = await login({ login: 'GES589', senha: 'Maria' });

      expect(resposta.statusCode).toBe(200);
      const corpo = resposta.json<LoginResposta>();
      expect(corpo.usuario).toEqual({
        id: aluno.id,
        login: 'GES589',
        nome: 'Maria Clara Souza',
        papel: 'ALUNO',
      });
      expect(app.jwt.verify(corpo.token)).toMatchObject({ sub: String(aluno.id), papel: 'ALUNO' });
    });

    it('aceita o login com minúsculas e espaços', async () => {
      await criarMaria();

      const resposta = await login({ login: '  ges 589 ', senha: 'Maria' });

      expect(resposta.statusCode).toBe(200);
    });

    it('aceita a senha do aluno sem diferenciar maiúsculas nem acentos', async () => {
      await criarAluno(app.prisma, '590', 'João Pereira');

      for (const senha of ['joao', 'JOÃO', 'João']) {
        expect((await login({ login: 'GES590', senha })).statusCode).toBe(200);
      }
    });

    it('diferencia maiúsculas na senha do admin', async () => {
      await criarUsuario(app.prisma, {
        login: 'ADMIN',
        senha: 'Senha-Do-Admin-123',
        papel: 'ADMIN',
      });

      const exata = await login({ login: 'admin', senha: 'Senha-Do-Admin-123' });
      const minusculas = await login({ login: 'admin', senha: 'senha-do-admin-123' });

      expect(exata.statusCode).toBe(200);
      expect(minusculas.statusCode).toBe(401);
    });

    it('responde 401 genérico para senha errada e para login inexistente', async () => {
      await criarMaria();

      const senhaErrada = await login({ login: 'GES589', senha: 'Maria Clara' });
      const loginInexistente = await login({ login: 'GES999', senha: 'Maria' });

      for (const resposta of [senhaErrada, loginInexistente]) {
        expect(resposta.statusCode).toBe(401);
        expect(resposta.json()).toEqual({
          erro: { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Login ou senha inválidos.' },
        });
      }
    });

    it('responde 400 com os campos inválidos', async () => {
      const resposta = await login({ login: '' });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
      expect(erroDa(resposta).detalhes?.map((d) => d.campo)).toEqual(
        expect.arrayContaining(['login', 'senha']),
      );
    });

    it('responde 400 para login só com espaços', async () => {
      const resposta = await login({ login: '   ', senha: 'Maria' });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes?.map((d) => d.campo)).toEqual(['login']);
    });

    it('limita tentativas por login (normalizado) e responde 429', async () => {
      for (let i = 0; i < 10; i++) {
        // Alterna maiúsculas e espaços: o limite conta o mesmo login normalizado.
        await login({ login: i % 2 ? 'ges 100' : 'GES100', senha: 'errada' });
      }

      const bloqueado = await login({ login: 'GES100', senha: 'errada' });
      const outroLogin = await login({ login: 'GES101', senha: 'errada' });

      expect(bloqueado.statusCode).toBe(429);
      expect(erroDa(bloqueado).codigo).toBe('MUITAS_TENTATIVAS');
      // Outro aluno no mesmo IP continua podendo tentar.
      expect(outroLogin.statusCode).toBe(401);
    });
  });

  describe('com token', () => {
    async function tokenDaMaria() {
      await criarMaria();
      const resposta = await login({ login: 'GES589', senha: 'Maria' });
      return resposta.json<LoginResposta>().token;
    }

    it('GET /auth/me devolve o usuário logado', async () => {
      const token = await tokenDaMaria();

      const resposta = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ login: 'GES589', papel: 'ALUNO' });
    });

    it('POST /auth/logout responde 204', async () => {
      const token = await tokenDaMaria();

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).toBe(204);
    });

    it('POST /auth/logout invalida os tokens de todos os dispositivos', async () => {
      await criarMaria();
      const entrar = async () =>
        (await login({ login: 'GES589', senha: 'Maria' })).json<LoginResposta>().token;
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
      const token = await tokenDaMaria();

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
      payload: '{"login": ',
    });

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).codigo).toBe('REQUISICAO_INVALIDA');
  });
});
