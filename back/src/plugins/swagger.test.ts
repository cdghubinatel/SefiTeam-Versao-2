import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

/** Só o que os testes leem da especificação OpenAPI. */
type Especificacao = {
  security: unknown[];
  paths: Record<string, Record<string, { security?: unknown[] }>>;
};

// Nos testes o Swagger fica desligado (vitest.config.ts); aqui ele é ligado só neste arquivo.
vi.mock('../config/env.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config/env.js')>();
  return { ...original, env: { ...original.env, SWAGGER_ENABLED: true } };
});

describe('Swagger', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serve a interface em /docs sem token', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/docs' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['content-type']).toContain('text/html');
  });

  it('serve a especificação OpenAPI sem token, com todas as rotas', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(resposta.statusCode).toBe(200);
    const especificacao = resposta.json<Especificacao>();
    expect(Object.keys(especificacao.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/auth/login',
        '/auth/me',
        '/auth/logout',
        '/duvidas',
        '/duvidas/ordem',
        '/duvidas/{id}',
      ]),
    );
  });

  it('marca as rotas públicas sem exigência de token', async () => {
    const especificacao = (
      await app.inject({ method: 'GET', url: '/docs/json' })
    ).json<Especificacao>();

    expect(especificacao.paths['/auth/login']?.post?.security).toEqual([]);
    expect(especificacao.security).toEqual([{ bearerAuth: [] }]);
  });
});
