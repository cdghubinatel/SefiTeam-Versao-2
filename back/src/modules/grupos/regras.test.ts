import { describe, expect, it } from 'vitest';
import { estaFormado, menorNumeroLivre, turmaCompativel } from './regras.js';

describe('menorNumeroLivre', () => {
  it.each([
    ['nenhum grupo', [], 1],
    ['sequência completa', [1, 2, 3], 4],
    ['buraco no meio', [1, 3, 4], 2],
    ['buraco no começo', [2, 3], 1],
    ['fora de ordem', [3, 1], 2],
  ])('com %s', (_caso, usados, esperado) => {
    expect(menorNumeroLivre(usados)).toBe(esperado);
  });
});

describe('estaFormado', () => {
  it.each([
    [2, 3, false],
    [3, 3, true],
    [4, 3, true],
    [0, 0, true],
  ])('%i integrantes com mínimo %i → %s', (quantidade, minimo, esperado) => {
    expect(estaFormado(quantidade, minimo)).toBe(esperado);
  });
});

describe('turmaCompativel', () => {
  it('multiturma ligado aceita qualquer turma', () => {
    expect(turmaCompativel({ multiturma: true, turmasDoGrupo: [1, 2], turmaDoAluno: 3 })).toBe(
      true,
    );
  });

  it('multiturma desligado aceita a mesma turma do grupo', () => {
    expect(turmaCompativel({ multiturma: false, turmasDoGrupo: [1, 1], turmaDoAluno: 1 })).toBe(
      true,
    );
  });

  it('multiturma desligado recusa outra turma', () => {
    expect(turmaCompativel({ multiturma: false, turmasDoGrupo: [1], turmaDoAluno: 2 })).toBe(false);
  });

  it('grupo sem integrantes aceita qualquer turma', () => {
    expect(turmaCompativel({ multiturma: false, turmasDoGrupo: [], turmaDoAluno: 2 })).toBe(true);
  });
});
