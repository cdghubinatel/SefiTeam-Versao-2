import { describe, expect, it } from 'vitest';
import { estaFormado, menorNumeroLivre, prazoEncerrado, turmaCompativel } from './regras.js';

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

describe('prazoEncerrado', () => {
  const dataLimite = new Date('2026-06-16T23:59:59.000Z');

  it.each([
    ['antes do prazo', '2026-06-16T23:59:58.999Z', false],
    ['no instante exato do prazo', '2026-06-16T23:59:59.000Z', false],
    ['depois do prazo', '2026-06-17T00:00:00.000Z', true],
  ])('%s', (_caso, agora, esperado) => {
    expect(prazoEncerrado(dataLimite, new Date(agora))).toBe(esperado);
  });

  it('usa a hora atual por padrão', () => {
    expect(prazoEncerrado(new Date(Date.now() + 60_000))).toBe(false);
    expect(prazoEncerrado(new Date(Date.now() - 60_000))).toBe(true);
  });
});
