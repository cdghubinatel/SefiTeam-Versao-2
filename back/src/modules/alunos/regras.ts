/** Regras puras da lista de alunos do admin (sem banco). Ver docs/alunos.md. */
import { estaFormado } from '../grupos/regras.js';

export type StatusDoAluno = 'formado' | 'nao-formado' | 'sem-grupo';

/**
 * Situação do aluno numa Física: sem grupo, num grupo abaixo do mínimo (não formado) ou num
 * grupo que atingiu o mínimo (formado). `integrantesDoGrupo` é `null` quando ele não tem grupo.
 */
export function statusDoAluno(
  integrantesDoGrupo: number | null,
  minimoIntegrantes: number,
): StatusDoAluno {
  if (integrantesDoGrupo === null) {
    return 'sem-grupo';
  }
  return estaFormado(integrantesDoGrupo, minimoIntegrantes) ? 'formado' : 'nao-formado';
}
