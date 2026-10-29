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
  type NovaFisica,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { grupoSchema, remocaoDeIntegranteSchema } from './schemas.js';

type Remocao = z.infer<typeof remocaoDeIntegranteSchema>;
type Grupo = z.infer<typeof grupoSchema>;

describe('DELETE /grupos/:grupoId/integrantes/:alunoId', () => {
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

  function remover(grupoId: number | string, alunoId: number | string, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'DELETE', url: `/grupos/${grupoId}/integrantes/${alunoId}` },
      usuario,
    );
  }

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  /** F01 (mínimo 2, máximo 3, salvo se indicado) com o grupo 1 formado por "eu", Ana e Bia. */
  async function cenarioComGrupo(fisica: NovaFisica = {}) {
    const base = await criarCenarioDeGrupos(app.prisma, { minimoIntegrantes: 2, ...fisica });
    const ana = await base.alunoNaF01('201', 'A', 'Ana');
    const bia = await base.alunoNaF01('202', 'A', 'Bia');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: base.f01.id,
      numero: 1,
      alunoIds: [base.eu.id, ana.id, bia.id],
    });
    const admin = await criarAdmin();
    return { ...base, ana, bia, grupo, admin };
  }

  /** Inscrição do aluno na Física, direto do banco. */
  function inscricaoDe(aluno: Usuario, fisicaId: number) {
    return app.prisma.inscricao.findUniqueOrThrow({
      where: { alunoId_fisicaId: { alunoId: aluno.id, fisicaId } },
    });
  }

  function grupoExiste(grupoId: number) {
    return app.prisma.grupo.findUnique({ where: { id: grupoId } }).then(Boolean);
  }

  it('remove o aluno, que fica sem grupo, e devolve o grupo sem ele', async () => {
    const { f01, eu, ana, bia, grupo, admin } = await cenarioComGrupo();

    const resposta = await remover(grupo.id, ana.id, admin);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Remocao>()).toEqual({
      grupo: {
        id: grupo.id,
        numero: 1,
        fisicaId: f01.id,
        formado: true,
        integrantes: [
          { id: eu.id, nome: 'Eu Mesmo', curso: 'GES', matricula: '100', turma: 'A' },
          { id: bia.id, nome: 'Bia', curso: 'GES', matricula: '202', turma: 'A' },
        ],
      },
    });
    expect(await inscricaoDe(ana, f01.id)).toMatchObject({ grupoId: null, entrouNoGrupoEm: null });
  });

  it('o grupo pode ficar abaixo do mínimo (formado: false)', async () => {
    const { ana, bia, grupo, admin } = await cenarioComGrupo();
    await remover(grupo.id, ana.id, admin);

    const resposta = await remover(grupo.id, bia.id, admin);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Remocao>().grupo).toMatchObject({ formado: false });
    expect(resposta.json<Remocao>().grupo?.integrantes).toHaveLength(1);
  });

  it('o último integrante: o grupo é apagado e a resposta traz grupo null', async () => {
    const { f01, eu, ana, bia, grupo, admin } = await cenarioComGrupo();
    await remover(grupo.id, ana.id, admin);
    await remover(grupo.id, bia.id, admin);

    const resposta = await remover(grupo.id, eu.id, admin);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Remocao>()).toEqual({ grupo: null });
    expect(await grupoExiste(grupo.id)).toBe(false);
    expect(await inscricaoDe(eu, f01.id)).toMatchObject({ grupoId: null });
  });

  it('o número do grupo apagado fica livre; os outros grupos não são renumerados', async () => {
    const { f01, eu, ana, bia, alunoNaF01, grupo, admin } = await cenarioComGrupo({
      minimoIntegrantes: 1,
    });
    const caio = await alunoNaF01('203', 'A', 'Caio');
    const grupo2 = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 2,
      alunoIds: [caio.id],
    });
    for (const aluno of [eu, ana, bia]) {
      await remover(grupo.id, aluno.id, admin);
    }

    const criado = await requisicaoComo(
      app,
      { method: 'POST', url: `/fisicas/${f01.id}/grupos`, payload: { colegas: [] } },
      eu,
    );

    expect(criado.json<Grupo>().numero).toBe(1);
    expect(await app.prisma.grupo.findUniqueOrThrow({ where: { id: grupo2.id } })).toMatchObject({
      numero: 2,
    });
  });

  it('o aluno removido volta a poder entrar em grupos e aparece como colega disponível', async () => {
    const { f01, eu, ana, grupo, admin } = await cenarioComGrupo();
    await remover(grupo.id, ana.id, admin);

    const disponiveis = await requisicaoComo(
      app,
      { method: 'GET', url: `/fisicas/${f01.id}/colegas-disponiveis` },
      eu,
    );
    const entrar = await requisicaoComo(
      app,
      { method: 'POST', url: `/grupos/${grupo.id}/entrar` },
      ana,
    );

    expect(disponiveis.json<{ id: number }[]>().map((colega) => colega.id)).toContain(ana.id);
    expect(entrar.statusCode).toBe(200);
  });

  it('funciona depois do prazo e em edição inativa', async () => {
    const { edicao, f01, ana, grupo, admin } = await cenarioComGrupo();
    await app.prisma.edicao.update({
      where: { id: edicao.id },
      data: { dataLimite: new Date(Date.now() - 1000), ativa: false },
    });

    const resposta = await remover(grupo.id, ana.id, admin);

    expect(resposta.statusCode).toBe(200);
    expect(await inscricaoDe(ana, f01.id)).toMatchObject({ grupoId: null });
  });

  it('responde 404 para grupo inexistente', async () => {
    const { ana, admin } = await cenarioComGrupo();

    const resposta = await remover(99999, ana.id, admin);

    expect(resposta.statusCode).toBe(404);
    expect(erroDa(resposta)).toEqual({
      codigo: 'NAO_ENCONTRADO',
      mensagem: 'Grupo não encontrado.',
    });
  });

  it('responde 404 para aluno que não é integrante deste grupo, sem alterar nada', async () => {
    const { edicao, f01, alunoNaF01, grupo, admin } = await cenarioComGrupo();
    const semGrupo = await alunoNaF01('203', 'A');
    const deOutroGrupo = await alunoNaF01('204', 'A');
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 2, alunoIds: [deOutroGrupo.id] });
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const deOutraFisica = await criarAluno(app.prisma, '400');
    await inscrever(app.prisma, {
      alunoId: deOutraFisica.id,
      fisicaId: f02.id,
      turmaId: f02.turmas.A!,
    });

    for (const aluno of [semGrupo.id, deOutroGrupo.id, deOutraFisica.id, 99999]) {
      const resposta = await remover(grupo.id, aluno, admin);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Aluno não encontrado neste grupo.',
      });
    }
    expect(await app.prisma.inscricao.count({ where: { grupoId: grupo.id } })).toBe(3);
    expect(await inscricaoDe(deOutroGrupo, f01.id)).toMatchObject({
      grupoId: expect.any(Number) as number,
    });
  });

  it.each([
    ['abc', '1', 'grupoId'],
    ['0', '1', 'grupoId'],
    ['1', '-1', 'alunoId'],
    ['1', '1.5', 'alunoId'],
  ])('responde 400 VALIDACAO para grupoId "%s" e alunoId "%s"', async (grupoId, alunoId, campo) => {
    const admin = await criarAdmin();

    const resposta = await remover(grupoId, alunoId, admin);

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
  });

  it('responde 403 para aluno (nem integrante pode remover) e 401 sem token', async () => {
    const { eu, ana, grupo } = await cenarioComGrupo();

    const comoAluno = await remover(grupo.id, ana.id, eu);
    const semToken = await remover(grupo.id, ana.id);

    expect(comoAluno.statusCode).toBe(403);
    expect(erroDa(comoAluno).codigo).toBe('SEM_PERMISSAO');
    expect(semToken.statusCode).toBe(401);
    expect(await app.prisma.inscricao.count({ where: { grupoId: grupo.id } })).toBe(3);
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof remover>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('clique duplo: remove uma vez só', async () => {
      const { ana, grupo, admin } = await cenarioComGrupo();

      const respostas = await Promise.all([
        remover(grupo.id, ana.id, admin),
        remover(grupo.id, ana.id, admin),
      ]);

      expect(codigos(respostas)).toEqual([200, 404]);
      expect(await app.prisma.inscricao.count({ where: { grupoId: grupo.id } })).toBe(2);
    });

    it('os dois últimos integrantes removidos ao mesmo tempo: o grupo é apagado uma vez só', async () => {
      const { eu, ana, bia, grupo, admin } = await cenarioComGrupo();
      await remover(grupo.id, bia.id, admin);

      const respostas = await Promise.all([
        remover(grupo.id, eu.id, admin),
        remover(grupo.id, ana.id, admin),
      ]);

      expect(codigos(respostas)).toEqual([200, 200]);
      const grupos = respostas.map((resposta) => resposta.json<Remocao>().grupo);
      expect(grupos.filter((grupo) => grupo === null)).toHaveLength(1);
      expect(await grupoExiste(grupo.id)).toBe(false);
    });

    it('remover o último enquanto um aluno entra: nunca fica grupo vazio nem erro 500', async () => {
      const { eu, ana, bia, alunoNaF01, grupo, admin } = await cenarioComGrupo();
      await remover(grupo.id, ana.id, admin);
      await remover(grupo.id, bia.id, admin);
      const caio = await alunoNaF01('203', 'A');

      const [remocao, entrada] = await Promise.all([
        remover(grupo.id, eu.id, admin),
        requisicaoComo(app, { method: 'POST', url: `/grupos/${grupo.id}/entrar` }, caio),
      ]);

      expect(remocao.statusCode).toBe(200);
      const integrantes = await app.prisma.inscricao.count({ where: { grupoId: grupo.id } });
      if (entrada.statusCode === 200) {
        // Entrou antes: o grupo continua, só com quem entrou.
        expect(remocao.json<Remocao>().grupo?.integrantes).toHaveLength(1);
        expect(integrantes).toBe(1);
      } else {
        // Removeu antes: o grupo sumiu e a entrada recebe 404.
        expect(entrada.statusCode).toBe(404);
        expect(remocao.json<Remocao>().grupo).toBeNull();
        expect(await grupoExiste(grupo.id)).toBe(false);
      }
    });

    it('remover de um grupo cheio enquanto um aluno entra: nunca passa do máximo', async () => {
      const { ana, alunoNaF01, grupo, admin } = await cenarioComGrupo({ maximoIntegrantes: 3 });
      const caio = await alunoNaF01('203', 'A');

      const [remocao, entrada] = await Promise.all([
        remover(grupo.id, ana.id, admin),
        requisicaoComo(app, { method: 'POST', url: `/grupos/${grupo.id}/entrar` }, caio),
      ]);

      expect(remocao.statusCode).toBe(200);
      // Entrou depois da remoção (vaga liberada) ou antes, com o grupo ainda cheio.
      expect([200, 409]).toContain(entrada.statusCode);
      const integrantes = await app.prisma.inscricao.count({ where: { grupoId: grupo.id } });
      expect(integrantes).toBe(entrada.statusCode === 200 ? 3 : 2);
    });
  });
});
