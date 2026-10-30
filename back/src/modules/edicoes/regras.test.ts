import { describe, expect, it } from 'vitest';
import {
  MAXIMO_DE_ERROS,
  nomeDaFisica,
  prazoDoDia,
  semestreDoDia,
  validarFisicas,
} from './regras.js';
import type { AlunoDaPlanilha, FisicaDaPlanilha } from './schemas.js';

function aluno(matricula: string, turma = 'A', nome = `Aluno ${matricula}`): AlunoDaPlanilha {
  return { curso: 'GES', matricula, nome, turma };
}

function fisica(codigo: string, dados: Partial<FisicaDaPlanilha> = {}): FisicaDaPlanilha {
  return {
    codigo,
    quantidadeGrupos: 5,
    minimoIntegrantes: 2,
    maximoIntegrantes: 4,
    multiturma: false,
    alunos: [aluno('1'), aluno('2')],
    ...dados,
  };
}

describe('prazoDoDia', () => {
  it('vale até 23:59:59 do dia no horário de Brasília (02:59:59 do dia seguinte em UTC)', () => {
    expect(prazoDoDia('2026-06-16').toISOString()).toBe('2026-06-17T02:59:59.999Z');
  });
});

describe('semestreDoDia', () => {
  it.each([
    ['2026-01-01', '2026/1'],
    ['2026-06-30', '2026/1'],
    ['2026-07-01', '2026/2'],
    ['2026-12-31', '2026/2'],
  ])('%s → %s', (data, semestre) => {
    expect(semestreDoDia(data)).toBe(semestre);
  });
});

describe('nomeDaFisica', () => {
  it.each([
    ['Fis1', 'Física 1'],
    ['fis2', 'Física 2'],
    ['FIS 3', 'Física 3'],
    ['Fis03', 'Física 3'],
    ['Fis10', 'Física 10'],
    ['Física Moderna', 'Física Moderna'],
    ['F01', 'F01'],
  ])('%s → %s', (codigo, nome) => {
    expect(nomeDaFisica(codigo)).toBe(nome);
  });
});

