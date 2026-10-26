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
  inscrever,
  limparBanco,
  type NovaFisica,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { grupoSchema } from './schemas.js';

type Grupo = z.infer<typeof grupoSchema>;

describe('GET /fisicas/:fisicaId/grupos', () => {
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

  function grupos(fisicaId: number | string, usuario?: Usuario) {
    return requisicao({ method: 'GET', url: `/fisicas/${fisicaId}/grupos` }, usuario);
  }

  it('lista só os grupos com vaga e da turma do aluno, por número', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const a1 = await alunoNaF01('201', 'A');
    const a2 = await alunoNaF01('202', 'A');
    const a3 = await alunoNaF01('203', 'A');
    const a4 = await alunoNaF01('204', 'A');
    const a5 = await alunoNaF01('205', 'A');
    const b1 = await alunoNaF01('301', 'B');
    const comVaga2 = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 2,
      alunoIds: [a1.id],
    });
    await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 3,
      alunoIds: [a2.id, a3.id, a4.id],
    });
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 4, alunoIds: [b1.id] });
    const comVaga1 = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [a5.id],
    });

    const resposta = await grupos(f01.id, eu);

    expect(resposta.statusCode).toBe(200);
    const lista = resposta.json<Grupo[]>();
    expect(lista.map((grupo) => grupo.id)).toEqual([comVaga1.id, comVaga2.id]);
    expect(lista[1]).toEqual({
      id: comVaga2.id,
      numero: 2,
      fisicaId: f01.id,
      formado: false,
      integrantes: [{ id: a1.id, nome: 'Aluno 201', curso: 'GES', matricula: '201', turma: 'A' }],
    });
  });

  it('com multiturma, inclui grupos de outras turmas', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ multiturma: true });
    const b1 = await alunoNaF01('301', 'B');
    const grupoB = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [b1.id],
    });

    const resposta = await grupos(f01.id, eu);

    expect(resposta.json<Grupo[]>().map((grupo) => grupo.id)).toEqual([grupoB.id]);
  });

  it('responde 409 JA_EM_GRUPO se o aluno já tem grupo nesta Física', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [eu.id] });
    const a1 = await alunoNaF01('201', 'A');
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 2, alunoIds: [a1.id] });

    const resposta = await grupos(f01.id, eu);

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({
      erro: { codigo: 'JA_EM_GRUPO', mensagem: 'Você já está em um grupo nesta Física.' },
    });
  });

  it('responde 404 para Física de edição inativa, sem inscrição ou inexistente', async () => {
    const { f01, eu } = await cenario();
    const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
    const fAntiga = await criarFisica(app.prisma, antiga.id);
    await inscrever(app.prisma, {
      alunoId: eu.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });
    const naoInscrito = await criarAluno(app.prisma, '999');

    for (const [usuario, fisicaId] of [
      [eu, fAntiga.id],
      [naoInscrito, f01.id],
      [eu, 9999],
    ] as const) {
      const resposta = await grupos(fisicaId, usuario);

      expect(resposta.statusCode).toBe(404);
      expect(resposta.json()).toEqual({
        erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Física não encontrada.' },
      });
    }
  });

  it.each(['abc', '0', '-1'])('responde 400 VALIDACAO para fisicaId "%s"', async (fisicaId) => {
    const { eu } = await cenario();

    const resposta = await grupos(fisicaId, eu);

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).codigo).toBe('VALIDACAO');
  });
});
