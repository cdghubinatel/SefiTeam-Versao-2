import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Papel } from '../../generated/prisma/client.js';
import { criarUsuario, limparBanco } from '../../test/db.js';
import { erroDa } from '../../test/http.js';
import type { duvidaSchema } from './schemas.js';

type Duvida = z.infer<typeof duvidaSchema>;

describe('rotas /duvidas', () => {
  let app: FastifyInstance;
  let tokenAdmin: string;
  let tokenAluno: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    await limparBanco(app.prisma);
    tokenAdmin = await tokenDe('ADMIN');
    tokenAluno = await tokenDe('ALUNO');
  });

  afterAll(async () => {
    await app.close();
  });

  async function tokenDe(papel: Papel) {
    const usuario = await criarUsuario(app.prisma, {
      email: `${papel.toLowerCase()}@teste.local`,
      senha: 'x',
      papel,
    });
    return app.jwt.sign({ sub: String(usuario.id), papel, versao: usuario.tokenVersao });
  }

  function requisicao(opcoes: InjectOptions, token?: string) {
    return app.inject({
      ...opcoes,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  function cadastrar(pergunta: string, resposta: string, ordem: number) {
    return app.prisma.duvidaFrequente.create({ data: { pergunta, resposta, ordem } });
  }

  async function idsNaOrdem() {
    const resposta = await requisicao({ method: 'GET', url: '/duvidas' }, tokenAluno);
    return resposta.json<Duvida[]>().map((duvida) => duvida.id);
  }

  describe('GET /duvidas', () => {
    it('lista para qualquer usuário logado, por ordem e desempatando pelo id', async () => {
      const c = await cadastrar('C?', 'c', 2);
      const a = await cadastrar('A?', 'a', 1);
      const b = await cadastrar('B?', 'b', 2);

      const resposta = await requisicao({ method: 'GET', url: '/duvidas' }, tokenAluno);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([
        { id: a.id, pergunta: 'A?', resposta: 'a', ordem: 1 },
        { id: c.id, pergunta: 'C?', resposta: 'c', ordem: 2 },
        { id: b.id, pergunta: 'B?', resposta: 'b', ordem: 2 },
      ]);
    });

    it('devolve lista vazia quando não há dúvidas', async () => {
      const resposta = await requisicao({ method: 'GET', url: '/duvidas' }, tokenAdmin);

      expect(resposta.json()).toEqual([]);
    });

    it('responde 401 sem token', async () => {
      const resposta = await requisicao({ method: 'GET', url: '/duvidas' });

      expect(resposta.statusCode).toBe(401);
    });
  });

  describe('POST /duvidas', () => {
    function criar(payload: object, token = tokenAdmin) {
      return requisicao({ method: 'POST', url: '/duvidas', payload }, token);
    }

    it('cadastra no fim da lista, removendo espaços das pontas e mantendo quebras de linha', async () => {
      await cadastrar('Antiga?', 'r', 7);

      const resposta = await criar({ pergunta: '  Nova?  ', resposta: 'Linha 1\nLinha 2\n' });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json()).toMatchObject({
        pergunta: 'Nova?',
        resposta: 'Linha 1\nLinha 2',
        ordem: 8,
      });
    });

    it('responde 403 para aluno', async () => {
      const resposta = await criar({ pergunta: 'P?', resposta: 'R' }, tokenAluno);

      expect(resposta.statusCode).toBe(403);
      expect(erroDa(resposta).codigo).toBe('SEM_PERMISSAO');
    });

    it.each([
      ['pergunta vazia', { pergunta: '   ', resposta: 'R' }, 'pergunta'],
      ['pergunta longa demais', { pergunta: 'x'.repeat(301), resposta: 'R' }, 'pergunta'],
      ['resposta longa demais', { pergunta: 'P?', resposta: 'x'.repeat(5001) }, 'resposta'],
      ['resposta ausente', { pergunta: 'P?' }, 'resposta'],
    ])('responde 400 VALIDACAO com %s', async (_caso, payload, campo) => {
      const resposta = await criar(payload);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
      expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
    });

    it('aceita os tamanhos máximos', async () => {
      const resposta = await criar({ pergunta: 'x'.repeat(300), resposta: 'x'.repeat(5000) });

      expect(resposta.statusCode).toBe(201);
    });
  });

  describe('PUT /duvidas/:id', () => {
    function editar(id: number | string, payload: object, token = tokenAdmin) {
      return requisicao({ method: 'PUT', url: `/duvidas/${id}`, payload }, token);
    }

    it('edita pergunta e resposta, mantendo a ordem', async () => {
      const duvida = await cadastrar('Antiga?', 'antiga', 3);

      const resposta = await editar(duvida.id, { pergunta: 'Nova?', resposta: 'nova' });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        id: duvida.id,
        pergunta: 'Nova?',
        resposta: 'nova',
        ordem: 3,
      });
    });

    it('responde 404 NAO_ENCONTRADO para dúvida inexistente', async () => {
      const resposta = await editar(999, { pergunta: 'P?', resposta: 'R' });

      expect(resposta.statusCode).toBe(404);
      expect(resposta.json()).toEqual({
        erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Dúvida não encontrada.' },
      });
    });

    it.each(['abc', '0', '-1', '1.5'])('responde 400 VALIDACAO para id "%s"', async (id) => {
      const resposta = await editar(id, { pergunta: 'P?', resposta: 'R' });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
    });

    it('responde 403 para aluno', async () => {
      const duvida = await cadastrar('P?', 'R', 1);

      const resposta = await editar(duvida.id, { pergunta: 'X?', resposta: 'X' }, tokenAluno);

      expect(resposta.statusCode).toBe(403);
    });
  });

  describe('DELETE /duvidas/:id', () => {
    function apagar(id: number, token = tokenAdmin) {
      return requisicao({ method: 'DELETE', url: `/duvidas/${id}` }, token);
    }

    it('apaga a dúvida', async () => {
      const fica = await cadastrar('Fica?', 'r', 1);
      const sai = await cadastrar('Sai?', 'r', 2);

      const resposta = await apagar(sai.id);

      expect(resposta.statusCode).toBe(204);
      expect(resposta.body).toBe('');
      expect(await idsNaOrdem()).toEqual([fica.id]);
    });

    it('responde 404 NAO_ENCONTRADO para dúvida inexistente', async () => {
      const resposta = await apagar(999);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta).codigo).toBe('NAO_ENCONTRADO');
    });

    it('responde 403 para aluno', async () => {
      const duvida = await cadastrar('P?', 'R', 1);

      const resposta = await apagar(duvida.id, tokenAluno);

      expect(resposta.statusCode).toBe(403);
      expect(await idsNaOrdem()).toEqual([duvida.id]);
    });
  });

  describe('PUT /duvidas/ordem', () => {
    function reordenar(payload: object, token = tokenAdmin) {
      return requisicao({ method: 'PUT', url: '/duvidas/ordem', payload }, token);
    }

    async function tresDuvidas() {
      const a = await cadastrar('A?', 'a', 1);
      const b = await cadastrar('B?', 'b', 2);
      const c = await cadastrar('C?', 'c', 3);
      return [a.id, b.id, c.id] as const;
    }

    it('grava a nova ordem e devolve a lista reordenada', async () => {
      const [a, b, c] = await tresDuvidas();

      const resposta = await reordenar({ ids: [c, a, b] });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([
        { id: c, pergunta: 'C?', resposta: 'c', ordem: 1 },
        { id: a, pergunta: 'A?', resposta: 'a', ordem: 2 },
        { id: b, pergunta: 'B?', resposta: 'b', ordem: 3 },
      ]);
      expect(await idsNaOrdem()).toEqual([c, a, b]);
    });

    it('aceita lista vazia quando não há dúvidas', async () => {
      const resposta = await reordenar({ ids: [] });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([]);
    });

    it('novas dúvidas entram depois da ordem gravada', async () => {
      const [a, b, c] = await tresDuvidas();
      await reordenar({ ids: [c, b, a] });

      const nova = await requisicao(
        { method: 'POST', url: '/duvidas', payload: { pergunta: 'D?', resposta: 'd' } },
        tokenAdmin,
      );

      expect(await idsNaOrdem()).toEqual([c, b, a, nova.json<Duvida>().id]);
    });

    it.each([
      ['falta uma dúvida', (ids: readonly number[]) => ids.slice(0, 2)],
      ['sobra um id inexistente', (ids: readonly number[]) => [...ids, 999]],
    ])('responde 409 ORDEM_DESATUALIZADA quando %s, sem alterar nada', async (_caso, montar) => {
      const ids = await tresDuvidas();

      const resposta = await reordenar({ ids: montar([...ids].reverse()) });

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta).codigo).toBe('ORDEM_DESATUALIZADA');
      expect(await idsNaOrdem()).toEqual(ids);
    });

    it('responde 400 VALIDACAO com mais de 100 ids', async () => {
      const ids = Array.from({ length: 101 }, (_, indice) => indice + 1);

      const resposta = await reordenar({ ids });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
    });

    it('responde 400 VALIDACAO com ids repetidos', async () => {
      const [a, b] = await tresDuvidas();

      const resposta = await reordenar({ ids: [a, b, b] });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
    });

    it('responde 403 para aluno', async () => {
      const [a, b, c] = await tresDuvidas();

      const resposta = await reordenar({ ids: [c, b, a] }, tokenAluno);

      expect(resposta.statusCode).toBe(403);
      expect(await idsNaOrdem()).toEqual([a, b, c]);
    });
  });
});
