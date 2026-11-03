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
import type { dashboardSchema } from './schemas.js';

type Dashboard = z.infer<typeof dashboardSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('GET /admin/dashboard', () => {
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

  function dashboard(query: string, usuario?: Usuario) {
    return requisicaoComo(app, { method: 'GET', url: `/admin/dashboard${query}` }, usuario);
  }

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  /** Inscreve alunos novos na turma A da Física e devolve os ids. */
  async function inscritos(
    fisica: { id: number; turmas: Record<string, number> },
    ...matriculas: string[]
  ) {
    const ids: number[] = [];
    for (const matricula of matriculas) {
      const aluno = await criarAluno(app.prisma, matricula);
      await inscrever(app.prisma, {
        alunoId: aluno.id,
        fisicaId: fisica.id,
        turmaId: fisica.turmas.A!,
      });
      ids.push(aluno.id);
    }
    return ids;
  }

  /**
   * Fis2 (mínimo 2, 4 grupos): grupo 1 formado (2), grupo 2 com 3 (formado), grupo 3 com 1 (não
   * formado) e 1 aluno sem grupo. Fis1 (mínimo 3): 2 alunos, nenhum grupo.
   */
  async function cenario() {
    const edicao = await criarEdicao(app.prisma);
    const fis2 = await criarFisica(app.prisma, edicao.id, {
      codigo: 'Fis2',
      quantidadeGrupos: 4,
      minimoIntegrantes: 2,
    });
    const fis1 = await criarFisica(app.prisma, edicao.id, {
      codigo: 'Fis1',
      minimoIntegrantes: 3,
      multiturma: true,
    });
    const [a, b, c, d, e, f, semGrupo] = await inscritos(fis2, '1', '2', '3', '4', '5', '6', '7');
    await criarGrupo(app.prisma, { fisicaId: fis2.id, numero: 1, alunoIds: [a!, b!] });
    await criarGrupo(app.prisma, { fisicaId: fis2.id, numero: 2, alunoIds: [c!, d!, e!] });
    await criarGrupo(app.prisma, { fisicaId: fis2.id, numero: 3, alunoIds: [f!] });
    await inscritos(fis1, '8', '9');
    return { edicao, fis1, fis2, semGrupo, admin: await criarAdmin() };
  }

  it('um card por Física, em ordem de código, com grupos e alunos', async () => {
    const { edicao, fis1, fis2, admin } = await cenario();

    const resposta = await dashboard('', admin);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Dashboard>()).toEqual({
      edicao: {
        id: edicao.id,
        semestre: '2026/1',
        dataLimite: edicao.dataLimite.toISOString(),
        ativa: true,
      },
      fisicas: [
        {
          id: fis1.id,
          codigo: 'Fis1',
          nome: 'Física Fis1',
          quantidadeGrupos: 5,
          minimoIntegrantes: 3,
          maximoIntegrantes: 4,
          multiturma: true,
          gruposFormados: 0,
          gruposNaoFormados: 0,
          alunos: 2,
          alunosSemGrupo: 2,
        },
        {
          id: fis2.id,
          codigo: 'Fis2',
          nome: 'Física Fis2',
          quantidadeGrupos: 4,
          minimoIntegrantes: 2,
          maximoIntegrantes: 4,
          multiturma: false,
          gruposFormados: 2,
          gruposNaoFormados: 1,
          alunos: 7,
          alunosSemGrupo: 1,
        },
      ],
    });
  });

  it('com edicaoId, mostra uma edição finalizada, sem misturar com a atual', async () => {
    const { admin } = await cenario();
    const antiga = await criarEdicao(app.prisma, {
      semestre: '2025/2',
      ativa: false,
      criadoEm: new Date(Date.now() - UM_ANO),
    });
    const fAntiga = await criarFisica(app.prisma, antiga.id, {
      codigo: 'Fis9',
      minimoIntegrantes: 1,
    });
    const [aluno] = await inscritos(fAntiga, '900');
    await criarGrupo(app.prisma, { fisicaId: fAntiga.id, numero: 1, alunoIds: [aluno!] });

    const corpo = (await dashboard(`?edicaoId=${antiga.id}`, admin)).json<Dashboard>();

    expect(corpo.edicao).toMatchObject({ id: antiga.id, semestre: '2025/2', ativa: false });
    expect(corpo.fisicas).toEqual([
      expect.objectContaining({
        codigo: 'Fis9',
        gruposFormados: 1,
        gruposNaoFormados: 0,
        alunos: 1,
        alunosSemGrupo: 0,
      }),
    ]);
  });

  it('sem edicaoId, a última edição criada, mesmo que uma mais antiga esteja ativa', async () => {
    await criarEdicao(app.prisma, {
      semestre: '2025/2',
      ativa: true,
      criadoEm: new Date(Date.now() - UM_ANO),
    });
    const recente = await criarEdicao(app.prisma, { semestre: '2026/1', ativa: false });

    const corpo = (await dashboard('', await criarAdmin())).json<Dashboard>();

    expect(corpo.edicao?.id).toBe(recente.id);
    expect(corpo.fisicas).toEqual([]);
  });

  it('sem nenhuma edição, responde edicao null e lista vazia', async () => {
    const resposta = await dashboard('', await criarAdmin());

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Dashboard>()).toEqual({ edicao: null, fisicas: [] });
  });

  it('responde 404 para edição inexistente', async () => {
    const resposta = await dashboard('?edicaoId=99999', await criarAdmin());

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta)).toEqual({
      codigo: 'NAO_ENCONTRADO',
      mensagem: 'Edição não encontrada.',
    });
  });

  it.each(['?edicaoId=0', '?edicaoId=abc'])('responde 400 VALIDACAO para %s', async (query) => {
    const resposta = await dashboard(query, await criarAdmin());

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(
      expect.objectContaining({ campo: 'edicaoId' }),
    );
  });

  it('responde 403 para aluno e 401 sem token', async () => {
    const aluno = await criarAluno(app.prisma, '100');

    expect((await dashboard('', aluno)).statusCode).toBe(403);
    expect((await dashboard('')).statusCode).toBe(401);
  });
});
