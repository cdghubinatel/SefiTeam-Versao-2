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
import type { grupoSchema } from './schemas.js';

type Grupo = z.infer<typeof grupoSchema>;

describe('POST /grupos/:grupoId/integrantes', () => {
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

  function adicionar(grupoId: number | string, payload: unknown, usuario?: Usuario) {
    return requisicaoComo(
      app,
      { method: 'POST', url: `/grupos/${grupoId}/integrantes`, payload: payload as object },
      usuario,
    );
  }

  function criarAdmin() {
    return criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  }

  /**
   * Cenário da F01 com o grupo 1 formado por "eu" (turma A) e Ana; Bia e Caio (turma A) e
   * Daniel (turma B) sem grupo. Máximo 3, salvo se indicado.
   */
  async function cenarioComGrupo(fisica: NovaFisica = {}) {
    const base = await criarCenarioDeGrupos(app.prisma, fisica);
    const ana = await base.alunoNaF01('201', 'A', 'Ana');
    const bia = await base.alunoNaF01('202', 'A', 'Bia');
    const caio = await base.alunoNaF01('203', 'A', 'Caio');
    const daniel = await base.alunoNaF01('301', 'B', 'Daniel');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: base.f01.id,
      numero: 1,
      alunoIds: [base.eu.id, ana.id],
    });
    return { ...base, ana, bia, caio, daniel, grupo };
  }

  /** Grupo do aluno na Física (null = sem grupo), direto do banco. */
  async function grupoDoAluno(aluno: Usuario, fisicaId: number) {
    const inscricao = await app.prisma.inscricao.findUniqueOrThrow({
      where: { alunoId_fisicaId: { alunoId: aluno.id, fisicaId } },
    });
    return inscricao.grupoId;
  }

  function quantidadeDeIntegrantes(grupoId: number) {
    return app.prisma.inscricao.count({ where: { grupoId } });
  }

  describe('como aluno integrante', () => {
    it('adiciona um colega, que aparece por último no grupo', async () => {
      const { f01, eu, ana, bia, grupo } = await cenarioComGrupo();

      const resposta = await adicionar(grupo.id, { alunos: [bia.id] }, eu);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<Grupo>()).toEqual({
        id: grupo.id,
        numero: 1,
        fisicaId: f01.id,
        formado: true,
        integrantes: [
          { id: eu.id, nome: 'Eu Mesmo', curso: 'GES', matricula: '100', turma: 'A' },
          { id: ana.id, nome: 'Ana', curso: 'GES', matricula: '201', turma: 'A' },
          { id: bia.id, nome: 'Bia', curso: 'GES', matricula: '202', turma: 'A' },
        ],
      });
      expect(await grupoDoAluno(bia, f01.id)).toBe(grupo.id);
    });

    it('qualquer integrante adiciona, não só quem criou; vários de uma vez, em ordem de nome', async () => {
      const { f01, ana, bia, caio, grupo } = await cenarioComGrupo({ maximoIntegrantes: 4 });

      const resposta = await adicionar(grupo.id, { alunos: [caio.id, bia.id] }, ana);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<Grupo>().integrantes.map((integrante) => integrante.nome)).toEqual([
        'Eu Mesmo',
        'Ana',
        'Bia',
        'Caio',
      ]);
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(4);
      expect(await grupoDoAluno(caio, f01.id)).toBe(grupo.id);
    });

    it('com multiturma, adiciona colega de outra turma', async () => {
      const { eu, daniel, grupo } = await cenarioComGrupo({ multiturma: true });

      const resposta = await adicionar(grupo.id, { alunos: [daniel.id] }, eu);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<Grupo>().integrantes.at(-1)?.turma).toBe('B');
    });

    it('o colega adicionado some da lista de colegas disponíveis', async () => {
      const { f01, eu, bia, grupo } = await cenarioComGrupo();
      await adicionar(grupo.id, { alunos: [bia.id] }, eu);

      const lista = await requisicaoComo(
        app,
        { method: 'GET', url: `/fisicas/${f01.id}/colegas-disponiveis` },
        eu,
      );

      expect(lista.json<{ id: number }[]>().map((colega) => colega.id)).not.toContain(bia.id);
    });

    it('responde 400 VALIDACAO se o aluno inclui a si mesmo, sem adicionar ninguém', async () => {
      const { f01, eu, bia, grupo } = await cenarioComGrupo();

      const resposta = await adicionar(grupo.id, { alunos: [bia.id, eu.id] }, eu);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta)).toEqual({
        codigo: 'VALIDACAO',
        mensagem: 'Dados inválidos.',
        detalhes: [
          {
            campo: 'alunos',
            mensagem: 'Não inclua você mesmo: informe só os colegas que vão entrar no grupo.',
          },
        ],
      });
      expect(await grupoDoAluno(bia, f01.id)).toBeNull();
    });

    it('o próprio id dá 400 antes de qualquer checagem, mesmo para quem não é integrante', async () => {
      const { f01, bia, grupo } = await cenarioComGrupo();

      const resposta = await adicionar(grupo.id, { alunos: [bia.id] }, bia);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toEqual([
        {
          campo: 'alunos',
          mensagem: 'Não inclua você mesmo: informe só os colegas que vão entrar no grupo.',
        },
      ]);
      expect(await grupoDoAluno(bia, f01.id)).toBeNull();
    });

    it('responde 404 se o aluno não é integrante (sem grupo ou de outro grupo)', async () => {
      const { f01, bia, caio, alunoNaF01, grupo } = await cenarioComGrupo();
      const outroGrupo = await alunoNaF01('204', 'A');
      await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 2, alunoIds: [outroGrupo.id] });

      for (const quem of [bia, outroGrupo]) {
        const resposta = await adicionar(grupo.id, { alunos: [caio.id] }, quem);

        expect(resposta.statusCode).toBe(404);
        expect(erroDa(resposta)).toEqual({
          codigo: 'NAO_ENCONTRADO',
          mensagem: 'Grupo não encontrado.',
        });
      }
      expect(await grupoDoAluno(caio, f01.id)).toBeNull();
    });

    it('responde 404 para grupo inexistente ou de edição inativa', async () => {
      const { eu } = await cenarioComGrupo();
      const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
      const fAntiga = await criarFisica(app.prisma, antiga.id);
      const colega = await criarAluno(app.prisma, '500');
      for (const aluno of [eu, colega]) {
        await inscrever(app.prisma, {
          alunoId: aluno.id,
          fisicaId: fAntiga.id,
          turmaId: fAntiga.turmas.A!,
        });
      }
      const grupoAntigo = await criarGrupo(app.prisma, {
        fisicaId: fAntiga.id,
        numero: 1,
        alunoIds: [eu.id],
      });

      for (const [grupoId, alunos] of [
        [99999, [colega.id]],
        [grupoAntigo.id, [colega.id]],
      ] as const) {
        const resposta = await adicionar(grupoId, { alunos }, eu);

        expect(resposta.statusCode).toBe(404);
        expect(erroDa(resposta).mensagem).toBe('Grupo não encontrado.');
      }
      expect(await quantidadeDeIntegrantes(grupoAntigo.id)).toBe(1);
    });

    it('responde 409 PRAZO_ENCERRADO depois da data limite', async () => {
      const { edicao, f01, eu, bia, grupo } = await cenarioComGrupo();
      await app.prisma.edicao.update({
        where: { id: edicao.id },
        data: { dataLimite: new Date(Date.now() - 1000) },
      });

      const resposta = await adicionar(grupo.id, { alunos: [bia.id] }, eu);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'PRAZO_ENCERRADO',
        mensagem: 'O prazo para formar grupos já terminou.',
      });
      expect(await grupoDoAluno(bia, f01.id)).toBeNull();
    });
  });

  describe('como admin', () => {
    it('adiciona a qualquer grupo, mesmo depois do prazo', async () => {
      const { edicao, f01, bia, grupo } = await cenarioComGrupo();
      await app.prisma.edicao.update({
        where: { id: edicao.id },
        data: { dataLimite: new Date(Date.now() - 1000) },
      });

      const resposta = await adicionar(grupo.id, { alunos: [bia.id] }, await criarAdmin());

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json<Grupo>().integrantes.map((integrante) => integrante.id)).toContain(
        bia.id,
      );
      expect(await grupoDoAluno(bia, f01.id)).toBe(grupo.id);
    });

    it('adiciona num grupo de edição inativa', async () => {
      const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
      const fAntiga = await criarFisica(app.prisma, antiga.id);
      const [a1, a2] = [await criarAluno(app.prisma, '500'), await criarAluno(app.prisma, '501')];
      for (const aluno of [a1, a2]) {
        await inscrever(app.prisma, {
          alunoId: aluno.id,
          fisicaId: fAntiga.id,
          turmaId: fAntiga.turmas.A!,
        });
      }
      const grupo = await criarGrupo(app.prisma, {
        fisicaId: fAntiga.id,
        numero: 1,
        alunoIds: [a1.id],
      });

      const resposta = await adicionar(grupo.id, { alunos: [a2.id] }, await criarAdmin());

      expect(resposta.statusCode).toBe(200);
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(2);
    });

    it('responde 404 para grupo inexistente', async () => {
      const { bia } = await cenarioComGrupo();

      const resposta = await adicionar(99999, { alunos: [bia.id] }, await criarAdmin());

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Grupo não encontrado.',
      });
    });
  });

  describe.each([
    ['aluno integrante', 'eu'],
    ['admin', 'admin'],
  ] as const)('regras comuns, como %s', (_papel, quem) => {
    async function cenarioComAutor(fisica: NovaFisica = {}) {
      const dados = await cenarioComGrupo(fisica);
      const autor = quem === 'admin' ? await criarAdmin() : dados.eu;
      return { ...dados, autor };
    }

    it('enche até exatamente o máximo', async () => {
      const { bia, grupo, autor } = await cenarioComAutor({ maximoIntegrantes: 3 });

      const resposta = await adicionar(grupo.id, { alunos: [bia.id] }, autor);

      expect(resposta.statusCode).toBe(200);
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(3);
    });

    it('responde 409 GRUPO_CHEIO se os novos passam do máximo, sem adicionar ninguém', async () => {
      const { f01, bia, caio, grupo, autor } = await cenarioComAutor({ maximoIntegrantes: 3 });

      const resposta = await adicionar(grupo.id, { alunos: [bia.id, caio.id] }, autor);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'GRUPO_CHEIO',
        mensagem: 'O grupo pode ter no máximo 3 integrantes.',
      });
      expect(await grupoDoAluno(bia, f01.id)).toBeNull();
    });

    it('responde 404 se um aluno não está inscrito nesta Física', async () => {
      const { edicao, f01, bia, grupo, autor } = await cenarioComAutor({ maximoIntegrantes: 4 });
      const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
      const deOutraFisica = await criarAluno(app.prisma, '400');
      await inscrever(app.prisma, {
        alunoId: deOutraFisica.id,
        fisicaId: f02.id,
        turmaId: f02.turmas.A!,
      });

      const resposta = await adicionar(grupo.id, { alunos: [bia.id, deOutraFisica.id] }, autor);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Um dos alunos selecionados não está inscrito nesta Física.',
      });
      expect(await grupoDoAluno(bia, f01.id)).toBeNull();
    });

    it('responde 409 JA_EM_GRUPO se um aluno já tem grupo (inclusive este)', async () => {
      const { f01, ana, bia, caio, grupo, autor } = await cenarioComAutor({
        maximoIntegrantes: 4,
      });
      await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 2, alunoIds: [caio.id] });

      for (const [alunos, nome] of [
        [[bia.id, caio.id], 'Caio'],
        [[ana.id], 'Ana'],
      ] as const) {
        const resposta = await adicionar(grupo.id, { alunos }, autor);

        expect(resposta.statusCode).toBe(409);
        expect(erroDa(resposta)).toEqual({
          codigo: 'JA_EM_GRUPO',
          mensagem: `${nome} já está em um grupo nesta Física.`,
        });
      }
      expect(await grupoDoAluno(bia, f01.id)).toBeNull();
    });

    it('responde 409 TURMA_DIFERENTE para aluno de outra turma (sem multiturma)', async () => {
      const { f01, daniel, grupo, autor } = await cenarioComAutor();

      const resposta = await adicionar(grupo.id, { alunos: [daniel.id] }, autor);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'TURMA_DIFERENTE',
        mensagem:
          'Daniel é de outra turma, e esta Física não aceita turmas diferentes no mesmo grupo.',
      });
      expect(await grupoDoAluno(daniel, f01.id)).toBeNull();
    });
  });

  describe('validação e acesso', () => {
    it.each([
      ['lista vazia', { alunos: [] }],
      ['sem o campo', {}],
      ['ids repetidos', { alunos: [7, 7] }],
      ['id inválido', { alunos: [0] }],
      ['mais de 50 ids', { alunos: Array.from({ length: 51 }, (_, indice) => indice + 1) }],
    ])('responde 400 VALIDACAO para %s', async (_caso, payload) => {
      const { eu, grupo } = await cenarioComGrupo();

      const resposta = await adicionar(grupo.id, payload, eu);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
      expect(erroDa(resposta).detalhes).toContainEqual(
        expect.objectContaining({ campo: expect.stringMatching(/^alunos/) as string }),
      );
    });

    it('ids repetidos têm mensagem própria', async () => {
      const { eu, grupo } = await cenarioComGrupo();

      const resposta = await adicionar(grupo.id, { alunos: [7, 7] }, eu);

      expect(erroDa(resposta).detalhes).toContainEqual({
        campo: 'alunos',
        mensagem: 'A lista não pode ter ids repetidos.',
      });
    });

    it.each(['abc', '0', '-1', '1.5'])('responde 400 VALIDACAO para grupoId "%s"', async (id) => {
      const { eu, bia } = await cenarioComGrupo();

      const resposta = await adicionar(id, { alunos: [bia.id] }, eu);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toContainEqual(
        expect.objectContaining({ campo: 'grupoId' }),
      );
    });

    it('responde 401 sem token', async () => {
      const { bia, grupo } = await cenarioComGrupo();

      expect((await adicionar(grupo.id, { alunos: [bia.id] })).statusCode).toBe(401);
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(2);
    });
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof adicionar>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('dois integrantes disputando a última vaga com colegas diferentes: só um entra', async () => {
      const { eu, ana, bia, caio, grupo } = await cenarioComGrupo({ maximoIntegrantes: 3 });

      const respostas = await Promise.all([
        adicionar(grupo.id, { alunos: [bia.id] }, eu),
        adicionar(grupo.id, { alunos: [caio.id] }, ana),
      ]);

      expect(codigos(respostas)).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('GRUPO_CHEIO');
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(3);
    });

    it('o mesmo colega adicionado a dois grupos ao mesmo tempo: fica em um só', async () => {
      const { f01, eu, bia, alunoNaF01, grupo } = await cenarioComGrupo();
      const outro = await alunoNaF01('204', 'A');
      const outroGrupo = await criarGrupo(app.prisma, {
        fisicaId: f01.id,
        numero: 2,
        alunoIds: [outro.id],
      });

      const respostas = await Promise.all([
        adicionar(grupo.id, { alunos: [bia.id] }, eu),
        adicionar(outroGrupo.id, { alunos: [bia.id] }, outro),
      ]);

      expect(codigos(respostas)).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('JA_EM_GRUPO');
      expect([grupo.id, outroGrupo.id]).toContain(await grupoDoAluno(bia, f01.id));
    });

    it('admin adicionando enquanto um aluno entra na última vaga: só um fica', async () => {
      const { bia, caio, grupo } = await cenarioComGrupo({ maximoIntegrantes: 3 });
      const admin = await criarAdmin();

      const respostas = await Promise.all([
        adicionar(grupo.id, { alunos: [bia.id] }, admin),
        requisicaoComo(app, { method: 'POST', url: `/grupos/${grupo.id}/entrar` }, caio),
      ]);

      expect(codigos(respostas)).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('GRUPO_CHEIO');
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(3);
    });

    it('clique duplo: o colega entra uma vez só', async () => {
      const { eu, bia, grupo } = await cenarioComGrupo({ maximoIntegrantes: 4 });

      const respostas = await Promise.all([
        adicionar(grupo.id, { alunos: [bia.id] }, eu),
        adicionar(grupo.id, { alunos: [bia.id] }, eu),
      ]);

      expect(codigos(respostas)).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('JA_EM_GRUPO');
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(3);
    });
  });
});
