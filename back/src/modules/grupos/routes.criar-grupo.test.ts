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

describe('POST /fisicas/:fisicaId/grupos', () => {
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

  function criar(fisicaId: number, payload: unknown, usuario: Usuario) {
    return requisicao(
      { method: 'POST', url: `/fisicas/${fisicaId}/grupos`, payload: payload as object },
      usuario,
    );
  }

  /** Grupo de cada aluno na Física (null = sem grupo), direto do banco. */
  async function grupoDe(fisicaId: number, ...alunos: Usuario[]) {
    const inscricoes = await app.prisma.inscricao.findMany({
      where: { fisicaId, alunoId: { in: alunos.map((aluno) => aluno.id) } },
      select: { alunoId: true, grupoId: true },
    });
    return alunos.map(
      (aluno) => inscricoes.find((inscricao) => inscricao.alunoId === aluno.id)?.grupoId ?? null,
    );
  }

  function contarGrupos(fisicaId: number) {
    return app.prisma.grupo.count({ where: { fisicaId } });
  }

  it('cria com o mínimo exato: grupo 1, já formado, autor = quem cria', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ minimoIntegrantes: 2 });
    const ana = await alunoNaF01('201', 'A', 'Ana');

    const resposta = await criar(f01.id, { colegas: [ana.id] }, eu);

    expect(resposta.statusCode).toBe(201);
    const grupo = resposta.json<Grupo>();
    expect(grupo).toEqual({
      id: expect.any(Number) as number,
      numero: 1,
      fisicaId: f01.id,
      formado: true,
      integrantes: [
        { id: ana.id, nome: 'Ana', curso: 'GES', matricula: '201', turma: 'A' },
        { id: eu.id, nome: 'Eu Mesmo', curso: 'GES', matricula: '100', turma: 'A' },
      ],
    });
    const noBanco = await app.prisma.grupo.findUniqueOrThrow({ where: { id: grupo.id } });
    expect(noBanco.criadoPorId).toBe(eu.id);
    const inscricao = await app.prisma.inscricao.findFirstOrThrow({ where: { alunoId: eu.id } });
    expect(inscricao.entrouNoGrupoEm).toBeInstanceOf(Date);
  });

  it.each([
    ['sozinho, com mínimo 2', { minimoIntegrantes: 2 }, 0, 2],
    ['com 1 colega, com mínimo 3', { minimoIntegrantes: 3 }, 1, 3],
  ])(
    'responde 409 GRUPO_INCOMPLETO ao criar %s, sem criar nada',
    async (_caso, fisica, quantidadeDeColegas, minimo) => {
      const { f01, eu, alunoNaF01 } = await cenario(fisica);
      const colegas = [];
      for (let indice = 0; indice < quantidadeDeColegas; indice += 1) {
        colegas.push((await alunoNaF01(String(201 + indice), 'A')).id);
      }

      const resposta = await criar(f01.id, { colegas }, eu);

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'GRUPO_INCOMPLETO',
        mensagem: `O grupo precisa ter pelo menos ${minimo} integrantes. Selecione mais colegas.`,
      });
      expect(await contarGrupos(f01.id)).toBe(0);
      expect(await grupoDe(f01.id, eu)).toEqual([null]);
    },
  );

  it('cria sozinho (inclusive com o corpo vazio) quando o mínimo da Física é 1', async () => {
    const { f01, eu } = await cenario({ minimoIntegrantes: 1 });

    const resposta = await criar(f01.id, {}, eu);

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json<Grupo>()).toMatchObject({ formado: true, integrantes: [{ id: eu.id }] });
  });

  it('cria com colegas até o máximo, e eles entram no grupo', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ maximoIntegrantes: 3, minimoIntegrantes: 3 });
    const ana = await alunoNaF01('201', 'A', 'Ana');
    const bia = await alunoNaF01('202', 'A', 'Bia');

    const resposta = await criar(f01.id, { colegas: [bia.id, ana.id] }, eu);

    expect(resposta.statusCode).toBe(201);
    const grupo = resposta.json<Grupo>();
    expect(grupo.formado).toBe(true);
    expect(grupo.integrantes.map((integrante) => integrante.nome).sort()).toEqual([
      'Ana',
      'Bia',
      'Eu Mesmo',
    ]);
    expect(await grupoDe(f01.id, eu, ana, bia)).toEqual([grupo.id, grupo.id, grupo.id]);
  });

  it('o colega incluído vê o grupo no dashboard dele', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const ana = await alunoNaF01('201', 'A', 'Ana');
    await criar(f01.id, { colegas: [ana.id] }, eu);

    const resposta = await requisicao({ method: 'GET', url: '/fisicas/minhas' }, ana);

    expect(resposta.json<MinhasFisicas>().fisicas[0]?.grupo?.integrantes).toHaveLength(2);
  });

  it('recebe o menor número livre na Física', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ minimoIntegrantes: 1 });
    const ana = await alunoNaF01('201', 'A');
    const bia = await alunoNaF01('202', 'A');
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [ana.id] });
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 3, alunoIds: [bia.id] });

    const resposta = await criar(f01.id, { colegas: [] }, eu);

    expect(resposta.json<Grupo>().numero).toBe(2);
  });

  it('com multiturma, aceita colegas de outra turma', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ multiturma: true });
    const daB = await alunoNaF01('301', 'B');

    const resposta = await criar(f01.id, { colegas: [daB.id] }, eu);

    expect(resposta.statusCode).toBe(201);
  });

  it('responde 409 PRAZO_ENCERRADO depois da data limite, sem criar nada', async () => {
    const { edicao, f01, eu } = await cenario();
    await app.prisma.edicao.update({
      where: { id: edicao.id },
      data: { dataLimite: new Date(Date.now() - 1000) },
    });

    const resposta = await criar(f01.id, { colegas: [] }, eu);

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({
      erro: { codigo: 'PRAZO_ENCERRADO', mensagem: 'O prazo para formar grupos já terminou.' },
    });
    expect(await contarGrupos(f01.id)).toBe(0);
  });

  it('responde 409 JA_EM_GRUPO se quem cria já tem grupo', async () => {
    const { f01, eu } = await cenario();
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [eu.id] });

    const resposta = await criar(f01.id, { colegas: [] }, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'JA_EM_GRUPO',
      mensagem: 'Você já está em um grupo nesta Física.',
    });
  });

  it('responde 409 JA_EM_GRUPO com o nome do colega que já tem grupo, sem alterar nada', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const livre = await alunoNaF01('201', 'A', 'Livre');
    const ocupada = await alunoNaF01('202', 'A', 'Ocupada');
    const grupoExistente = await criarGrupo(app.prisma, {
      fisicaId: f01.id,
      numero: 1,
      alunoIds: [ocupada.id],
    });

    const resposta = await criar(f01.id, { colegas: [livre.id, ocupada.id] }, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'JA_EM_GRUPO',
      mensagem: 'Ocupada já está em um grupo nesta Física.',
    });
    expect(await grupoDe(f01.id, eu, livre, ocupada)).toEqual([null, null, grupoExistente.id]);
    expect(await contarGrupos(f01.id)).toBe(1);
  });

  it('responde 409 GRUPO_CHEIO com colegas demais', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ maximoIntegrantes: 3 });
    const colegas = [
      await alunoNaF01('201', 'A'),
      await alunoNaF01('202', 'A'),
      await alunoNaF01('203', 'A'),
    ];

    const resposta = await criar(f01.id, { colegas: colegas.map((colega) => colega.id) }, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'GRUPO_CHEIO',
      mensagem: 'O grupo pode ter no máximo 3 integrantes.',
    });
    expect(await contarGrupos(f01.id)).toBe(0);
  });

  it('responde 409 TURMA_DIFERENTE com colega de outra turma (sem multiturma)', async () => {
    const { f01, eu, alunoNaF01 } = await cenario();
    const daB = await alunoNaF01('301', 'B', 'Daniel');

    const resposta = await criar(f01.id, { colegas: [daB.id] }, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'TURMA_DIFERENTE',
      mensagem:
        'Daniel é de outra turma, e esta Física não aceita turmas diferentes no mesmo grupo.',
    });
    expect(await contarGrupos(f01.id)).toBe(0);
  });

  it('responde 409 LIMITE_DE_GRUPOS quando a Física já tem todos os grupos', async () => {
    const { f01, eu, alunoNaF01 } = await cenario({ quantidadeGrupos: 1, minimoIntegrantes: 1 });
    const ana = await alunoNaF01('201', 'A');
    await criarGrupo(app.prisma, { fisicaId: f01.id, numero: 1, alunoIds: [ana.id] });

    const resposta = await criar(f01.id, { colegas: [] }, eu);

    expect(resposta.statusCode).toBe(409);
    expect(erroDa(resposta)).toEqual({
      codigo: 'LIMITE_DE_GRUPOS',
      mensagem: 'Esta Física já atingiu o número máximo de grupos.',
    });
    expect(await grupoDe(f01.id, eu)).toEqual([null]);
  });

  it('responde 404 com colega inexistente ou inscrito em outra Física', async () => {
    const { edicao, f01, eu } = await cenario();
    const f02 = await criarFisica(app.prisma, edicao.id, { codigo: 'F02' });
    const deOutra = await criarAluno(app.prisma, '400');
    await inscrever(app.prisma, {
      alunoId: deOutra.id,
      fisicaId: f02.id,
      turmaId: f02.turmas.A!,
    });

    for (const colegaId of [99999, deOutra.id]) {
      const resposta = await criar(f01.id, { colegas: [colegaId] }, eu);

      expect(resposta.statusCode).toBe(404);
      expect(erroDa(resposta)).toEqual({
        codigo: 'NAO_ENCONTRADO',
        mensagem: 'Um dos colegas selecionados não está inscrito nesta Física.',
      });
    }
    expect(await contarGrupos(f01.id)).toBe(0);
  });

  it('responde 404 para Física de edição inativa ou sem inscrição', async () => {
    const { f01, eu } = await cenario();
    const antiga = await criarEdicao(app.prisma, { semestre: '2025/2', ativa: false });
    const fAntiga = await criarFisica(app.prisma, antiga.id);
    await inscrever(app.prisma, {
      alunoId: eu.id,
      fisicaId: fAntiga.id,
      turmaId: fAntiga.turmas.A!,
    });
    const naoInscrito = await criarAluno(app.prisma, '999');

    expect((await criar(fAntiga.id, { colegas: [] }, eu)).statusCode).toBe(404);
    expect((await criar(f01.id, { colegas: [] }, naoInscrito)).statusCode).toBe(404);
    expect(await contarGrupos(fAntiga.id)).toBe(0);
  });

  it('responde 400 VALIDACAO se quem cria está na lista de colegas', async () => {
    const { f01, eu } = await cenario();

    const resposta = await criar(f01.id, { colegas: [eu.id] }, eu);

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta)).toEqual({
      codigo: 'VALIDACAO',
      mensagem: 'Dados inválidos.',
      detalhes: [
        { campo: 'colegas', mensagem: 'Não inclua você mesmo: quem cria o grupo já entra nele.' },
      ],
    });
  });

  it.each([
    ['ids repetidos', { colegas: [5, 5] }],
    ['id zero', { colegas: [0] }],
    ['id não numérico', { colegas: ['abc'] }],
    ['mais de 50 colegas', { colegas: Array.from({ length: 51 }, (_, indice) => indice + 1) }],
    ['colegas que não é lista', { colegas: 5 }],
  ])('responde 400 VALIDACAO com %s', async (_caso, payload) => {
    const { f01, eu } = await cenario();

    const resposta = await criar(f01.id, payload, eu);

    expect(resposta.statusCode).toBe(400);
    expect(erroDa(resposta).codigo).toBe('VALIDACAO');
  });

  it('responde 400 sem corpo e 403 para admin', async () => {
    const { f01, eu } = await cenario();
    const admin = await criarUsuario(app.prisma, {
      email: 'admin@teste.local',
      senha: 'x',
      papel: 'ADMIN',
    });

    const semCorpo = await requisicao({ method: 'POST', url: `/fisicas/${f01.id}/grupos` }, eu);

    expect(semCorpo.statusCode).toBe(400);
    expect((await criar(f01.id, { colegas: [] }, admin)).statusCode).toBe(403);
  });

  describe('concorrência', () => {
    function codigos(respostas: Awaited<ReturnType<typeof criar>>[]) {
      return respostas.map((resposta) => resposta.statusCode).sort();
    }

    it('dois alunos criando o último grupo: só um consegue', async () => {
      const { f01, eu, alunoNaF01 } = await cenario({ quantidadeGrupos: 1, minimoIntegrantes: 1 });
      const outro = await alunoNaF01('201', 'A');

      const respostas = await Promise.all([
        criar(f01.id, { colegas: [] }, eu),
        criar(f01.id, { colegas: [] }, outro),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroDa(recusada).codigo).toBe('LIMITE_DE_GRUPOS');
      expect(await contarGrupos(f01.id)).toBe(1);
    });

    it('dois alunos incluindo o mesmo colega: ele fica em um grupo só', async () => {
      const { f01, eu, alunoNaF01 } = await cenario();
      const outro = await alunoNaF01('201', 'A');
      const disputado = await alunoNaF01('202', 'A');

      const respostas = await Promise.all([
        criar(f01.id, { colegas: [disputado.id] }, eu),
        criar(f01.id, { colegas: [disputado.id] }, outro),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      expect(await contarGrupos(f01.id)).toBe(1);
      const criado = respostas.find((resposta) => resposta.statusCode === 201)!.json<Grupo>();
      expect(await grupoDe(f01.id, disputado)).toEqual([criado.id]);
    });

    it('clique duplo do mesmo aluno: cria um grupo só', async () => {
      const { f01, eu } = await cenario({ minimoIntegrantes: 1 });

      const respostas = await Promise.all([
        criar(f01.id, { colegas: [] }, eu),
        criar(f01.id, { colegas: [] }, eu),
      ]);

      expect(codigos(respostas)).toEqual([201, 409]);
      expect(await contarGrupos(f01.id)).toBe(1);
    });
  });
});
