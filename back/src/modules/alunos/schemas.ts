import { z } from 'zod';

export const alunosDaEdicaoQuerySchema = z.object({
  /** Parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos. Vazio = todos. */
  busca: z.string().trim().max(100).optional(),
  fisicaId: z.coerce.number().int().positive().optional(),
  /** Formado = num grupo que atingiu o mínimo; não formado = num grupo abaixo dele. */
  status: z.enum(['formado', 'nao-formado', 'sem-grupo']).optional(),
});

export const alunosDaEdicaoSchema = z.object({
  /** Última edição criada (ativa ou não); `null` quando não existe nenhuma edição. */
  edicao: z
    .object({
      id: z.number().int(),
      semestre: z.string(),
      dataLimite: z.iso.datetime(),
      ativa: z.boolean(),
    })
    .nullable(),
  /** Todas as Físicas da edição, em ordem de código, mesmo com filtro (servem para o dropdown). */
  fisicas: z.array(
    z.object({
      id: z.number().int(),
      codigo: z.string(),
      nome: z.string(),
      /** Códigos das turmas, em ordem (ex.: ["A", "B"]). */
      turmas: z.array(z.string()),
    }),
  ),
  /**
   * Uma linha por aluno em cada Física (quem está em duas aparece duas vezes), em ordem de nome
   * e de código da Física. O `id` do aluno e o `fisica.id` identificam a linha.
   */
  alunos: z.array(
    z.object({
      id: z.number().int(),
      nome: z.string(),
      curso: z.string().nullable(),
      matricula: z.string().nullable(),
      fisica: z.object({ id: z.number().int(), codigo: z.string() }),
      /** Código da turma na Física (ex.: "A"). */
      turma: z.string(),
      /** Grupo do aluno nesta Física, ou `null`. O número serve para exportar a planilha. */
      grupo: z.object({ id: z.number().int(), numero: z.number().int() }).nullable(),
      status: z.enum(['formado', 'nao-formado', 'sem-grupo']),
    }),
  ),
});

export type AlunosDaEdicaoQuery = z.infer<typeof alunosDaEdicaoQuerySchema>;
export type AlunosDaEdicao = z.infer<typeof alunosDaEdicaoSchema>;
