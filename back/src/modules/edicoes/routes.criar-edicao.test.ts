import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { buildApp } from '../../app.js';
import type { Usuario } from '../../generated/prisma/client.js';
import { criarAluno, criarEdicao, criarUsuario, limparBanco } from '../../test/db.js';
import { erroDa, requisicaoComo, tokenDe } from '../../test/http.js';
import type { AlunoDaPlanilha, edicaoCriadaSchema, FisicaDaPlanilha } from './schemas.js';

type EdicaoCriada = z.infer<typeof edicaoCriadaSchema>;

const UM_DIA = 24 * 60 * 60 * 1000;

/** Data (AAAA-MM-DD) daqui a `dias` dias, no horário de Brasília, como o front envia. */
function dia(dias: number) {
  return new Date(Date.now() + dias * UM_DIA).toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo',
  });
}

function aluno(matricula: string, nome: string, turma = 'A'): AlunoDaPlanilha {
  return { curso: 'GES', matricula, nome, turma };
}

function fisica(codigo: string, alunos: AlunoDaPlanilha[], dados: Partial<FisicaDaPlanilha> = {}) {
  return {
    codigo,
    quantidadeGrupos: 5,
    minimoIntegrantes: 2,
    maximoIntegrantes: 4,
    multiturma: false,
    alunos,
    ...dados,
  };
}

