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
import type { alunoDaEdicaoSchema, alunosDaEdicaoSchema } from './schemas.js';

type AlunoDaEdicao = z.infer<typeof alunoDaEdicaoSchema>;
type AlunosDaEdicao = z.infer<typeof alunosDaEdicaoSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('PUT /admin/fisicas/:fisicaId/alunos/:alunoId', () => {
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

  function editar(fisicaId: number, alunoId: number, payload: object, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'PUT', url: `/admin/fisicas/${fisicaId}/alunos/${alunoId}`, payload },
      usuario,
    );
  }

  function login(loginDigitado: string, senha: string) {
    return app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login: loginDigitado, senha },
    });
  }

  function me(token: string) {
    return app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  /**
   * Edição atual com a F01 (turmas A e B, mínimo 2) e a F02. Maria (GES777) está na turma A da
   * F01 e da F02, sem grupo; Bia e Caio estão no grupo 1 da F01, turma A.
   */
  async function cenario() {
    const edicao = await criarEdicao(app.prisma);
    const f01 = await criarFisica(app.prisma, edicao.id);
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const maria = await criarAluno(app.prisma, '777', 'Maria Souza');
    await inscrever(app.prisma, { alunoId: maria.id, fisicaId: f01.id, turmaId: f01.turmas.A! });
    await inscrever(app.prisma, { alunoId: maria.id, fisicaId: f02.id, turmaId: f02.turmas.A! });
    const bia = await criarAluno(app.prisma, '201', 'Bia Lopes');
    const caio = await criarAluno(app.prisma, '202', 'Caio Reis');
    for (const aluno of [bia, caio]) {
      await inscrever(app.prisma, { alunoId: aluno.id, fisicaId: f01.id, turmaId: f01.turmas.A! });
    }
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [bia.id, caio.id],
    });
    const admin = await criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
    return { edicao, f01, f02, maria, bia, grupo, admin };
  }

  const dadosDaMaria = { curso: 'GES', matricula: '777', nome: 'Maria Souza', turma: 'A' };

  describe('caminho feliz', () => {
    it('troca o nome: a senha muda e a sessão aberta continua valendo', async () => {
      const { f01, maria, admin } = await cenario();
      const { token } = (await login('GES777', 'maria')).json<{ token: string }>();

      const resposta = await editar(
        f01.id,
        maria.id,
        { ...dadosDaMaria, nome: 'Mariana Souza' },
        admin,
      );

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<AlunoDaEdicao>()).toEqual({
        id: maria.id,
        nome: 'Mariana Souza',
        curso: 'GES',
        matricula: '777',
        fisica: { id: f01.id, codigo: 'F01' },
        turma: 'A',
        grupo: null,
        status: 'sem-grupo',
      });
      expect((await login('GES777', 'mariana')).statusCode).toBe(200);
      expect((await login('GES777', 'maria')).statusCode).toBe(401);
      expect((await me(token)).statusCode).toBe(200);
    });

    it('troca curso e matrícula: o login muda e a sessão aberta continua valendo', async () => {
      const { f01, maria, admin } = await cenario();
      const { token } = (await login('GES777', 'maria')).json<{ token: string }>();

      const resposta = await editar(
        f01.id,
        maria.id,
        { ...dadosDaMaria, curso: 'gec', matricula: '9 99' },
        admin,
      );

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<AlunoDaEdicao>()).toMatchObject({ curso: 'GEC', matricula: '999' });
      expect((await login('GEC999', 'maria')).statusCode).toBe(200);
      expect((await login('GES777', 'maria')).statusCode).toBe(401);
      expect((await me(token)).statusCode).toBe(200);
    });

    it('nome, curso e matrícula mudam em todas as Físicas; a turma, só nesta', async () => {
      const { f01, maria, admin } = await cenario();

      await editar(f01.id, maria.id, { ...dadosDaMaria, nome: 'Mariana Souza', turma: 'B' }, admin);

      const lista = (
        await requisicaoComo(app, { method: 'GET', url: '/admin/alunos?busca=mariana' }, admin)
      ).json<AlunosDaEdicao>();
      expect(lista.alunos.map((linha) => [linha.nome, linha.fisica.codigo, linha.turma])).toEqual([
        ['Mariana Souza', 'F01', 'B'],
        ['Mariana Souza', 'F02', 'A'],
      ]);
    });

    it('sem mudar nada, responde 200 e não mexe no cadastro', async () => {
      const { f01, maria, admin } = await cenario();

      const resposta = await editar(f01.id, maria.id, dadosDaMaria, admin);

      expect(resposta.statusCode).toBe(200);
      const depois = await app.prisma.usuario.findUniqueOrThrow({ where: { id: maria.id } });
      expect(depois.senhaHash).toBe(maria.senhaHash);
      expect(depois.atualizadoEm).toEqual(maria.atualizadoEm);
    });

    it('aluno em grupo pode mudar o nome, mantendo a turma', async () => {
      const { f01, bia, grupo, admin } = await cenario();

      const resposta = await editar(
        f01.id,
        bia.id,
        { curso: 'GES', matricula: '201', nome: 'Beatriz Lopes', turma: 'A' },
        admin,
      );

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<AlunoDaEdicao>()).toMatchObject({
        nome: 'Beatriz Lopes',
        grupo: { id: grupo.id, numero: 1 },
        status: 'formado',
      });
    });
  });

  describe('erros', () => {
    it('responde 409 ALUNO_EM_GRUPO ao trocar a turma de quem está num grupo', async () => {
      const { f01, bia, admin } = await cenario();

      const resposta = await editar(
        f01.id,
        bia.id,
        { curso: 'GES', matricula: '201', nome: 'Beatriz Lopes', turma: 'B' },
        admin,
      );

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'ALUNO_EM_GRUPO',
        mensagem: 'Tire o aluno do grupo antes de trocar a turma.',
      });
      const depois = await app.prisma.usuario.findUniqueOrThrow({ where: { id: bia.id } });
      expect(depois.nome).toBe('Bia Lopes');
    });

    it('responde 409 LOGIN_EXISTENTE se curso + matrícula são de outro aluno', async () => {
      const { f01, maria, admin } = await cenario();

      const resposta = await editar(f01.id, maria.id, { ...dadosDaMaria, matricula: '201' }, admin);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'LOGIN_EXISTENTE',
        mensagem: 'Já existe um cadastro com o login GES201.',
      });
    });

    it('responde 409 LOGIN_EXISTENTE se curso + matrícula formam o login de um admin', async () => {
      const { f01, maria, admin } = await cenario();
      await criarUsuario(app.prisma, { login: 'GES1', senha: 'segredo', papel: 'ADMIN' });

      const resposta = await editar(f01.id, maria.id, { ...dadosDaMaria, matricula: '1' }, admin);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta).codigo).toBe('LOGIN_EXISTENTE');
    });

    it('responde 400 para turma que não existe na Física', async () => {
      const { f01, maria, admin } = await cenario();

      const resposta = await editar(f01.id, maria.id, { ...dadosDaMaria, turma: 'Z' }, admin);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toEqual([
        { campo: 'turma', mensagem: 'A Física F01 não tem a turma Z. Turmas: A, B.' },
      ]);
    });

    it('responde 404 para aluno que não está nesta Física', async () => {
      const { f02, bia, admin } = await cenario();

      const resposta = await editar(
        f02.id,
        bia.id,
        { curso: 'GES', matricula: '201', nome: 'Bia Lopes', turma: 'A' },
        admin,
      );

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Aluno não encontrado nesta Física.',
      });
    });

    it('responde 404 para Física inexistente', async () => {
      const { maria, admin } = await cenario();

      const resposta = await editar(99999, maria.id, dadosDaMaria, admin);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta).mensagem).toBe('Física não encontrada.');
    });

    it('responde 404 para Física de uma edição anterior', async () => {
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

      const resposta = await editar(
        fAntiga.id,
        veterano.id,
        { curso: 'GES', matricula: '900', nome: 'Veterano', turma: 'A' },
        admin,
      );

      expect(resposta.statusCode).toBe(404);
    });

    it.each([
      ['sem nome', { ...dadosDaMaria, nome: undefined }, 'nome'],
      ['curso vazio', { ...dadosDaMaria, curso: ' ' }, 'curso'],
      ['turma longa demais', { ...dadosDaMaria, turma: 'A'.repeat(51) }, 'turma'],
    ])('responde 400 VALIDACAO %s', async (_caso, payload, campo) => {
      const { f01, maria, admin } = await cenario();

      const resposta = await editar(f01.id, maria.id, payload, admin);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
    });

    it('responde 400 VALIDACAO para alunoId inválido', async () => {
      const { f01, admin } = await cenario();

      const resposta = await editar(f01.id, 0, dadosDaMaria, admin);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toContainEqual(
        expect.objectContaining({ campo: 'alunoId' }),
      );
    });

    it('responde 403 para aluno e 401 sem token', async () => {
      const { f01, maria } = await cenario();

      expect((await editar(f01.id, maria.id, dadosDaMaria, maria)).statusCode).toBe(403);
      expect((await editar(f01.id, maria.id, dadosDaMaria)).statusCode).toBe(401);
    });
  });

  describe('concorrência', () => {
    it('o aluno entra num grupo enquanto o admin troca a turma dele: as duas coisas não passam', async () => {
      const { f01, maria, grupo, admin } = await cenario();

      const respostas = await Promise.all([
        requisicaoComo(app, { method: 'POST', url: `/grupos/${grupo.id}/entrar` }, maria),
        editar(f01.id, maria.id, { ...dadosDaMaria, turma: 'B' }, admin),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode).sort()).toEqual([200, 409]);
      const inscricao = await app.prisma.inscricao.findUniqueOrThrow({
        where: { alunoId_fisicaId: { alunoId: maria.id, fisicaId: f01.id } },
      });
      // Ou ela entrou no grupo (e continua na turma A), ou trocou de turma (e ficou sem grupo).
      expect([
        [grupo.id, f01.turmas.A],
        [null, f01.turmas.B],
      ]).toContainEqual([inscricao.grupoId, inscricao.turmaId]);
    });

    it('dois alunos de Físicas diferentes editados para o mesmo login: só um fica com ele', async () => {
      const { f01, f02, maria, admin } = await cenario();
      const joao = await criarAluno(app.prisma, '555', 'João Lima');
      await inscrever(app.prisma, { alunoId: joao.id, fisicaId: f02.id, turmaId: f02.turmas.B! });

      const respostas = await Promise.all([
        editar(f01.id, maria.id, { ...dadosDaMaria, matricula: '123' }, admin),
        editar(
          f02.id,
          joao.id,
          { curso: 'GES', matricula: '123', nome: 'João Lima', turma: 'B' },
          admin,
        ),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode).sort()).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('LOGIN_EXISTENTE');
      expect(await app.prisma.usuario.count({ where: { login: 'GES123' } })).toBe(1);
    });
  });
});
