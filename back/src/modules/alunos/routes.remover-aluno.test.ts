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
import type { remocaoDoAlunoSchema } from './schemas.js';

type RemocaoDoAluno = z.infer<typeof remocaoDoAlunoSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('DELETE /admin/fisicas/:fisicaId/alunos/:alunoId', () => {
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

  function remover(fisicaId: number, alunoId: number, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'DELETE', url: `/admin/fisicas/${fisicaId}/alunos/${alunoId}` },
      usuario,
    );
  }

  function inscricoesDe(alunoId: number) {
    return app.prisma.inscricao.findMany({ where: { alunoId }, select: { fisicaId: true } });
  }

  /**
   * Edição atual com a F01 (mínimo 2) e a F02. Na F01: Bia, Caio e Davi no grupo 1; Eva sozinha
   * no grupo 2; João sem grupo. Bia também está na F02.
   */
  async function cenario() {
    const edicao = await criarEdicao(app.prisma);
    const f01 = await criarFisica(app.prisma, edicao.id);
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const [bia, caio, davi, eva, joao] = await Promise.all(
      ['Bia', 'Caio', 'Davi', 'Eva', 'João'].map((nome, i) =>
        criarAluno(app.prisma, String(100 + i), nome),
      ),
    );
    for (const aluno of [bia!, caio!, davi!, eva!, joao!]) {
      await inscrever(app.prisma, { alunoId: aluno.id, fisicaId: f01.id, turmaId: f01.turmas.A! });
    }
    await inscrever(app.prisma, { alunoId: bia!.id, fisicaId: f02.id, turmaId: f02.turmas.A! });
    const g1 = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [bia!.id, caio!.id, davi!.id],
    });
    const g2 = await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 2, alunoIds: [eva!.id] });
    const admin = await criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
    return { f01, f02, bia: bia!, caio: caio!, davi: davi!, eva: eva!, joao: joao!, g1, g2, admin };
  }

  it('tira o aluno do grupo e da Física; o grupo continua com os outros', async () => {
    const { f01, f02, bia, g1, admin } = await cenario();

    const resposta = await remover(f01.id, bia.id, admin);

    expect(resposta.statusCode).toBe(200);
    const { grupo } = resposta.json<RemocaoDoAluno>();
    expect(grupo).toMatchObject({ id: g1.id, numero: 1, formado: true });
    expect(grupo?.integrantes.map((integrante) => integrante.nome)).toEqual(['Caio', 'Davi']);
    expect(await inscricoesDe(bia.id)).toEqual([{ fisicaId: f02.id }]);
  });

  it('o grupo pode ficar abaixo do mínimo', async () => {
    const { f01, bia, caio, admin } = await cenario();
    await remover(f01.id, bia.id, admin);

    const resposta = await remover(f01.id, caio.id, admin);

    expect(resposta.json<RemocaoDoAluno>().grupo).toMatchObject({ formado: false });
  });

  it('era o último integrante: o grupo é apagado e os outros não são renumerados', async () => {
    const { f01, eva, g1, g2, admin } = await cenario();

    const resposta = await remover(f01.id, eva.id, admin);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<RemocaoDoAluno>()).toEqual({ grupo: null });
    expect(await app.prisma.grupo.findUnique({ where: { id: g2.id } })).toBeNull();
    const restantes = await app.prisma.grupo.findMany({ where: { fisicaId: f01.id } });
    expect(restantes.map((grupo) => [grupo.id, grupo.numero])).toEqual([[g1.id, 1]]);
  });

  it('aluno sem grupo: só sai da Física', async () => {
    const { f01, joao, admin } = await cenario();

    const resposta = await remover(f01.id, joao.id, admin);

    expect(resposta.json<RemocaoDoAluno>()).toEqual({ grupo: null });
    expect(await inscricoesDe(joao.id)).toEqual([]);
    expect(await app.prisma.grupo.count()).toBe(2);
  });

  it('o cadastro continua: o aluno sem nenhuma Física ainda entra no sistema', async () => {
    const { f01, joao, admin } = await cenario();
    await remover(f01.id, joao.id, admin);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login: 'GES104', senha: 'joao' },
    });

    expect(login.statusCode).toBe(200);
  });

  it('vale na edição atual depois do prazo (o admin não tem prazo)', async () => {
    const edicao = await criarEdicao(app.prisma, {
      ativa: false,
      dataLimite: new Date(Date.now() - 1000),
    });
    const f01 = await criarFisica(app.prisma, edicao.id);
    const aluno = await criarAluno(app.prisma, '1');
    await inscrever(app.prisma, { alunoId: aluno.id, fisicaId: f01.id, turmaId: f01.turmas.A! });
    const admin = await criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });

    expect((await remover(f01.id, aluno.id, admin)).statusCode).toBe(200);
  });

  describe('erros', () => {
    it('responde 404 para aluno que não está nesta Física', async () => {
      const { f02, caio, admin } = await cenario();

      const resposta = await remover(f02.id, caio.id, admin);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Aluno não encontrado nesta Física.',
      });
    });

    it('responde 404 para Física inexistente', async () => {
      const { bia, admin } = await cenario();

      const resposta = await remover(99999, bia.id, admin);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta).mensagem).toBe('Física não encontrada.');
    });

    it('responde 404 para Física de uma edição anterior, sem apagar nada', async () => {
      const { admin } = await cenario();
      const antiga = await criarEdicao(app.prisma, {
        semestre: '2025/2',
        ativa: false,
        criadoEm: new Date(Date.now() - UM_ANO),
      });
      const fAntiga = await criarFisica(app.prisma, antiga.id);
      const veterano = await criarAluno(app.prisma, '900');
      await inscrever(app.prisma, {
        alunoId: veterano.id,
        fisicaId: fAntiga.id,
        turmaId: fAntiga.turmas.A!,
      });

      const resposta = await remover(fAntiga.id, veterano.id, admin);

      expect(resposta.statusCode).toBe(404);
      expect(await inscricoesDe(veterano.id)).toHaveLength(1);
    });

    it.each([
      ['fisicaId', '0/alunos/1'],
      ['alunoId', '1/alunos/abc'],
    ])('responde 400 VALIDACAO para %s inválido', async (campo, caminho) => {
      const { admin } = await cenario();

      const resposta = await requisicaoComo(
        app,
        { method: 'DELETE', url: `/admin/fisicas/${caminho}` },
        admin,
      );

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
    });

    it('responde 403 para aluno e 401 sem token, sem apagar nada', async () => {
      const { f01, bia, joao } = await cenario();

      expect((await remover(f01.id, joao.id, bia)).statusCode).toBe(403);
      expect((await remover(f01.id, joao.id)).statusCode).toBe(401);
      expect(await inscricoesDe(joao.id)).toHaveLength(1);
    });
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof remover>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('os dois últimos integrantes removidos ao mesmo tempo: o grupo é apagado uma vez, sem erro', async () => {
      const { f01, bia, caio, davi, g1, admin } = await cenario();
      await remover(f01.id, bia.id, admin);

      const respostas = await Promise.all([
        remover(f01.id, caio.id, admin),
        remover(f01.id, davi.id, admin),
      ]);

      expect(codigos(respostas)).toEqual([200, 200]);
      const grupos = respostas.map((resposta) => resposta.json<RemocaoDoAluno>().grupo);
      expect(grupos).toContainEqual(null);
      expect(await app.prisma.grupo.findUnique({ where: { id: g1.id } })).toBeNull();
    });

    it('clique duplo na lixeira: remove uma vez, o segundo recebe 404', async () => {
      const { f01, joao, admin } = await cenario();

      const respostas = await Promise.all([
        remover(f01.id, joao.id, admin),
        remover(f01.id, joao.id, admin),
      ]);

      expect(codigos(respostas)).toEqual([200, 404]);
    });

    it('o aluno entra num grupo enquanto o admin o remove: ele não fica num grupo sem inscrição', async () => {
      const { f01, joao, g1, admin } = await cenario();

      const respostas = await Promise.all([
        requisicaoComo(app, { method: 'POST', url: `/grupos/${g1.id}/entrar` }, joao),
        remover(f01.id, joao.id, admin),
      ]);

      // A remoção sempre passa; a entrada passa antes dela ou recebe 404 depois.
      expect(respostas[1].statusCode).toBe(200);
      expect([200, 404]).toContain(respostas[0].statusCode);
      expect(await inscricoesDe(joao.id)).toEqual([]);
      expect(await app.prisma.inscricao.count({ where: { grupoId: g1.id } })).toBe(3);
    });
  });
});
