import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
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
  type NovaFisica,
} from '../../test/db.js';
import { requisicaoComo } from '../../test/http.js';
import type { minhasFisicasSchema } from './schemas.js';

type MinhasFisicas = z.infer<typeof minhasFisicasSchema>;

describe('GET /fisicas/minhas', () => {
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

  function requisicao(opcoes: InjectOptions, usuario?: Usuario) {
    return requisicaoComo(app, opcoes, usuario);
  }

  function cenario(fisica: NovaFisica = {}) {
    return criarCenarioDeGrupos(app.prisma, fisica);
  }

  function minhas(usuario?: Usuario) {
    return requisicao({ method: 'GET', url: '/fisicas/minhas' }, usuario);
  }

  it('devolve edição nula e lista vazia quando não há edição ativa', async () => {
    const aluno = await criarAluno(app.prisma, '100');

    const resposta = await minhas(aluno);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ edicao: null, fisicas: [] });
  });

  it('lista as Físicas do aluno na edição ativa, com turma e grupo', async () => {
    const { edicao, f01, eu, alunoNaF01 } = await cenario({ minimoIntegrantes: 2 });
    const colega = await alunoNaF01('200', 'A', 'Colega');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [colega.id, eu.id],
    });
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02', multiturma: true });
    await inscrever(app.prisma, { alunoId: eu.id, fisicaId: f02.id, turmaId: f02.turmas.B! });

    const resposta = await minhas(eu);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<MinhasFisicas>()).toEqual({
      edicao: { semestre: '2026/1', dataLimite: edicao.dataLimite.toISOString() },
      fisicas: [
        {
          id: f01.id,
          codigo: 'F01',
          nome: 'Física F01',
          minimoIntegrantes: 2,
          maximoIntegrantes: 3,
          multiturma: false,
          turma: 'A',
          grupo: {
            id: grupo.id,
            numero: 1,
            fisicaId: f01.id,
            formado: true,
            integrantes: [
              { id: colega.id, nome: 'Colega', curso: 'GES', matricula: '200', turma: 'A' },
              { id: eu.id, nome: 'Eu Mesmo', curso: 'GES', matricula: '100', turma: 'A' },
            ],
          },
        },
        {
          id: f02.id,
          codigo: 'F02',
          nome: 'Física F02',
          minimoIntegrantes: 2,
          maximoIntegrantes: 4,
          multiturma: true,
          turma: 'B',
          grupo: null,
        },
      ],
    });
  });

  it('marca o grupo como não formado abaixo do mínimo', async () => {
    const { f01, eu } = await cenario({ minimoIntegrantes: 2 });
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [eu.id] });

    const resposta = await minhas(eu);

    expect(resposta.json<MinhasFisicas>().fisicas[0]?.grupo?.formado).toBe(false);
  });

  it('ignora as Físicas de edições inativas', async () => {
    const { eu } = await cenario();
    const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
    const fAntiga = await criarFisica(app.prisma, antiga.id);
    await inscrever(app.prisma, {
      alunoId: eu.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });

    const resposta = await minhas(eu);

    expect(resposta.json<MinhasFisicas>().fisicas.map((fisica) => fisica.codigo)).toEqual(['F01']);
  });

  it('devolve lista vazia para aluno sem inscrição na edição ativa', async () => {
    await cenario();
    const outro = await criarAluno(app.prisma, '999');

    const resposta = await minhas(outro);

    expect(resposta.json<MinhasFisicas>()).toMatchObject({ fisicas: [] });
  });

  it('responde 403 para admin e 401 sem token', async () => {
    const admin = await criarUsuario(app.prisma, {
      login: 'ADMIN',
      senha: 'x',
      papel: 'ADMIN',
    });

    expect((await minhas(admin)).statusCode).toBe(403);
    expect((await minhas()).statusCode).toBe(401);
  });
});
