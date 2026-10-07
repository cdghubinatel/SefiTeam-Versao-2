import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
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
import { erroDa } from '../../test/http.js';
import type { alunoResumoSchema, grupoSchema, minhasFisicasSchema } from './schemas.js';

type Grupo = z.infer<typeof grupoSchema>;
type AlunoResumo = z.infer<typeof alunoResumoSchema>;
type MinhasFisicas = z.infer<typeof minhasFisicasSchema>;

describe('rotas de grupos', () => {
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

  function tokenDe(usuario: Usuario) {
    return app.jwt.sign({
      sub: String(usuario.id),
      papel: usuario.papel,
      versao: usuario.tokenVersao,
    });
  }

  function requisicao(opcoes: InjectOptions, usuario?: Usuario) {
    return app.inject({
      ...opcoes,
      headers: usuario ? { authorization: `Bearer ${tokenDe(usuario)}` } : {},
    });
  }

  /** Edição ativa com a F01 (turmas A e B, sem multiturma, máximo 3) e o aluno "eu" na turma A. */
  async function cenario(fisica: Parameters<typeof criarFisica>[2] = {}) {
    const edicao = await criarEdicao(app.prisma);
    const f01 = await criarFisica(app.prisma, edicao.id, { maximoIntegrantes: 3, ...fisica });
    const eu = await criarAluno(app.prisma, '100', 'Eu Mesmo');
    await inscrever(app.prisma, { alunoId: eu.id, fisicaId: f01.id, turmaId: f01.turmas.A! });

    async function alunoNaF01(matricula: string, turma: 'A' | 'B', nome?: string) {
      const aluno = await criarAluno(app.prisma, matricula, nome);
      await inscrever(app.prisma, {
        alunoId: aluno.id,
        fisicaId: f01.id,
        turmaId: f01.turmas[turma]!,
      });
      return aluno;
    }

    return { edicao, f01, eu, alunoNaF01 };
  }

  describe('GET /fisicas/minhas', () => {
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

      expect(resposta.json<MinhasFisicas>().fisicas.map((fisica) => fisica.codigo)).toEqual([
        'F01',
      ]);
    });

    it('devolve lista vazia para aluno sem inscrição na edição ativa', async () => {
      await cenario();
      const outro = await criarAluno(app.prisma, '999');

      const resposta = await minhas(outro);

      expect(resposta.json<MinhasFisicas>()).toMatchObject({ fisicas: [] });
    });

    it('responde 403 para admin e 401 sem token', async () => {
      const admin = await criarUsuario(app.prisma, {
        email: 'admin@teste.local',
        senha: 'x',
        papel: 'ADMIN',
      });

      expect((await minhas(admin)).statusCode).toBe(403);
      expect((await minhas()).statusCode).toBe(401);
    });
  });

  describe('GET /fisicas/:fisicaId/grupos', () => {
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

  describe('GET /fisicas/:fisicaId/colegas-disponiveis', () => {
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
});
