/** Regras puras de grupo (sem banco), usadas pelo service. Ver docs/grupos.md. */

/** Menor número ainda não usado na Física: com os grupos 1, 3 e 4, o próximo é o 2. */
export function menorNumeroLivre(numerosUsados: readonly number[]) {
  const usados = new Set(numerosUsados);
  let numero = 1;
  while (usados.has(numero)) {
    numero += 1;
  }
  return numero;
}

/** Depois da data limite, o aluno não altera mais grupos (o admin sim). */
export function prazoEncerrado(dataLimite: Date, agora = new Date()) {
  return agora.getTime() > dataLimite.getTime();
}

/** O grupo está formado quando atinge o mínimo de integrantes da Física. */
export function estaFormado(quantidadeIntegrantes: number, minimoIntegrantes: number) {
  return quantidadeIntegrantes >= minimoIntegrantes;
}

/**
 * Multiturma desligado: o grupo só aceita alunos da turma dos integrantes atuais.
 * Grupo sem integrantes aceita qualquer turma.
 */
export function turmaCompativel({
  multiturma,
  turmasDoGrupo,
  turmaDoAluno,
}: {
  multiturma: boolean;
  turmasDoGrupo: readonly number[];
  turmaDoAluno: number;
}) {
  return multiturma || turmasDoGrupo.every((turma) => turma === turmaDoAluno);
}
