import { describe, expect, it } from 'vitest';
import { escaparLike } from './prisma.js';

describe('escaparLike', () => {
  it.each([
    ['texto comum', 'João Victor', 'João Victor'],
    ['porcentagem', '50%', '50\\%'],
    ['sublinhado', 'a_b', 'a\\_b'],
    ['barra invertida', 'a\\b', 'a\\\\b'],
    ['vários curingas', '%_%', '\\%\\_\\%'],
  ])('escapa %s', (_caso, texto, esperado) => {
    expect(escaparLike(texto)).toBe(esperado);
  });
});
