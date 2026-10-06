import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

describe('app', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // Rota só de teste, para exercitar o caminho do erro inesperado.
    app.get('/teste/erro', { config: { publica: true } }, async () => {
      throw new Error('detalhe interno: senha do banco é xyz');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responde 200 com status ok', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: 'ok' });
  });

  it('responde 500 ERRO_INTERNO genérico, sem vazar detalhes do erro', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/teste/erro' });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toEqual({
      erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' },
    });
    expect(resposta.body).not.toContain('xyz');
    expect(resposta.body).not.toContain('stack');
  });
});
