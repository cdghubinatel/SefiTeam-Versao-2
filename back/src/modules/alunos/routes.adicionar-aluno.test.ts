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
  type NovaFisica,
} from '../../test/db.js';
import { erroDa, requisicaoComo } from '../../test/http.js';
import type { alunoDaEdicaoSchema } from './schemas.js';

type AlunoDaEdicao = z.infer<typeof alunoDaEdicaoSchema>;

const UM_ANO = 365 * 24 * 60 * 60 * 1000;

describe('POST /admin/fisicas/:fisicaId/alunos', () => {
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

  function adicionar(fisicaId: number, payload: object, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'POST', url: `/admin/fisicas/${fisicaId}/alunos`, payload },
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

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  const maria = { curso: 'GES', matricula: '777', nome: 'Maria Souza', turma: 'A' };

  /** Edição atual (ativa) com a F01 (turmas A e B) e o admin. */
  async function cenario(fisica: NovaFisica = {}) {
    const edicao = await criarEdicao(app.prisma);
    const f01 = await criarFisica(app.prisma, edicao.id, fisica);
    return { edicao, f01, admin: await criarAdmin() };
  }

  describe('caminho feliz', () => {
    it('cadastra o aluno novo, inscreve na turma e ele já consegue entrar', async () => {
      const { f01, admin } = await cenario();

      const resposta = await adicionar(f01.id, maria, admin);

      expect(resposta.statusCode).toBe(201);
      const linha = resposta.json<AlunoDaEdicao>();
      expect(linha).toEqual({
        id: expect.any(Number) as number,
        nome: 'Maria Souza',
        curso: 'GES',
        matricula: '777',
        fisica: { id: f01.id, codigo: 'F01' },
        turma: 'A',
        grupo: null,
        status: 'sem-grupo',
      });
      expect((await login('GES777', 'maria')).statusCode).toBe(200);
    });

    it('normaliza como a planilha: curso e matrícula sem espaços, turma em maiúsculas', async () => {
      const { f01, admin } = await cenario();

      const resposta = await adicionar(
        f01.id,
        { curso: ' ges ', matricula: ' 7 77 ', nome: '  Maria   Souza ', turma: 'b' },
        admin,
      );

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json<AlunoDaEdicao>()).toMatchObject({
        nome: 'Maria Souza',
        curso: 'GES',
        matricula: '777',
        turma: 'B',
      });
    });

    it('vale na edição atual mesmo finalizada e depois do prazo (o admin não tem prazo)', async () => {
      const edicao = await criarEdicao(app.prisma, {
        ativa: false,
        dataLimite: new Date(Date.now() - 1000),
      });
      const f01 = await criarFisica(app.prisma, edicao.id);

      const resposta = await adicionar(f01.id, maria, await criarAdmin());

      expect(resposta.statusCode).toBe(201);
    });
  });

  describe('aluno já cadastrado (mesmo curso + matrícula)', () => {
    /** Maria com outro nome, já inscrita na F02 (outra Física), e o token dela. */
    async function mariaJaCadastrada(nome: string) {
      const dados = await cenario();
      const f02 = await criarFisica(app.prisma, dados.edicao.id, { codigo: 'F02' });
      const existente = await criarUsuario(app.prisma, {
        login: 'GES777',
        senha: nome.split(' ')[0]!.toUpperCase(),
        nome,
        curso: 'GES',
        matricula: '777',
      });
      await inscrever(app.prisma, {
        alunoId: existente.id,
        fisicaId: f02.id,
        turmaId: f02.turmas.A!,
      });
      const token = (await login('GES777', nome.split(' ')[0]!)).json<{ token: string }>().token;
      return { ...dados, existente, token };
    }

    it('reaproveita o cadastro, atualiza o nome e a senha e não desloga', async () => {
      const { f01, admin, existente, token } = await mariaJaCadastrada('Mariana Souza');

      const resposta = await adicionar(f01.id, maria, admin);

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json<AlunoDaEdicao>()).toMatchObject({
        id: existente.id,
        nome: 'Maria Souza',
      });
      expect(await app.prisma.usuario.count()).toBe(2);
      expect((await login('GES777', 'maria')).statusCode).toBe(200);
      expect((await login('GES777', 'mariana')).statusCode).toBe(401);
      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
    });

    it('com o mesmo nome, não mexe no cadastro', async () => {
      const { f01, admin, existente } = await mariaJaCadastrada('Maria Souza');

      expect((await adicionar(f01.id, maria, admin)).statusCode).toBe(201);

      const depois = await app.prisma.usuario.findUniqueOrThrow({ where: { id: existente.id } });
      expect(depois.senhaHash).toBe(existente.senhaHash);
      expect(depois.atualizadoEm).toEqual(existente.atualizadoEm);
    });

    it('responde 409 JA_INSCRITO se ele já está nesta Física', async () => {
      const { f01, admin } = await cenario();
      await adicionar(f01.id, maria, admin);

      const resposta = await adicionar(f01.id, { ...maria, turma: 'B' }, admin);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'JA_INSCRITO',
        mensagem: 'Este aluno já está nesta Física.',
      });
    });

    it('recusa o login de um administrador', async () => {
      const { f01, admin } = await cenario();
      await criarUsuario(app.prisma, { login: 'GES777', senha: 'segredo', papel: 'ADMIN' });

      const resposta = await adicionar(f01.id, maria, admin);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toEqual([
        { campo: 'matricula', mensagem: 'GES777 é o login de um administrador.' },
      ]);
    });
  });

  describe('erros', () => {
    it('responde 400 para turma que não existe na Física, com as turmas válidas', async () => {
      const { f01, admin } = await cenario();

      const resposta = await adicionar(f01.id, { ...maria, turma: 'Z' }, admin);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toEqual([
        { campo: 'turma', mensagem: 'A Física F01 não tem a turma Z. Turmas: A, B.' },
      ]);
      expect(await app.prisma.usuario.count({ where: { login: 'GES777' } })).toBe(0);
    });

    it('responde 409 FISICA_LOTADA quando grupos × máximo já estão preenchidos', async () => {
      const { f01, admin } = await cenario({ quantidadeGrupos: 1, maximoIntegrantes: 2 });
      for (const matricula of ['1', '2']) {
        const aluno = await criarAluno(app.prisma, matricula);
        await inscrever(app.prisma, {
          alunoId: aluno.id,
          fisicaId: f01.id,
          turmaId: f01.turmas.A!,
        });
      }

      const resposta = await adicionar(f01.id, maria, admin);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'FISICA_LOTADA',
        mensagem: 'A Física já tem 2 alunos, o que cabe em 1 grupos de até 2 integrantes.',
      });
    });

    it('responde 404 para Física inexistente', async () => {
      const { admin } = await cenario();

      const resposta = await adicionar(99999, maria, admin);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Física não encontrada.',
      });
    });

    it('responde 404 para Física de uma edição que não é a última criada, mesmo ativa', async () => {
      const antiga = await criarEdicao(app.prisma, {
        semestre: '2025/2',
        ativa: true,
        criadoEm: new Date(Date.now() - UM_ANO),
      });
      const fAntiga = await criarFisica(app.prisma, antiga.id);
      await criarEdicao(app.prisma, { semestre: '2026/1', ativa: false });

      const resposta = await adicionar(fAntiga.id, maria, await criarAdmin());

      expect(resposta.statusCode).toBe(404);
    });

    it.each([
      ['sem nome', { ...maria, nome: undefined }, 'nome'],
      ['nome só com espaços', { ...maria, nome: '   ' }, 'nome'],
      ['sem curso', { ...maria, curso: undefined }, 'curso'],
      ['matrícula vazia', { ...maria, matricula: '' }, 'matricula'],
      ['sem turma', { ...maria, turma: undefined }, 'turma'],
    ])('responde 400 VALIDACAO %s', async (_caso, payload, campo) => {
      const { f01, admin } = await cenario();

      const resposta = await adicionar(f01.id, payload, admin);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toContainEqual(expect.objectContaining({ campo }));
    });

    it('responde 400 VALIDACAO para fisicaId inválido', async () => {
      const resposta = await adicionar(0, maria, await criarAdmin());

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toContainEqual(
        expect.objectContaining({ campo: 'fisicaId' }),
      );
    });

    it('responde 403 para aluno e 401 sem token', async () => {
      const { f01 } = await cenario();
      const aluno = await criarAluno(app.prisma, '100');

      expect((await adicionar(f01.id, maria, aluno)).statusCode).toBe(403);
      expect((await adicionar(f01.id, maria)).statusCode).toBe(401);
      expect(await app.prisma.inscricao.count()).toBe(0);
    });
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof adicionar>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('dois alunos disputando a última vaga da Física: só um entra', async () => {
      const { f01, admin } = await cenario({ quantidadeGrupos: 1, maximoIntegrantes: 2 });
      const aluno = await criarAluno(app.prisma, '1');
      await inscrever(app.prisma, { alunoId: aluno.id, fisicaId: f01.id, turmaId: f01.turmas.A! });

      const respostas = await Promise.all([
        adicionar(f01.id, maria, admin),
        adicionar(f01.id, { ...maria, matricula: '778', nome: 'Paulo Lima' }, admin),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('FISICA_LOTADA');
      expect(await app.prisma.inscricao.count({ where: { fisicaId: f01.id } })).toBe(2);
    });

    it('clique duplo: o aluno entra uma vez só', async () => {
      const { f01, admin } = await cenario();

      const respostas = await Promise.all([
        adicionar(f01.id, maria, admin),
        adicionar(f01.id, maria, admin),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      expect(await app.prisma.usuario.count({ where: { login: 'GES777' } })).toBe(1);
      expect(await app.prisma.inscricao.count({ where: { fisicaId: f01.id } })).toBe(1);
    });

    it('o mesmo aluno novo em duas Físicas ao mesmo tempo: um cadastro, duas inscrições', async () => {
      const { edicao, f01, admin } = await cenario();
      const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });

      const respostas = await Promise.all([
        adicionar(f01.id, maria, admin),
        adicionar(f02.id, maria, admin),
      ]);

      expect(codigos(respostas)).toEqual([201, 201]);
      expect(await app.prisma.usuario.count({ where: { login: 'GES777' } })).toBe(1);
      expect(await app.prisma.inscricao.count()).toBe(2);
    });
  });
});
