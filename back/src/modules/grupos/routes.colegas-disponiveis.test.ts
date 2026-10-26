import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Usuario } from '../../generated/prisma/client.js';
import {
  criarAluno,
  criarCenarioDeGrupos,
  criarFisica,
  criarGrupo,
  inscrever,
  limparBanco,
  type NovaFisica,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { alunoResumoSchema } from './schemas.js';

type AlunoResumo = z.infer<typeof alunoResumoSchema>;

describe('GET /fisicas/:fisicaId/colegas-disponiveis', () => {
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

  function colegas(fisicaId: number, usuario: Usuario, busca?: string) {
    return requisicao(
      {
        method: 'GET',
        url: `/fisicas/${fisicaId}/colegas-disponiveis`,
        query: busca === undefined ? {} : { busca },
      },
      usuario,
    );
  }

  function nomes(resposta: Awaited<ReturnType<typeof colegas>>) {
    return resposta.json<AlunoResumo[]>().map((aluno) => aluno.nome);
  }

  it('lista colegas sem grupo da mesma turma, sem o próprio aluno, por nome', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const bruna = await alunoNaF01('202', 'A', 'Bruna');
    await alunoNaF01('201', 'A', 'Ana');
    const comGrupo = await alunoNaF01('203', 'A', 'Carla');
    await alunoNaF01('301', 'B', 'Daniel');
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [comGrupo.id] });

    const resposta = await colegas(f01.id, eu);

    expect(resposta.statusCode).toBe(200);
    expect(nomes(resposta)).toEqual(['Ana', 'Bruna']);
    expect(resposta.json<AlunoResumo[]>()[1]).toEqual({
      id: bruna.id,
      nome: 'Bruna',
      curso: 'GES',
      matricula: '202',
      turma: 'A',
    });
  });

  it('com multiturma, inclui colegas de outras turmas', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ multiturma: true });
    await alunoNaF01('201', 'A', 'Ana');
    await alunoNaF01('301', 'B', 'Daniel');

    expect(nomes(await colegas(f01.id, eu))).toEqual(['Ana', 'Daniel']);
  });

  it('não lista alunos inscritos só em outra Física', async () => {
    const { edicao, f01, eu } = await cenario();
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const deOutra = await criarAluno(app.prisma, '400', 'Outra Física');
    await inscrever(app.prisma, {
      alunoId: deOutra.id,
      fisicaId: f02.id,
      turmaId: f02.turmas.A!,
    });

    expect(nomes(await colegas(f01.id, eu))).toEqual([]);
  });

  it.each([
    ['parte do nome, sem diferenciar maiúsculas', 'vIcToR', ['João Victor Godoy da Silva']],
    ['sobrenome', 'silva', ['João Victor Godoy da Silva']],
    ['nome sem acento', 'joao', ['João Victor Godoy da Silva']],
    ['acento que o nome não tem', 'Âná', ['Ana Lúcia']],
    ['acento e maiúscula no nome', 'lucia', ['Ana Lúcia']],
    ['parte da matrícula', '58', ['João Victor Godoy da Silva']],
    ['espaços nas pontas', '  victor  ', ['João Victor Godoy da Silva']],
    ['vazia (lista todos)', '', ['Ana Lúcia', 'João Victor Godoy da Silva']],
    ['sem resultado', 'Zé', []],
    ['curinga % do LIKE (literal)', '%', []],
    ['curinga _ do LIKE (literal)', '_', []],
    ['barra invertida (literal)', '\\', []],
    ['aspas (sem quebrar o SQL)', "d'a", []],
  ])('busca por %s', async (_caso, busca, esperado) => {
    const { f01, eu, alunoNaF01 } = await cenario();
    await alunoNaF01('589', 'A', 'João Victor Godoy da Silva');
    await alunoNaF01('201', 'A', 'Ana Lúcia');

    expect(nomes(await colegas(f01.id, eu, busca))).toEqual(esperado);
  });

  it('também lista para quem já tem grupo (para adicionar colegas a ele)', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const colegaDoGrupo = await alunoNaF01('202', 'A', 'Bruna');
    await alunoNaF01('201', 'A', 'Ana');
    await alunoNaF01('301', 'B', 'Daniel');
    await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [eu.id, colegaDoGrupo.id],
    });

    expect(nomes(await colegas(f01.id, eu))).toEqual(['Ana']);
  });

  it('a busca não traz alunos de outra Física nem quem já tem grupo', async () => {
    const { edicao, f01, eu, alunoNaF01 } = await cenario();
    const comGrupo = await alunoNaF01('202', 'A', 'Silva Com Grupo');
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [comGrupo.id] });
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const deOutra = await criarAluno(app.prisma, '400', 'Silva Outra Física');
    await inscrever(app.prisma, {
      alunoId: deOutra.id,
      fisicaId: f02.id,
      turmaId: f02.turmas.A!,
    });
    await alunoNaF01('201', 'A', 'Silva Disponível');

    expect(nomes(await colegas(f01.id, eu, 'silva'))).toEqual(['Silva Disponível']);
  });

  it('responde 404 se o aluno não está inscrito na Física', async () => {
    const { f01 } = await cenario();
    const naoInscrito = await criarAluno(app.prisma, '999');

    const resposta = await colegas(f01.id, naoInscrito);

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta).codigo).toBe('NAO_ENCONTRADO');
  });

  it('responde 400 VALIDACAO com busca de mais de 100 caracteres', async () => {
    const { f01, eu } = await cenario();

    const resposta = await colegas(f01.id, eu, 'x'.repeat(101));

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo: 'busca' }));
  });
});
