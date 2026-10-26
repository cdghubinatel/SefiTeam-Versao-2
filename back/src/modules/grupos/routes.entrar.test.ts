import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
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
import type { grupoSchema, minhasFisicasSchema } from './schemas.js';

type Grupo = z.infer<typeof grupoSchema>;
type MinhasFisicas = z.infer<typeof minhasFisicasSchema>;

describe('POST /grupos/:grupoId/entrar', () => {
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

  function requisicao(opcoes: InjectOptions, usuario?: Usuario) {
    return requisicaoComo(app, opcoes, usuario);
  }

  function cenario(fisica: NovaFisica = {}) {
    return criarCenarioDeGrupos(app.prisma, fisica);
  }

  function entrar(grupoId: number | string, usuario?: Usuario) {
    return requisicao({ method: 'POST', url: `/grupos/${grupoId}/entrar` }, usuario);
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

  it('entra num grupo com vaga e o grupo passa a formado ao atingir o mínimo', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ minimoIntegrantes: 2 });
    const ana = await alunoNaF01('201', 'A', 'Ana');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [ana.id],
    });

    const resposta = await entrar(grupo.id, eu);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Grupo>()).toEqual({
      id: grupo.id,
      numero: 1,
      fisicaId: f01.id,
      formado: true,
      integrantes: [
        { id: ana.id, nome: 'Ana', curso: 'GES', matricula: '201', turma: 'A' },
        { id: eu.id, nome: 'Eu Mesmo', curso: 'GES', matricula: '100', turma: 'A' },
      ],
    });
    expect(await grupoDoAluno(eu, f01.id)).toBe(grupo.id);
  });

  it('o aluno passa a ver o grupo no dashboard e não pode mais entrar em outro', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const ana = await alunoNaF01('201', 'A');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [ana.id],
    });
    await entrar(grupo.id, eu);

    const minhas = await requisicao({ method: 'GET', url: '/fisicas/minhas' }, eu);
    const lista = await requisicao({ method: 'GET', url: `/fisicas/${f01.id}/grupos` }, eu);

    expect(minhas.json<MinhasFisicas>().fisicas[0]?.grupo?.id).toBe(grupo.id);
    expect(erroDa(lista).codigo).toBe('JA_EM_GRUPO');
  });

  it('entra na última vaga (fica exatamente no máximo)', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ maximoIntegrantes: 3 });
    const a1 = await alunoNaF01('201', 'A');
    const a2 = await alunoNaF01('202', 'A');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [a1.id, a2.id],
    });

    const resposta = await entrar(grupo.id, eu);

    expect(resposta.statusCode).toBe(200);
    expect(await quantidadeDeIntegrantes(grupo.id)).toBe(3);
  });

  it('com multiturma, entra num grupo de outra turma', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ multiturma: true });
    const daB = await alunoNaF01('301', 'B');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [daB.id],
    });

    const resposta = await entrar(grupo.id, eu);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json<Grupo>().integrantes.map((integrante) => integrante.turma)).toEqual([
      'B',
      'A',
    ]);
  });

  it('responde 409 PRAZO_ENCERRADO depois da data limite, sem entrar', async () => {
    const { edicao, f01, eu, alunoNaF01 } = await cenario();
    const ana = await alunoNaF01('201', 'A');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [ana.id],
    });
    await app.prisma.edicao.update({
      where: { id: edicao.id },
      data: { dataLimite: new Date(Date.now() - 1000) },
    });

    const resposta = await entrar(grupo.id, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'PRAZO_ENCERRADO',
      mensagem: 'O prazo para formar grupos já terminou.',
    });
    expect(await grupoDoAluno(eu, f01.id)).toBeNull();
  });

  it('responde 409 JA_EM_GRUPO se o aluno já está em outro grupo ou neste', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const ana = await alunoNaF01('201', 'A');
    const meu = await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [eu.id] });
    const outro = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 2,
      alunoIds: [ana.id],
    });

    for (const grupoId of [outro.id, meu.id]) {
      const resposta = await entrar(grupoId, eu);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'JA_EM_GRUPO',
        mensagem: 'Você já está em um grupo nesta Física.',
      });
    }
    expect(await grupoDoAluno(eu, f01.id)).toBe(meu.id);
    expect(await quantidadeDeIntegrantes(outro.id)).toBe(1);
  });

  it('responde 409 GRUPO_CHEIO num grupo com o máximo de integrantes', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ maximoIntegrantes: 2 });
    const a1 = await alunoNaF01('201', 'A');
    const a2 = await alunoNaF01('202', 'A');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [a1.id, a2.id],
    });

    const resposta = await entrar(grupo.id, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'GRUPO_CHEIO',
      mensagem: 'O grupo pode ter no máximo 2 integrantes.',
    });
    expect(await grupoDoAluno(eu, f01.id)).toBeNull();
  });

  it('responde 409 TURMA_DIFERENTE num grupo de outra turma (sem multiturma)', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const daB = await alunoNaF01('301', 'B');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [daB.id],
    });

    const resposta = await entrar(grupo.id, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'TURMA_DIFERENTE',
      mensagem: 'Este grupo só aceita alunos da mesma turma.',
    });
    expect(await grupoDoAluno(eu, f01.id)).toBeNull();
  });

  it('responde 404 para grupo inexistente, de edição inativa ou de Física sem inscrição', async () => {
    const { edicao, eu } = await cenario();
    const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
    const fAntiga = await criarFisica(app.prisma, antiga.id);
    await inscrever(app.prisma, {
      alunoId: eu.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });
    const colegaAntigo = await criarAluno(app.prisma, '500');
    await inscrever(app.prisma, {
      alunoId: colegaAntigo.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });
    const grupoAntigo = await criarGrupo(app.prisma, {
      fisicaId: fAntiga.id,
      numero: 1,
      alunoIds: [colegaAntigo.id],
    });
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const deOutra = await criarAluno(app.prisma, '400');
    await inscrever(app.prisma, {
      alunoId: deOutra.id,
      fisicaId: f02.id,
      turmaId: f02.turmas.A!,
    });
    const grupoDeOutraFisica = await criarGrupo(app.prisma, {
      fisicaId: f02.id,
      numero: 1,
      alunoIds: [deOutra.id],
    });

    for (const grupoId of [99999, grupoAntigo.id, grupoDeOutraFisica.id]) {
      const resposta = await entrar(grupoId, eu);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Grupo não encontrado.',
      });
    }
    expect(await quantidadeDeIntegrantes(grupoAntigo.id)).toBe(1);
    expect(await quantidadeDeIntegrantes(grupoDeOutraFisica.id)).toBe(1);
  });

  it.each(['abc', '0', '-1', '1.5'])(
    'responde 400 VALIDACAO para grupoId "%s"',
    async (grupoId) => {
      const { eu } = await cenario();

      const resposta = await entrar(grupoId, eu);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).codigo).toBe('VALIDACAO');
      expect(erroDa(resposta).detalhes).toContainEqual(
        expect.objectContaining({ campo: 'grupoId' }),
      );
    },
  );

  it('responde 403 para admin e 401 sem token', async () => {
    const { f01, alunoNaF01 } = await cenario();
    const ana = await alunoNaF01('201', 'A');
    const grupo = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [ana.id],
    });
    const admin = await criarUsuario(app.prisma, {
      email: 'admin@teste.local',
      senha: 'x',
      papel: 'ADMIN',
    });

    expect((await entrar(grupo.id, admin)).statusCode).toBe(403);
    expect((await entrar(grupo.id)).statusCode).toBe(401);
    expect(await quantidadeDeIntegrantes(grupo.id)).toBe(1);
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof entrar>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('dois alunos disputando a última vaga: só um entra', async () => {
      const { f01, eu, alunoNaF01 } = await cenario({ maximoIntegrantes: 3 });
      const a1 = await alunoNaF01('201', 'A');
      const a2 = await alunoNaF01('202', 'A');
      const outro = await alunoNaF01('203', 'A');
      const grupo = await criarGrupo(app.prisma, {
        fisicaId: f01.id,
        numero: 1,
        alunoIds: [a1.id, a2.id],
      });

      const respostas = await Promise.all([entrar(grupo.id, eu), entrar(grupo.id, outro)]);

      expect(codigos(respostas)).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('GRUPO_CHEIO');
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(3);
    });

    it('clique duplo do mesmo aluno: entra uma vez só', async () => {
      const { f01, eu, alunoNaF01 } = await cenario();
      const ana = await alunoNaF01('201', 'A');
      const grupo = await criarGrupo(app.prisma, {
        fisicaId: f01.id,
        numero: 1,
        alunoIds: [ana.id],
      });

      const respostas = await Promise.all([entrar(grupo.id, eu), entrar(grupo.id, eu)]);

      expect(codigos(respostas)).toEqual([200, 409]);
      expect(await quantidadeDeIntegrantes(grupo.id)).toBe(2);
    });

    it('o mesmo aluno criando e entrando ao mesmo tempo: só uma ação vale', async () => {
      const { f01, eu, alunoNaF01 } = await cenario({ minimoIntegrantes: 1 });
      const ana = await alunoNaF01('201', 'A');
      const grupo = await criarGrupo(app.prisma, {
        fisicaId: f01.id,
        numero: 1,
        alunoIds: [ana.id],
      });

      const respostas = await Promise.all([
        entrar(grupo.id, eu),
        requisicao(
          { method: 'POST', url: `/fisicas/${f01.id}/grupos`, payload: { colegas: [] } },
          eu,
        ),
      ]);

      const sucessos = respostas.filter((resposta) => resposta.statusCode < 300);
      expect(sucessos).toHaveLength(1);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('JA_EM_GRUPO');
      // Ficou no grupo da ação que venceu: o que ele criou ou o que já existia.
      const [, criacao] = respostas;
      const venceuCriar = criacao.statusCode === 201;
      expect(await grupoDoAluno(eu, f01.id)).toBe(
        venceuCriar ? criacao.json<Grupo>().id : grupo.id,
      );
    });
  });
});
