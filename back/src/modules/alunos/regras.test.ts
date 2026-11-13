import { describe, expect, it } from 'vitest';
import { statusDoAluno } from './regras.js';

describe('statusDoAluno', () => {
  it.each([
    [null, 2, 'sem-grupo'],
    [1, 2, 'nao-formado'],
    [2, 2, 'formado'],
    [3, 2, 'formado'],
  ] as const)('%s integrantes com mínimo %i → %s', (integrantes, minimo, esperado) => {
    expect(statusDoAluno(integrantes, minimo)).toBe(esperado);
  });
});
