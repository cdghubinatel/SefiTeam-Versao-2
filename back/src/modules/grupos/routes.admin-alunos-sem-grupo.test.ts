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
import type { alunoResumoSchema } from './schemas.js';

type AlunoResumo = z.infer<typeof alunoResumoSchema>;

describe('GET /admin/fisicas/:fisicaId/alunos-sem-grupo', () => {
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

  function listar(fisicaId: number | string, query: string, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'GET', url: `/admin/fisicas/${fisicaId}/alunos-sem-grupo${query}` },
      usuario,
    );
  }

  /** F01 com "eu" e Ana num grupo; João (A), Bruna (A) e Zeca (B) sem grupo. */
  async function cenario() {
    const base = await criarCenarioDeGrupos(app.prisma);
    const ana = await base.alunoNaF01('201', 'A', 'Ana');
    await criarGrupo(app.prisma, {
      fisicaId: base.f01.id,
      numero: 1,
      alunoIds: [base.eu.id, ana.id],
    });
    const joao = await base.alunoNaF01('202', 'A', 'João Silva');
    const bruna = await base.alunoNaF01('203', 'A', 'Bruna');
    const zeca = await base.alunoNaF01('301', 'B', 'Zeca');
    const admin = await criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
    return { ...base, joao, bruna, zeca, admin };
  }

  function nomes(resposta: Awaited<ReturnType<typeof listar>>) {
    return resposta.json<AlunoResumo[]>().map((aluno) => aluno.nome);
  }

  it('lista só os sem grupo, em ordem de nome, no formato de aluno', async () => {
    const { f01, joao, admin } = await cenario();

    const resposta = await listar(f01.id, '', admin);

    expect(resposta.statusCode).toBe(200);
    expect(nomes(resposta)).toEqual(['Bruna', 'João Silva', 'Zeca']);
    expect(resposta.json<AlunoResumo[]>()).toContainEqual({
      id: joao.id,
      nome: 'João Silva',
      curso: 'GES',
      matricula: '202',
      turma: 'A',
    });
  });

  it('filtra pela turma (código)', async () => {
    const { f01, admin } = await cenario();

    expect(nomes(await listar(f01.id, '?turma=B', admin))).toEqual(['Zeca']);
    expect(nomes(await listar(f01.id, '?turma=Z', admin))).toEqual([]);
  });

  it('busca por nome sem acentos nem maiúsculas, ou por matrícula, combinando com a turma', async () => {
    const { f01, admin } = await cenario();

    expect(nomes(await listar(f01.id, '?busca=JOAO', admin))).toEqual(['João Silva']);
    expect(nomes(await listar(f01.id, '?busca=301', admin))).toEqual(['Zeca']);
    expect(nomes(await listar(f01.id, '?busca=a&turma=A', admin))).toEqual(['Bruna', 'João Silva']);
  });

  it('funciona numa Física de edição inativa', async () => {
    const { admin } = await cenario();
    const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
    const fAntiga = await criarFisica(app.prisma, antiga.id);
    const aluno = await criarAluno(app.prisma, '900', 'Antigo');
    await inscrever(app.prisma, {
      alunoId: aluno.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });

    expect(nomes(await listar(fAntiga.id, '', admin))).toEqual(['Antigo']);
  });

  it('responde 404 para Física inexistente', async () => {
    const { admin } = await cenario();

    const resposta = await listar(99999, '', admin);

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta)).toEqual({
      codigo: 'NAO_ENCONTRADO',
      mensagem: 'Física não encontrada.',
    });
  });

  it.each([
    ['abc', '', 'fisicaId'],
    ['1', `?busca=${'x'.repeat(101)}`, 'busca'],
    ['1', '?turma=', 'turma'],
  ])('responde 400 VALIDACAO (fisicaId "%s", query "%s")', async (fisicaId, query, campo) => {
    const { admin } = await cenario();

    const resposta = await listar(fisicaId, query, admin);

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
  });

  it('responde 403 para aluno e 401 sem token', async () => {
    const { f01, eu } = await cenario();

    expect((await listar(f01.id, '', eu)).statusCode).toBe(403);
    expect((await listar(f01.id, '')).statusCode).toBe(401);
  });
});