describe('validarFisicas', () => {
  it('planilha certa: sem erros e com as Físicas como vieram', () => {
    const fisicas = [fisica('Fis1'), fisica('Fis2', { alunos: [aluno('1'), aluno('3', 'B')] })];

    expect(validarFisicas(fisicas)).toEqual({ erros: [], fisicas });
  });

  it('aluno repetido na mesma turma conta uma vez', () => {
    const { erros, fisicas } = validarFisicas([
      fisica('Fis1', { alunos: [aluno('1'), aluno('2'), aluno('1')] }),
    ]);

    expect(erros).toEqual([]);
    expect(fisicas[0]!.alunos).toEqual([aluno('1'), aluno('2')]);
  });

  it('aluno em duas turmas da mesma Física: erro uma vez, mesmo repetido mais vezes', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', {
        alunos: [
          aluno('1', 'A', 'Maria Souza'),
          aluno('1', 'B', 'Maria Souza'),
          aluno('1', 'C', 'Maria Souza'),
        ],
      }),
    ]);

    expect(erros).toEqual([
      { campo: 'Fis1', mensagem: 'GES1 (Maria Souza) aparece nas turmas A e B.' },
    ]);
  });

  it('o mesmo aluno em turmas diferentes de Físicas diferentes é normal', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { alunos: [aluno('1', 'A'), aluno('2')] }),
      fisica('Fis2', { alunos: [aluno('1', 'B'), aluno('2')] }),
    ]);

    expect(erros).toEqual([]);
  });

  it('o mesmo aluno com nomes diferentes em Físicas diferentes: erro na segunda', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { alunos: [aluno('1', 'A', 'João Silva'), aluno('2')] }),
      fisica('Fis2', { alunos: [aluno('1', 'A', 'Joao da Silva'), aluno('2')] }),
      fisica('Fis3', { alunos: [aluno('1', 'A', 'J. Silva'), aluno('2')] }),
    ]);

    expect(erros).toEqual([
      { campo: 'Fis2', mensagem: 'GES1 aparece como "Joao da Silva" e como "João Silva" na Fis1.' },
    ]);
  });

  it('nomes diferentes na mesma Física também são erro', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { alunos: [aluno('1', 'A', 'Ana Lima'), aluno('1', 'A', 'Ana Souza')] }),
    ]);

    expect(erros).toEqual([
      {
        campo: 'Fis1',
        mensagem: 'GES1 aparece como "Ana Souza" e como "Ana Lima" nesta mesma Física.',
      },
    ]);
  });

  it('diferença só de maiúsculas, acentos ou espaços não conta como outro nome', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { alunos: [aluno('1', 'A', 'João  Silva'), aluno('2')] }),
      fisica('Fis2', { alunos: [aluno('1', 'A', 'JOAO SILVA'), aluno('2')] }),
    ]);

    expect(erros).toEqual([]);
  });

  it('cursos diferentes com a mesma matrícula são alunos diferentes', () => {
    const { erros, fisicas } = validarFisicas([
      fisica('Fis1', {
        alunos: [
          { curso: 'GES', matricula: '1', nome: 'Ana', turma: 'A' },
          { curso: 'GEC', matricula: '1', nome: 'Bia', turma: 'B' },
        ],
      }),
    ]);

    expect(erros).toEqual([]);
    expect(fisicas[0]!.alunos).toHaveLength(2);
  });

  it('Física sem alunos', () => {
    expect(validarFisicas([fisica('Fis1', { alunos: [] })]).erros).toEqual([
      { campo: 'Fis1', mensagem: 'A Física não tem alunos.' },
    ]);
  });

  it('código repetido, sem diferenciar maiúsculas', () => {
    expect(validarFisicas([fisica('Fis1'), fisica('FIS1')]).erros).toEqual([
      { campo: 'FIS1', mensagem: 'A Física FIS1 aparece mais de uma vez.' },
    ]);
  });

  it('mínimo maior que o máximo', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { minimoIntegrantes: 5, maximoIntegrantes: 3 }),
    ]);

    expect(erros).toEqual([
      { campo: 'Fis1', mensagem: 'O mínimo de integrantes (5) é maior que o máximo (3).' },
    ]);
  });

  it('mínimo igual ao máximo é permitido', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { minimoIntegrantes: 3, maximoIntegrantes: 3 }),
    ]);

    expect(erros).toEqual([]);
  });

  describe('capacidade (grupos × máximo)', () => {
    const tresAlunos = [aluno('1'), aluno('2'), aluno('3')];

    it('alunos acima da capacidade: erro com as contas', () => {
      const { erros } = validarFisicas([
        fisica('Fis1', { quantidadeGrupos: 1, maximoIntegrantes: 2, alunos: tresAlunos }),
      ]);

      expect(erros).toEqual([
        { campo: 'Fis1', mensagem: 'São 3 alunos, mas 1 grupos de até 2 integrantes cabem 2.' },
      ]);
    });

    it('exatamente na capacidade é permitido', () => {
      const { erros } = validarFisicas([
        fisica('Fis1', { quantidadeGrupos: 1, maximoIntegrantes: 3, alunos: tresAlunos }),
      ]);

      expect(erros).toEqual([]);
    });

    it('repetidos não contam na capacidade', () => {
      const { erros } = validarFisicas([
        fisica('Fis1', {
          quantidadeGrupos: 1,
          maximoIntegrantes: 3,
          alunos: [...tresAlunos, aluno('1')],
        }),
      ]);

      expect(erros).toEqual([]);
    });
  });

  it('junta os erros de todas as Físicas, na ordem das abas', () => {
    const { erros } = validarFisicas([
      fisica('Fis1', { alunos: [] }),
      fisica('Fis2', { minimoIntegrantes: 5, maximoIntegrantes: 4 }),
    ]);

    expect(erros.map((erro) => erro.campo)).toEqual(['Fis1', 'Fis2']);
  });

  it(`devolve no máximo ${MAXIMO_DE_ERROS} erros`, () => {
    const fisicas = Array.from({ length: MAXIMO_DE_ERROS + 10 }, (_, indice) =>
      fisica(`Fis${indice}`, { alunos: [] }),
    );

    expect(validarFisicas(fisicas).erros).toHaveLength(MAXIMO_DE_ERROS);
  });
});
