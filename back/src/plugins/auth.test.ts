import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Papel } from '../generated/prisma/client.js';
import { criarUsuario, limparBanco } from '../test/db.js';
import { erroDa } from '../test/http.js';

describe('hook de autenticação e autorização', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // Rotas só de teste, para exercitar o hook.
    app.get('/teste/autenticado', async (request) => ({ id: request.usuario.id }));
    app.get('/teste/admin', { config: { papeis: ['ADMIN'] } }, async () => ({ ok: true }));
    await app.ready();
  });

  beforeEach(async () => {
    await limparBanco(app.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function usuarioComToken(papel: Papel) {
    const usuario = await criarUsuario(app.prisma, {
      email: `${papel.toLowerCase()}@teste.local`,
      senha: 'x',
      papel,
    });
    const token = app.jwt.sign({ sub: String(usuario.id), papel, versao: usuario.tokenVersao });
    return { usuario, token };
  }

  function get(url: string, token?: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it('libera rota pública sem token', async () => {
    expect((await get('/health')).statusCode).toBe(200);
  });

  it('responde 401 TOKEN_AUSENTE sem header Authorization', async () => {
    const resposta = await get('/teste/autenticado');

    expect(resposta.statusCode).toBe(401);
    expect(erroDa(resposta).codigo).toBe('TOKEN_AUSENTE');
  });

  it('responde 401 TOKEN_AUSENTE quando o header não é Bearer', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/teste/autenticado',
      headers: { authorization: 'Basic abc' },
    });

    expect(erroDa(resposta).codigo).toBe('TOKEN_AUSENTE');
  });

  it('responde 401 TOKEN_INVALIDO para token adulterado', async () => {
    const { token } = await usuarioComToken('ALUNO');

    const resposta = await get('/teste/autenticado', `${token}x`);

    expect(resposta.statusCode).toBe(401);
    expect(erroDa(resposta).codigo).toBe('TOKEN_INVALIDO');
  });

  it('responde 401 TOKEN_INVALIDO para token expirado', async () => {
    const usuario = await criarUsuario(app.prisma, { email: 'expirado@teste.local', senha: 'x' });
    const duasHorasAtras = Date.now() - 2 * 60 * 60 * 1000;
    const token = app.jwt.sign(
      { sub: String(usuario.id), papel: 'ALUNO', versao: usuario.tokenVersao },
      { expiresIn: '1h', clockTimestamp: duasHorasAtras },
    );

    const resposta = await get('/teste/autenticado', token);

    expect(resposta.statusCode).toBe(401);
    expect(erroDa(resposta).codigo).toBe('TOKEN_INVALIDO');
  });

  it('responde 401 TOKEN_INVALIDO quando o usuário não existe mais', async () => {
    const { usuario, token } = await usuarioComToken('ALUNO');
    await app.prisma.usuario.delete({ where: { id: usuario.id } });

    const resposta = await get('/teste/autenticado', token);

    expect(resposta.statusCode).toBe(401);
    expect(erroDa(resposta).codigo).toBe('TOKEN_INVALIDO');
  });

  it('responde 401 TOKEN_INVALIDO quando o token foi revogado (token_versao mudou)', async () => {
    const { usuario, token } = await usuarioComToken('ALUNO');
    await app.prisma.usuario.update({
      where: { id: usuario.id },
      data: { tokenVersao: { increment: 1 } },
    });

    const resposta = await get('/teste/autenticado', token);

    expect(resposta.statusCode).toBe(401);
    expect(erroDa(resposta).codigo).toBe('TOKEN_INVALIDO');
  });

  it('preenche request.usuario com token válido', async () => {
    const { usuario, token } = await usuarioComToken('ALUNO');

    const resposta = await get('/teste/autenticado', token);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ id: usuario.id });
  });

  it('responde 403 SEM_PERMISSAO para aluno em rota de admin', async () => {
    const { token } = await usuarioComToken('ALUNO');

    const resposta = await get('/teste/admin', token);

    expect(resposta.statusCode).toBe(403);
    expect(erroDa(resposta).codigo).toBe('SEM_PERMISSAO');
  });

  it('libera admin em rota de admin', async () => {
    const { token } = await usuarioComToken('ADMIN');

    expect((await get('/teste/admin', token)).statusCode).toBe(200);
  });

  it('usa o papel atual do banco, não o do token', async () => {
    const usuario = await criarUsuario(app.prisma, {
      email: 'rebaixado@teste.local',
      senha: 'x',
      papel: 'ALUNO',
    });
    const tokenDizendoAdmin = app.jwt.sign({
      sub: String(usuario.id),
      papel: 'ADMIN',
      versao: usuario.tokenVersao,
    });

    const resposta = await get('/teste/admin', tokenDizendoAdmin);

    expect(resposta.statusCode).toBe(403);
  });

  it('responde 404 NAO_ENCONTRADO para rota inexistente', async () => {
    const resposta = await get('/nao-existe');

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta).codigo).toBe('NAO_ENCONTRADO');
  });
});
