import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Usuario } from '../../generated/prisma/client.js';
import {
  criarAluno,
  criarEdicao,
  criarFisica,
  criarUsuario,
  inscrever,
  limparBanco,
} from '../../test/db.js';
import { requisicaoComo } from '../../test/http.js';
import type { listaDeEdicoesSchema } from './schemas.js';

type ListaDeEdicoes = z.infer<typeof listaDeEdicoesSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('GET /admin/edicoes', () => {
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

  function listar(usuario?: Usuario) {
    return requisicaoComo(app, { method: 'GET', url: '/admin/edicoes' }, usuario);
  }

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  it('lista da mais recente para a mais antiga, com Físicas e alunos', async () => {
    const antiga = await criarEdicao(app.prisma, {
      semestre: '2025/2',
      ativa: false,
      criadoEm: new Date(Date.now() - UM_ANO),
    });
    const atual = await criarEdicao(app.prisma, { semestre: '2026/1' });
    const f01 = await criarFisica(app.prisma, atual.id, { codigo: 'Fis1' });
    const f02 = await criarFisica(app.prisma, atual.id, { codigo: 'Fis2' });
    const fAntiga = await criarFisica(app.prisma, antiga.id, { codigo: 'Fis1' });
    const ana = await criarAluno(app.prisma, '101', 'Ana');
    const bia = await criarAluno(app.prisma, '102', 'Bia');
    // Ana em duas Físicas da edição atual conta uma vez; na antiga, conta de novo.
    await inscrever(app.prisma, { alunoId: ana.id, fisicaId: f01.id, turmaId: f01.turmas.A! });
    await inscrever(app.prisma, { alunoId: ana.id, fisicaId: f02.id, turmaId: f02.turmas.B! });
    await inscrever(app.prisma, { alunoId: bia.id, fisicaId: f01.id, turmaId: f01.turmas.A! });
    await inscrever(app.prisma, {
      alunoId: ana.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });

    const resposta = await listar(await criarAdmin());

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<ListaDeEdicoes>()).toEqual([
      {
        id: atual.id,
        semestre: '2026/1',
        dataLimite: atual.dataLimite.toISOString(),
        ativa: true,
        criadoEm: atual.criadoEm.toISOString(),
        fisicas: 2,
        alunos: 2,
      },
      {
        id: antiga.id,
        semestre: '2025/2',
        dataLimite: antiga.dataLimite.toISOString(),
        ativa: false,
        criadoEm: antiga.criadoEm.toISOString(),
        fisicas: 1,
        alunos: 1,
      },
    ]);
  });

  it('edição sem Físicas nem alunos aparece com zero', async () => {
    const edicao = await criarEdicao(app.prisma);

    const corpo = (await listar(await criarAdmin())).json<ListaDeEdicoes>();

    expect(corpo).toEqual([expect.objectContaining({ id: edicao.id, fisicas: 0, alunos: 0 })]);
  });

  it('sem nenhuma edição, responde lista vazia', async () => {
    const resposta = await listar(await criarAdmin());

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<ListaDeEdicoes>()).toEqual([]);
  });

  it('responde 403 para aluno e 401 sem token', async () => {
    const aluno = await criarAluno(app.prisma, '100');

    expect((await listar(aluno)).statusCode).toBe(403);
    expect((await listar()).statusCode).toBe(401);
  });
});