describe('POST /admin/edicoes', () => {
  let app: FastifyInstance;
  let admin: Usuario;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    await limparBanco(app.prisma);
    admin = await criarUsuario(app.prisma, { login: 'ADMIN', senha: 'x', papel: 'ADMIN' });
  });

  afterAll(async () => {
    await app.close();
  });

  function criar(payload: unknown, usuario: Usuario = admin) {
    return requisicaoComo(
      app,
      { method: 'POST', url: '/admin/edicoes', payload: payload as object },
      usuario,
    );
  }

  function login(login: string, senha: string) {
    return app.inject({ method: 'POST', url: '/auth/login', payload: { login, senha } });
  }

  const quantidades = async () => ({
    edicoes: await app.prisma.edicao.count(),
    usuarios: await app.prisma.usuario.count(),
    inscricoes: await app.prisma.inscricao.count(),
  });

  it('cria a edição ativa com as Físicas, as turmas, os alunos e as inscrições', async () => {
    const dataLimite = dia(10);

    const resposta = await criar({
      dataLimite,
      fisicas: [
        fisica(
          'Fis1',
          [aluno('1', 'Maria Souza'), aluno('2', 'João Pereira', 'B'), aluno('3', 'Ana Lima')],
          { multiturma: true },
        ),
        fisica('Fis2', [aluno('1', 'Maria Souza', 'C'), aluno('4', 'Bia Reis', 'C')]),
      ],
    });

    expect(resposta.statusCode).toBe(201);
    const criada = resposta.json<EdicaoCriada>();
    expect(criada).toEqual({
      edicao: {
        id: expect.any(Number) as number,
        semestre: `${dataLimite.slice(0, 4)}/${Number(dataLimite.slice(5, 7)) <= 6 ? 1 : 2}`,
        dataLimite: new Date(`${dataLimite}T23:59:59.999-03:00`).toISOString(),
        ativa: true,
      },
      fisicas: [
        {
          id: expect.any(Number) as number,
          codigo: 'Fis1',
          nome: 'Física 1',
          quantidadeGrupos: 5,
          minimoIntegrantes: 2,
          maximoIntegrantes: 4,
          multiturma: true,
          alunos: 3,
          turmas: [
            { codigo: 'A', alunos: 2 },
            { codigo: 'B', alunos: 1 },
          ],
        },
        {
          id: expect.any(Number) as number,
          codigo: 'Fis2',
          nome: 'Física 2',
          quantidadeGrupos: 5,
          minimoIntegrantes: 2,
          maximoIntegrantes: 4,
          multiturma: false,
          alunos: 2,
          turmas: [{ codigo: 'C', alunos: 2 }],
        },
      ],
      alunos: { novos: 4, reaproveitados: 0 },
      edicaoFinalizada: null,
    });

    const maria = await app.prisma.usuario.findUniqueOrThrow({
      where: { login: 'GES1' },
      include: { inscricoes: { include: { fisica: true, turma: true } } },
    });
    expect(maria).toMatchObject({
      nome: 'Maria Souza',
      papel: 'ALUNO',
      curso: 'GES',
      matricula: '1',
    });
    expect(
      maria.inscricoes
        .map((inscricao) => `${inscricao.fisica.codigo}-${inscricao.turma.codigo}`)
        .sort(),
    ).toEqual(['Fis1-A', 'Fis2-C']);
    expect(await app.prisma.inscricao.count()).toBe(5);
  });

  it('o aluno cadastrado entra com curso + matrícula e o primeiro nome', async () => {
    await criar({ dataLimite: dia(10), fisicas: [fisica('Fis1', [aluno('589', 'João Pereira')])] });

    const resposta = await login('GES589', 'joao');

    expect(resposta.statusCode).toBe(200);
  });

  it('normaliza curso, matrícula, nome e turma como o login é montado', async () => {
    const resposta = await criar({
      dataLimite: dia(10),
      fisicas: [
        fisica('Fis1', [
          { curso: ' ges ', matricula: ' 5 89 ', nome: ' Ana   Lima ', turma: ' a ' },
        ]),
      ],
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json<EdicaoCriada>().fisicas[0]!.turmas).toEqual([{ codigo: 'A', alunos: 1 }]);
    expect(
      await app.prisma.usuario.findUniqueOrThrow({ where: { login: 'GES589' } }),
    ).toMatchObject({ curso: 'GES', matricula: '589', nome: 'Ana Lima' });
  });

  it('a data limite de hoje é aceita (vale até 23:59)', async () => {
    const resposta = await criar({
      dataLimite: dia(0),
      fisicas: [fisica('Fis1', [aluno('1', 'Ana')])],
    });

    expect(resposta.statusCode).toBe(201);
  });

  it('finaliza a edição que estava ativa', async () => {
    const anterior = await criarEdicao(app.prisma, { semestre: '2020/1' });

    const resposta = await criar({
      dataLimite: dia(10),
      fisicas: [fisica('Fis1', [aluno('1', 'Ana')])],
    });

    expect(resposta.statusCode).toBe(201);
    const criada = resposta.json<EdicaoCriada>();
    expect(criada.edicaoFinalizada).toEqual({ id: anterior.id, semestre: '2020/1' });
    expect(
      await app.prisma.edicao.findMany({ where: { ativa: true }, select: { id: true } }),
    ).toEqual([{ id: criada.edicao.id }]);
  });

  describe('alunos de edições anteriores', () => {
    it('reaproveita o aluno e atualiza o nome e a senha, sem deslogar', async () => {
      const antigo = await criarAluno(app.prisma, '1', 'Joana Prado');
      await app.prisma.usuario.update({ where: { id: antigo.id }, data: { tokenVersao: 3 } });

      const resposta = await criar({
        dataLimite: dia(10),
        fisicas: [fisica('Fis1', [aluno('1', 'Maria Joana Prado'), aluno('2', 'Bia')])],
      });

      expect(resposta.json<EdicaoCriada>().alunos).toEqual({ novos: 1, reaproveitados: 1 });
      const atualizado = await app.prisma.usuario.findUniqueOrThrow({ where: { id: antigo.id } });
      expect(atualizado).toMatchObject({ nome: 'Maria Joana Prado', tokenVersao: 3 });
      expect((await login('GES1', 'maria')).statusCode).toBe(200);
      expect((await login('GES1', 'joana')).statusCode).toBe(401);
    });

    it('com o mesmo nome, não mexe no cadastro', async () => {
      const antigo = await criarAluno(app.prisma, '1', 'Joana Prado');

      await criar({ dataLimite: dia(10), fisicas: [fisica('Fis1', [aluno('1', 'Joana Prado')])] });

      const depois = await app.prisma.usuario.findUniqueOrThrow({ where: { id: antigo.id } });
      expect(depois.senhaHash).toBe(antigo.senhaHash);
      expect(depois.atualizadoEm).toEqual(antigo.atualizadoEm);
    });

    it('login de aluno igual ao de um admin: 400, e a senha do admin não muda', async () => {
      const outroAdmin = await criarUsuario(app.prisma, {
        login: 'GES1',
        senha: 'senha-do-admin',
        papel: 'ADMIN',
      });

      const resposta = await criar({
        dataLimite: dia(10),
        fisicas: [fisica('Fis1', [aluno('1', 'Ana')])],
      });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toEqual([
        { campo: 'Fis1', mensagem: 'GES1 é o login de um administrador.' },
      ]);
      const depois = await app.prisma.usuario.findUniqueOrThrow({ where: { id: outroAdmin.id } });
      expect(depois.senhaHash).toBe(outroAdmin.senhaHash);
      expect(await app.prisma.edicao.count()).toBe(0);
    });
  });

  describe('erros (nada é gravado)', () => {
    it('semestre que já existe: 409 SEMESTRE_EXISTENTE', async () => {
      const dataLimite = dia(10);
      const primeira = await criar({ dataLimite, fisicas: [fisica('Fis1', [aluno('1', 'Ana')])] });
      const semestre = primeira.json<EdicaoCriada>().edicao.semestre;
      const antes = await quantidades();

      const resposta = await criar({ dataLimite, fisicas: [fisica('Fis1', [aluno('2', 'Bia')])] });

      expect(resposta.statusCode).toBe(409);
      expect(erroDa(resposta)).toEqual({
        codigo: 'SEMESTRE_EXISTENTE',
        mensagem: `Já existe a edição ${semestre}.`,
      });
      expect(await quantidades()).toEqual(antes);
    });

    it('data limite no passado: 400 no campo dataLimite', async () => {
      const resposta = await criar({
        dataLimite: dia(-1),
        fisicas: [fisica('Fis1', [aluno('1', 'Ana')])],
      });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes).toEqual([
        { campo: 'dataLimite', mensagem: 'A data limite precisa ser hoje ou uma data futura.' },
      ]);
      expect(await app.prisma.edicao.count()).toBe(0);
    });

    it('problemas da planilha: 400 com todos de uma vez, pela Física e pelo aluno', async () => {
      const resposta = await criar({
        dataLimite: dia(10),
        fisicas: [
          fisica('Fis1', [aluno('1', 'Maria Souza', 'A'), aluno('1', 'Maria Souza', 'B')]),
          fisica('Fis2', [aluno('1', 'Mariana Souza')]),
          fisica('Fis3', []),
        ],
      });

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta)).toEqual({
        codigo: 'VALIDACAO',
        mensagem: 'Dados inválidos.',
        detalhes: [
          { campo: 'Fis1', mensagem: 'GES1 (Maria Souza) aparece nas turmas A e B.' },
          {
            campo: 'Fis2',
            mensagem: 'GES1 aparece como "Mariana Souza" e como "Maria Souza" na Fis1.',
          },
          { campo: 'Fis3', mensagem: 'A Física não tem alunos.' },
        ],
      });
      expect(await quantidades()).toEqual({ edicoes: 0, usuarios: 1, inscricoes: 0 });
    });

    it('configuração impossível: mínimo > máximo e alunos que não cabem', async () => {
      const resposta = await criar({
        dataLimite: dia(10),
        fisicas: [
          fisica('Fis1', [aluno('1', 'Ana')], { minimoIntegrantes: 3, maximoIntegrantes: 2 }),
          fisica('Fis2', [aluno('1', 'Ana'), aluno('2', 'Bia'), aluno('3', 'Caio')], {
            quantidadeGrupos: 1,
            maximoIntegrantes: 2,
          }),
        ],
      });

      expect(erroDa(resposta).detalhes).toEqual([
        { campo: 'Fis1', mensagem: 'O mínimo de integrantes (3) é maior que o máximo (2).' },
        { campo: 'Fis2', mensagem: 'São 3 alunos, mas 1 grupos de até 2 integrantes cabem 2.' },
      ]);
    });

    it.each([
      ['sem Físicas', { dataLimite: dia(10), fisicas: [] }, 'fisicas'],
      [
        'data em outro formato',
        { dataLimite: '16/06/2026', fisicas: [fisica('Fis1', [aluno('1', 'Ana')])] },
        'dataLimite',
      ],
      [
        'matrícula vazia',
        { dataLimite: dia(10), fisicas: [fisica('Fis1', [aluno('  ', 'Ana')])] },
        'fisicas.0.alunos.0.matricula',
      ],
      [
        'nome vazio',
        { dataLimite: dia(10), fisicas: [fisica('Fis1', [aluno('1', '')])] },
        'fisicas.0.alunos.0.nome',
      ],
      [
        'zero grupos',
        {
          dataLimite: dia(10),
          fisicas: [fisica('Fis1', [aluno('1', 'Ana')], { quantidadeGrupos: 0 })],
        },
        'fisicas.0.quantidadeGrupos',
      ],
      [
        'multiturma ausente',
        {
          dataLimite: dia(10),
          fisicas: [{ ...fisica('Fis1', [aluno('1', 'Ana')]), multiturma: undefined }],
        },
        'fisicas.0.multiturma',
      ],
    ])('corpo inválido (%s): 400 no campo do schema', async (_caso, corpo, campo) => {
      const resposta = await criar(corpo);

      expect(resposta.statusCode).toBe(400);
      expect(erroDa(resposta).detalhes?.map((detalhe) => detalhe.campo)).toContain(campo);
    });
  });

  describe('tamanho da planilha', () => {
    /** Mesmo primeiro nome para todos: um hash só, o teste fica rápido. */
    function muitosAlunos(quantidade: number, inicio = 0) {
      return Array.from({ length: quantidade }, (_, indice) =>
        aluno(String(inicio + indice), `Aluno ${'Sobrenome '.repeat(15)}${inicio + indice}`),
      );
    }

    it('aceita corpo acima de 1 MB (o padrão do Fastify)', async () => {
      const fisicas = [
        fisica('Fis1', muitosAlunos(3000), { quantidadeGrupos: 1000, maximoIntegrantes: 3 }),
        fisica('Fis2', muitosAlunos(3000, 3000), { quantidadeGrupos: 1000, maximoIntegrantes: 3 }),
      ];
      const payload = { dataLimite: dia(10), fisicas };
      expect(JSON.stringify(payload).length).toBeGreaterThan(1024 * 1024);

      const resposta = await criar(payload);

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json<EdicaoCriada>().alunos.novos).toBe(6000);
    });

    it('recusa corpo acima de 5 MB', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/admin/edicoes',
        headers: {
          authorization: `Bearer ${tokenDe(app, admin)}`,
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ dataLimite: dia(10), lixo: 'x'.repeat(6 * 1024 * 1024) }),
      });

      expect(resposta.statusCode).toBe(413);
      expect(erroDa(resposta).codigo).toBe('REQUISICAO_INVALIDA');
    });
  });

  describe('acesso', () => {
    it('sem token: 401', async () => {
      const resposta = await app.inject({ method: 'POST', url: '/admin/edicoes', payload: {} });

      expect(resposta.statusCode).toBe(401);
    });

    it('aluno: 403', async () => {
      const aluno = await criarAluno(app.prisma, '1');

      expect((await criar({}, aluno)).statusCode).toBe(403);
    });
  });

  describe('concorrência', () => {
    it('duas edições de semestres diferentes ao mesmo tempo: as duas criadas, só uma ativa', async () => {
      const respostas = await Promise.all([
        criar({ dataLimite: dia(10), fisicas: [fisica('Fis1', [aluno('1', 'Ana')])] }),
        criar({ dataLimite: dia(200), fisicas: [fisica('Fis1', [aluno('2', 'Bia')])] }),
      ]);

      expect(respostas.map((resposta) => resposta.statusCode)).toEqual([201, 201]);
      expect(await app.prisma.edicao.count({ where: { ativa: true } })).toBe(1);
      const finalizadas = respostas.map(
        (resposta) => resposta.json<EdicaoCriada>().edicaoFinalizada,
      );
      expect(finalizadas.filter((finalizada) => finalizada !== null)).toHaveLength(1);
    });

    it('clique duplo: cria uma vez, a outra recebe 409 SEMESTRE_EXISTENTE', async () => {
      const corpo = { dataLimite: dia(10), fisicas: [fisica('Fis1', [aluno('1', 'Ana')])] };

      const respostas = await Promise.all([criar(corpo), criar(corpo)]);

      expect(respostas.map((resposta) => resposta.statusCode).sort()).toEqual([201, 409]);
      expect(await quantidades()).toEqual({ edicoes: 1, usuarios: 2, inscricoes: 1 });
    });
  });
});
