import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Usuario } from '../../generated/prisma/client.js';
import {
  criarAluno,
  criarEdicao,
  criarFisica,
  criarGrupo,
  criarUsuario,
  inscrever,
  limparBanco,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { alunosDaEdicaoSchema } from './schemas.js';

type AlunosDaEdicao = z.infer<typeof alunosDaEdicaoSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('GET /admin/alunos', () => {
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
    return requisicaoComo(app, { method: 'GET', url: `/admin/alunos${query}` }, usuario);
  }

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  /** Linhas como "Nome/F01/status", para comparar a lista de uma vez. */
  function linhas(corpo: AlunosDaEdicao) {
    return corpo.alunos.map((aluno) => `${aluno.nome}/${aluno.fisica.codigo}/${aluno.status}`);
  }

  /**
   * Edição ativa com a F02 (mínimo 2, turmas A e B) e a F01 (mínimo 2, multiturma).
   * F02: Bia e Caio no grupo 1 (formado); Davi sozinho no grupo 2 (não formado); João sem grupo.
   * F01: Bia sem grupo (ela aparece em duas Físicas).
   */
  async function cenario() {
    const edicao = await criarEdicao(app.prisma);
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const f01 = await criarFisica(app.prisma, edicao.id, { codigo: 'F01', multiturma: true });
    const bia = await criarAluno(app.prisma, '102', 'Bia Lopes');
    const caio = await criarAluno(app.prisma, '103', 'Caio Reis');
    const davi = await criarAluno(app.prisma, '104', 'Davi Melo');
    const joao = await criarAluno(app.prisma, '589', 'João Souza');
    for (const aluno of [bia, caio, davi]) {
      await inscrever(app.prisma, { alunoId: aluno.id, fisicaId: f02.id, turmaId: f02.turmas.A! });
    }
    await inscrever(app.prisma, { alunoId: joao.id, fisicaId: f02.id, turmaId: f02.turmas.B! });
    await inscrever(app.prisma, { alunoId: bia.id, fisicaId: f01.id, turmaId: f01.turmas.B! });
    const g1 = await criarGrupo(app.prisma, {
      fisicaId: f02.id,
      numero: 1,
      alunoIds: [bia.id, caio.id],
    });
    await criarGrupo(app.prisma, { fisicaId: f02.id, numero: 2, alunoIds: [davi.id] });
    return { edicao, f01, f02, bia, g1, admin: await criarAdmin() };
  }

  it('uma linha por aluno em cada Física, em ordem de nome e de Física, com turma, grupo e status', async () => {
    const { edicao, f01, f02, bia, g1, admin } = await cenario();

    const resposta = await listar('', admin);

    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json<AlunosDaEdicao>();
    expect(corpo.edicao).toEqual({
      id: edicao.id,
      semestre: '2026/1',
      dataLimite: edicao.dataLimite.toISOString(),
      ativa: true,
    });
    expect(corpo.fisicas).toEqual([
      { id: f01.id, codigo: 'F01', nome: 'Física F01', turmas: ['A', 'B'] },
      { id: f02.id, codigo: 'F02', nome: 'Física F02', turmas: ['A', 'B'] },
    ]);
    expect(linhas(corpo)).toEqual([
      'Bia Lopes/F01/sem-grupo',
      'Bia Lopes/F02/formado',
      'Caio Reis/F02/formado',
      'Davi Melo/F02/nao-formado',
      'João Souza/F02/sem-grupo',
    ]);
    expect(corpo.alunos[0]).toEqual({
      id: bia.id,
      nome: 'Bia Lopes',
      curso: 'GES',
      matricula: '102',
      fisica: { id: f01.id, codigo: 'F01' },
      turma: 'B',
      grupo: null,
      status: 'sem-grupo',
    });
    expect(corpo.alunos[1]).toMatchObject({ turma: 'A', grupo: { id: g1.id, numero: 1 } });
  });

  it.each([
    ['formado', ['Bia Lopes/F02/formado', 'Caio Reis/F02/formado']],
    ['nao-formado', ['Davi Melo/F02/nao-formado']],
    ['sem-grupo', ['Bia Lopes/F01/sem-grupo', 'João Souza/F02/sem-grupo']],
  ])('filtra por status=%s', async (status, esperado) => {
    const { admin } = await cenario();

    const corpo = (await listar(`?status=${status}`, admin)).json<AlunosDaEdicao>();

    expect(linhas(corpo)).toEqual(esperado);
  });

  it('filtra por Física, mas continua trazendo todas as Físicas', async () => {
    const { f01, admin } = await cenario();

    const corpo = (await listar(`?fisicaId=${f01.id}`, admin)).json<AlunosDaEdicao>();

    expect(linhas(corpo)).toEqual(['Bia Lopes/F01/sem-grupo']);
    expect(corpo.fisicas).toHaveLength(2);
  });

  it.each([
    ['nome sem acento', 'joao', ['João Souza/F02/sem-grupo']],
    ['nome em maiúsculas', 'BIA', ['Bia Lopes/F01/sem-grupo', 'Bia Lopes/F02/formado']],
    ['parte da matrícula', '58', ['João Souza/F02/sem-grupo']],
    ['% como texto, não curinga', '%', []],
    ['_ como texto, não curinga', '_', []],
    ['texto que ninguém tem', 'zzz', []],
  ])('busca por %s', async (_caso, busca, esperado) => {
    const { admin } = await cenario();

    const corpo = (
      await listar(`?busca=${encodeURIComponent(busca)}`, admin)
    ).json<AlunosDaEdicao>();

    expect(linhas(corpo)).toEqual(esperado);
  });

  it('busca vazia (só espaços) traz todos', async () => {
    const { admin } = await cenario();

    const corpo = (await listar('?busca=%20%20', admin)).json<AlunosDaEdicao>();

    expect(corpo.alunos).toHaveLength(5);
  });

  it('combina busca, Física e status', async () => {
    const { f02, admin } = await cenario();

    const corpo = (
      await listar(`?busca=bia&fisicaId=${f02.id}&status=formado`, admin)
    ).json<AlunosDaEdicao>();

    expect(linhas(corpo)).toEqual(['Bia Lopes/F02/formado']);
  });

  it('mostra só a última edição criada, mesmo que uma mais antiga esteja ativa', async () => {
    const antiga = await criarEdicao(app.prisma, {
      semestre: '2025/2',
      ativa: true,
      criadoEm: new Date(Date.now() - UM_ANO),
    });
    const fAntiga = await criarFisica(app.prisma, antiga.id, { codigo: 'F09' });
    const veterano = await criarAluno(app.prisma, '900', 'Veterano');
    await inscrever(app.prisma, {
      alunoId: veterano.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });
    const recente = await criarEdicao(app.prisma, { semestre: '2026/1', ativa: false });

    const corpo = (await listar('', await criarAdmin())).json<AlunosDaEdicao>();

    expect(corpo.edicao).toMatchObject({ id: recente.id, ativa: false });
    expect(corpo.fisicas).toEqual([]);
    expect(corpo.alunos).toEqual([]);
  });

  it('busca não acha aluno de outra edição', async () => {
    const { admin } = await cenario();
    const antiga = await criarEdicao(app.prisma, {
      semestre: '2025/2',
      ativa: false,
      criadoEm: new Date(Date.now() - UM_ANO),
    });
    const fAntiga = await criarFisica(app.prisma, antiga.id);
    const veterano = await criarAluno(app.prisma, '900', 'Veterano');
    await inscrever(app.prisma, {
      alunoId: veterano.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });

    const corpo = (await listar('?busca=veterano', admin)).json<AlunosDaEdicao>();

    expect(corpo.alunos).toEqual([]);
  });

  it('sem nenhuma edição, responde edicao null e listas vazias', async () => {
    const resposta = await listar('', await criarAdmin());

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<AlunosDaEdicao>()).toEqual({ edicao: null, fisicas: [], alunos: [] });
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
    ['?fisicaId=0', 'fisicaId'],
    [`?busca=${'a'.repeat(101)}`, 'busca'],
  ])('responde 400 VALIDACAO para %s', async (query, campo) => {
    const resposta = await listar(query, await criarAdmin());

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
  });

  it('responde 403 para aluno e 401 sem token', async () => {
    const aluno = await criarAluno(app.prisma, '100');

    expect((await listar('', aluno)).statusCode).toBe(403);
    expect((await listar('')).statusCode).toBe(401);
  });
});
