import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Usuario } from '../../generated/prisma/client.js';
import {
  criarAluno,
  criarCenarioDeGrupos,
  criarEdicao,
  criarFisica,
  criarGrupo,
  criarUsuario,
  inscrever,
  limparBanco,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { gruposDaEdicaoSchema } from './schemas.js';

type GruposDaEdicao = z.infer<typeof gruposDaEdicaoSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('GET /admin/grupos', () => {
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

  function listar(query: string, usuario?: Usuario) {
    return requisicaoComo(app, { method: 'GET', url: `/admin/grupos${query}` }, usuario);
  }

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  /**
   * Edição ativa com a F01 (mínimo 2) e a F02 (multiturma). Na F01: grupo 2 formado (eu + Ana)
   * e grupo 1 incompleto (Bia). Na F02: grupo 1 formado (Caio + Daniel).
   */
  async function cenario() {
    const base = await criarCenarioDeGrupos(app.prisma, { minimoIntegrantes: 2 });
    const ana = await base.alunoNaF01('201', 'A', 'Ana');
    const bia = await base.alunoNaF01('202', 'A', 'Bia');
    const g2 = await criarGrupo(app.prisma, {
      fisicaId: base.f01.id,
      numero: 2,
      alunoIds: [base.eu.id, ana.id],
    });
    const g1 = await criarGrupo(app.prisma, {
      fisicaId: base.f01.id,
      numero: 1,
      alunoIds: [bia.id],
    });

    const f02 = await criarFisica(app.prisma, base.edicao.id, {
      codigo: 'F02',
      multiturma: true,
      turmas: ['C', 'A'],
    });
    const caio = await criarAluno(app.prisma, '301', 'Caio');
    const daniel = await criarAluno(app.prisma, '302', 'Daniel');
    await inscrever(app.prisma, { alunoId: caio.id, fisicaId: f02.id, turmaId: f02.turmas.A! });
    await inscrever(app.prisma, { alunoId: daniel.id, fisicaId: f02.id, turmaId: f02.turmas.C! });
    const gF02 = await criarGrupo(app.prisma, {
      fisicaId: f02.id,
      numero: 1,
      alunoIds: [caio.id, daniel.id],
    });

    return { ...base, f02, g1, g2, gF02, admin: await criarAdmin() };
  }

  it('lista a edição, todas as Físicas (com turmas) e os grupos em ordem de Física e número', async () => {
    const { edicao, f01, f02, g1, g2, gF02, admin } = await cenario();

    const resposta = await listar('', admin);

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json<GruposDaEdicao>();
    expect(corpo.edicao).toEqual({
      id: edicao.id,
      semestre: '2026/1',
      dataLimite: edicao.dataLimite.toISOString(),
      ativa: true,
    });
    expect(corpo.fisicas).toEqual([
      {
        id: f01.id,
        codigo: 'F01',
        nome: 'Física F01',
        quantidadeGrupos: 5,
        minimoIntegrantes: 2,
        maximoIntegrantes: 3,
        multiturma: false,
        turmas: ['A', 'B'],
      },
      expect.objectContaining({ id: f02.id, codigo: 'F02', multiturma: true, turmas: ['A', 'C'] }),
    ]);
    expect(corpo.grupos.map((grupo) => [grupo.id, grupo.numero, grupo.formado])).toEqual([
      [g1.id, 1, false],
      [g2.id, 2, true],
      [gF02.id, 1, true],
    ]);
    expect(corpo.grupos[1]?.integrantes.map((integrante) => integrante.nome)).toEqual([
      'Eu Mesmo',
      'Ana',
    ]);
  });

  it('filtra por Física, mas continua trazendo todas as Físicas', async () => {
    const { f02, gF02, admin } = await cenario();

    const corpo = (await listar(`?fisicaId=${f02.id}`, admin)).json<GruposDaEdicao>();

    expect(corpo.grupos.map((grupo) => grupo.id)).toEqual([gF02.id]);
    expect(corpo.fisicas).toHaveLength(2);
  });

  it.each([
    ['formado', ['g2', 'gF02']],
    ['nao-formado', ['g1']],
  ] as const)('filtra por status=%s', async (status, esperados) => {
    const dados = await cenario();

    const corpo = (await listar(`?status=${status}`, dados.admin)).json<GruposDaEdicao>();

    expect(corpo.grupos.map((grupo) => grupo.id)).toEqual(esperados.map((nome) => dados[nome].id));
  });

  it('combina os filtros de Física e status', async () => {
    const { f01, g1, admin } = await cenario();

    const corpo = (
      await listar(`?fisicaId=${f01.id}&status=nao-formado`, admin)
    ).json<GruposDaEdicao>();

    expect(corpo.grupos.map((grupo) => grupo.id)).toEqual([g1.id]);
  });

  it('com edicaoId, mostra uma edição inativa (histórico)', async () => {
    const { admin } = await cenario();
    const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
    const fAntiga = await criarFisica(app.prisma, antiga.id, { codigo: 'F09' });
    const aluno = await criarAluno(app.prisma, '900');
    await inscrever(app.prisma, {
      alunoId: aluno.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });
    const grupoAntigo = await criarGrupo(app.prisma, {
      fisicaId: fAntiga.id,
      numero: 1,
      alunoIds: [aluno.id],
    });

    const corpo = (await listar(`?edicaoId=${antiga.id}`, admin)).json<GruposDaEdicao>();

    expect(corpo.edicao).toMatchObject({ id: antiga.id, semestre: '2025/2', ativa: false });
    expect(corpo.fisicas.map((fisica) => fisica.codigo)).toEqual(['F09']);
    expect(corpo.grupos.map((grupo) => grupo.id)).toEqual([grupoAntigo.id]);
  });

  describe('sem edicaoId, a última edição criada', () => {
    it('mesmo finalizada (inativa e depois do prazo)', async () => {
      const finalizada = await criarEdicao(app.prisma, {
        semestre: '2026/1',
        ativa: false,
        dataLimite: new Date(Date.now() - 1000),
      });
      await criarEdicao(app.prisma, {
        semestre: '2025/2',
        ativa: false,
        criadoEm: new Date(Date.now() - UM_ANO),
      });

      const corpo = (await listar('', await criarAdmin())).json<GruposDaEdicao>();

      expect(corpo.edicao).toMatchObject({ id: finalizada.id, semestre: '2026/1', ativa: false });
    });

    it('a mais recente, mesmo que uma mais antiga esteja ativa', async () => {
      await criarEdicao(app.prisma, {
        semestre: '2025/2',
        ativa: true,
        criadoEm: new Date(Date.now() - UM_ANO),
      });
      const recente = await criarEdicao(app.prisma, { semestre: '2026/1', ativa: false });

      const corpo = (await listar('', await criarAdmin())).json<GruposDaEdicao>();

      expect(corpo.edicao?.id).toBe(recente.id);
    });

    it('sem nenhuma edição, responde edicao null e listas vazias', async () => {
      const resposta = await listar('', await criarAdmin());

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<GruposDaEdicao>()).toEqual({ edicao: null, fisicas: [], grupos: [] });
    });
  });

  it('responde 404 para edição inexistente', async () => {
    const resposta = await listar('?edicaoId=99999', await criarAdmin());

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta)).toEqual({
      codigo: 'NAO_ENCONTRADO',
      mensagem: 'Edição não encontrada.',
    });
  });

  it('responde 404 para Física de outra edição', async () => {
    const { admin } = await cenario();
    const antiga = await criarEdicao(app.prisma, {
      semestre: '2025/2',
      ativa: false,
      criadoEm: new Date(Date.now() - UM_ANO),
    });
    const fAntiga = await criarFisica(app.prisma, antiga.id);

    const resposta = await listar(`?fisicaId=${fAntiga.id}`, admin);

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta)).toEqual({
      codigo: 'NAO_ENCONTRADO',
      mensagem: 'Física não encontrada.',
    });
  });

  it.each([
    ['?status=qualquer', 'status'],
    ['?fisicaId=abc', 'fisicaId'],
    ['?edicaoId=0', 'edicaoId'],
  ])('responde 400 VALIDACAO para %s', async (query, campo) => {
    const resposta = await listar(query, await criarAdmin());

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
  });

  it('responde 403 para aluno e 401 sem token', async () => {
    const { eu } = await cenario();

    expect((await listar('', eu)).statusCode).toBe(403);
    expect((await listar('')).statusCode).toBe(401);
  });
});
