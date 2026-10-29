import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Usuario } from '../../generated/prisma/client.js';
import {
  criarCenarioDeGrupos,
  criarFisica,
  criarGrupo,
  criarUsuario,
  limparBanco,
  type NovaFisica,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { grupoSchema } from './schemas.js';

type Grupo = z.infer<typeof grupoSchema>;

describe('POST /admin/fisicas/:fisicaId/grupos', () => {
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

  function criar(fisicaId: number | string, payload: unknown, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'POST', url: `/admin/fisicas/${fisicaId}/grupos`, payload: payload as object },
      usuario,
    );
  }

  /** F01 (mínimo 2, máximo 3, 5 grupos, salvo se indicado); Ana e Bia (A) e Daniel (B) sem grupo. */
  async function cenario(fisica: NovaFisica = {}) {
    const base = await criarCenarioDeGrupos(app.prisma, { minimoIntegrantes: 2, ...fisica });
    const ana = await base.alunoNaF01('201', 'A', 'Ana');
    const bia = await base.alunoNaF01('202', 'A', 'Bia');
    const daniel = await base.alunoNaF01('301', 'B', 'Daniel');
    const admin = await criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
    return { ...base, ana, bia, daniel, admin };
  }

  function grupoDoAluno(aluno: Usuario, fisicaId: number) {
    return app.prisma.inscricao
      .findUniqueOrThrow({ where: { alunoId_fisicaId: { alunoId: aluno.id, fisicaId } } })
      .then((inscricao) => inscricao.grupoId);
  }

  function quantidadeDeGrupos(fisicaId: number) {
    return app.prisma.grupo.count({ where: { fisicaId } });
  }

  it('cria com 1 aluno, abaixo do mínimo (formado: false), com o admin como autor', async () => {
    const { f01, ana, admin } = await cenario();

    const resposta = await criar(f01.id, { alunos: [ana.id] }, admin);

    expect(resposta.statusCode).toBe(201);
    const grupo = resposta.json<Grupo>();
    expect(grupo).toEqual({
      id: grupo.id,
      numero: 1,
      fisicaId: f01.id,
      formado: false,
      integrantes: [{ id: ana.id, nome: 'Ana', curso: 'GES', matricula: '201', turma: 'A' }],
    });
    const noBanco = await app.prisma.grupo.findUniqueOrThrow({ where: { id: grupo.id } });
    expect(noBanco.criadoPorId).toBe(admin.id);
    expect(await grupoDoAluno(ana, f01.id)).toBe(grupo.id);
  });

  it('recebe o menor número livre e fica formado ao atingir o mínimo', async () => {
    const { f01, eu, ana, bia, admin } = await cenario();
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 2, alunoIds: [eu.id] });

    const resposta = await criar(f01.id, { alunos: [ana.id, bia.id] }, admin);

    expect(resposta.json<Grupo>()).toMatchObject({ numero: 1, formado: true });
  });

  it('funciona depois do prazo e em edição inativa', async () => {
    const { edicao, f01, ana, admin } = await cenario();
    await app.prisma.edicao.update({
      where: { id: edicao.id },
      data: { dataLimite: new Date(Date.now() - 1000), ativa: false },
    });

    const resposta = await criar(f01.id, { alunos: [ana.id] }, admin);

    expect(resposta.statusCode).toBe(201);
  });

  it('com multiturma, aceita alunos de turmas diferentes', async () => {
    const { f01, ana, daniel, admin } = await cenario({ multiturma: true });

    const resposta = await criar(f01.id, { alunos: [ana.id, daniel.id] }, admin);

    expect(resposta.statusCode).toBe(201);
  });

  it('responde 404 para Física inexistente', async () => {
    const { ana, admin } = await cenario();

    const resposta = await criar(99999, { alunos: [ana.id] }, admin);

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta)).toEqual({
      codigo: 'NAO_ENCONTRADO',
      mensagem: 'Física não encontrada.',
    });
  });

  it('responde 409 GRUPO_CHEIO acima do máximo, sem criar nada', async () => {
    const { f01, eu, ana, bia, admin } = await cenario({ maximoIntegrantes: 2 });

    const resposta = await criar(f01.id, { alunos: [eu.id, ana.id, bia.id] }, admin);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'GRUPO_CHEIO',
      mensagem: 'O grupo pode ter no máximo 2 integrantes.',
    });
    expect(await quantidadeDeGrupos(f01.id)).toBe(0);
  });

  it('responde 404 se um aluno não está inscrito na Física', async () => {
    const { edicao, f01, ana, admin } = await cenario();
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });

    const resposta = await criar(f02.id, { alunos: [ana.id] }, admin);

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta).mensagem).toBe(
      'Um dos alunos selecionados não está inscrito nesta Física.',
    );
    expect(await grupoDoAluno(ana, f01.id)).toBeNull();
  });

  it('responde 409 JA_EM_GRUPO se um aluno já tem grupo', async () => {
    const { f01, eu, ana, admin } = await cenario();
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [eu.id] });

    const resposta = await criar(f01.id, { alunos: [ana.id, eu.id] }, admin);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'JA_EM_GRUPO',
      mensagem: 'Eu Mesmo já está em um grupo nesta Física.',
    });
    expect(await grupoDoAluno(ana, f01.id)).toBeNull();
  });

  it('responde 409 TURMA_DIFERENTE sem multiturma; o primeiro da lista define a turma', async () => {
    const { f01, ana, daniel, admin } = await cenario();

    const resposta = await criar(f01.id, { alunos: [daniel.id, ana.id] }, admin);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'TURMA_DIFERENTE',
      mensagem: 'Ana é de outra turma, e esta Física não aceita turmas diferentes no mesmo grupo.',
    });
    expect(await quantidadeDeGrupos(f01.id)).toBe(0);
  });

  it('responde 409 LIMITE_DE_GRUPOS com todos os grupos da Física criados', async () => {
    const { f01, eu, ana, admin } = await cenario({ quantidadeGrupos: 1 });
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [eu.id] });

    const resposta = await criar(f01.id, { alunos: [ana.id] }, admin);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'LIMITE_DE_GRUPOS',
      mensagem: 'Esta Física já atingiu o número máximo de grupos.',
    });
  });

  it.each([
    ['lista vazia', { alunos: [] }],
    ['sem o campo', {}],
    ['ids repetidos', { alunos: [7, 7] }],
    ['mais de 50 ids', { alunos: Array.from({ length: 51 }, (_, indice) => indice + 1) }],
  ])('responde 400 VALIDACAO para %s', async (_caso, payload) => {
    const { f01, admin } = await cenario();

    const resposta = await criar(f01.id, payload, admin);

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(
      expect.objectContaining({ campo: expect.stringMatching(/^alunos/) as string }),
    );
  });

  it('responde 403 para aluno e 401 sem token', async () => {
    const { f01, eu, ana } = await cenario();

    expect((await criar(f01.id, { alunos: [ana.id] }, eu)).statusCode).toBe(403);
    expect((await criar(f01.id, { alunos: [ana.id] })).statusCode).toBe(401);
    expect(await quantidadeDeGrupos(f01.id)).toBe(0);
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof criar>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('admin e aluno criando o último grupo da Física: só um cria', async () => {
      const { f01, eu, ana, admin } = await cenario({ quantidadeGrupos: 1, minimoIntegrantes: 1 });

      const respostas = await Promise.all([
        criar(f01.id, { alunos: [ana.id] }, admin),
        requisicaoComo(
          app,
          { method: 'POST', url: `/fisicas/${f01.id}/grupos`, payload: { colegas: [] } },
          eu,
        ),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('LIMITE_DE_GRUPOS');
      expect(await quantidadeDeGrupos(f01.id)).toBe(1);
    });

    it('admin cria com um aluno que entra num grupo ao mesmo tempo: ele fica em um só', async () => {
      const { f01, eu, ana, admin } = await cenario();
      const existente = await criarGrupo(app.prisma, {
        fisicaId: f01.id,
        numero: 1,
        alunoIds: [eu.id],
      });

      const respostas = await Promise.all([
        criar(f01.id, { alunos: [ana.id] }, admin),
        requisicaoComo(app, { method: 'POST', url: `/grupos/${existente.id}/entrar` }, ana),
      ]);

      const sucessos = respostas.filter((resposta) => resposta.statusCode < 300);
      expect(sucessos).toHaveLength(1);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('JA_EM_GRUPO');
      expect(
        await app.prisma.inscricao.count({ where: { alunoId: ana.id, grupoId: { not: null } } }),
      ).toBe(1);
    });

    it('clique duplo: cria um grupo só', async () => {
      const { f01, ana, admin } = await cenario();

      const respostas = await Promise.all([
        criar(f01.id, { alunos: [ana.id] }, admin),
        criar(f01.id, { alunos: [ana.id] }, admin),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      expect(await quantidadeDeGrupos(f01.id)).toBe(1);
    });
  });
});
