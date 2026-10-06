import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import { criarUsuario, limparBanco } from '../../test/db.js';
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

  describe('POST /auth/login', () => {
    it('devolve token e usuário com credenciais válidas', async () => {
      const aluno = await criarUsuario(app.prisma, { login: 'GES589', senha: 'GES589-senha' });

      const resposta = await login({ login: 'GES589', senha: 'GES589-senha' });

      expect(resposta.statusCode).toBe(200);
      const corpo = resposta.json<LoginResposta>();
      expect(corpo.usuario).toEqual({
        id: aluno.id,
        login: 'GES589',
        nome: aluno.nome,
        papel: 'ALUNO',
      });
      expect(app.jwt.verify(corpo.token)).toMatchObject({ sub: String(aluno.id), papel: 'ALUNO' });
    });

    it('aceita o login em minúsculas', async () => {
      await criarUsuario(app.prisma, { login: 'GES589', senha: 'GES589-senha' });

      const resposta = await login({ login: 'ges589', senha: 'GES589-senha' });

      expect(resposta.statusCode).toBe(200);
    });

    it('responde 401 genérico para senha errada e para login inexistente', async () => {
      await criarUsuario(app.prisma, { login: 'GES589', senha: 'GES589-senha' });

      const senhaErrada = await login({ login: 'GES589', senha: 'errada' });
      const loginInexistente = await login({ login: 'NAOEXISTE', senha: 'errada' });

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

    it('limita tentativas por login e responde 429', async () => {
      for (let i = 0; i < 10; i++) {
        await login({ login: 'ALVO1', senha: 'errada' });
      }

      const bloqueado = await login({ login: 'ALVO1', senha: 'errada' });
      const outroLogin = await login({ login: 'OUTRO1', senha: 'errada' });

      expect(bloqueado.statusCode).toBe(429);
      expect(erroDa(bloqueado).codigo).toBe('MUITAS_TENTATIVAS');
      // Outro aluno no mesmo IP continua podendo tentar.
      expect(outroLogin.statusCode).toBe(401);
    });
  });

  describe('com token', () => {
    async function tokenDe(loginUsuario: string) {
      await criarUsuario(app.prisma, { login: loginUsuario, senha: 'senha-teste' });
      const resposta = await login({ login: loginUsuario, senha: 'senha-teste' });
      return resposta.json<LoginResposta>().token;
    }

    it('GET /auth/me devolve o usuário logado', async () => {
      const token = await tokenDe('GES100');

      const resposta = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ login: 'GES100', papel: 'ALUNO' });
    });

    it('POST /auth/logout responde 204', async () => {
      const token = await tokenDe('GES101');

      const resposta = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(resposta.statusCode).toBe(204);
    });

    it('POST /auth/logout invalida os tokens de todos os dispositivos', async () => {
      await criarUsuario(app.prisma, { login: 'GES103', senha: 'senha-teste' });
      const entrar = async () =>
        (await login({ login: 'GES103', senha: 'senha-teste' })).json<LoginResposta>().token;
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
      const token = await tokenDe('GES102');

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
