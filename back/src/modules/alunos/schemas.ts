import { z } from 'zod';
import { alunoDaPlanilhaSchema } from '../edicoes/schemas.js';
import { grupoSchema } from '../grupos/schemas.js';

const id = z.coerce.number().int().positive();

export const alunosDaEdicaoQuerySchema = z.object({
  /** Parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos. Vazio = todos. */
  busca: z.string().trim().max(100).optional(),
  fisicaId: id.optional(),
  /** Formado = num grupo que atingiu o mínimo; não formado = num grupo abaixo dele. */
  status: z.enum(['formado', 'nao-formado', 'sem-grupo']).optional(),
});

/** Uma linha da lista: o aluno numa Física. O `id` do aluno e o `fisica.id` identificam a linha. */
export const alunoDaEdicaoSchema = z.object({
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
   * e de código da Física.
   */
  alunos: z.array(alunoDaEdicaoSchema),
});

export const fisicaParamsSchema = z.object({ fisicaId: id });

export const alunoNaFisicaParamsSchema = z.object({ fisicaId: id, alunoId: id });

/**
 * Corpo de adicionar e de editar: os mesmos campos e a mesma normalização de uma linha da
 * planilha (curso e matrícula sem espaços e em maiúsculas; a turma em maiúsculas).
 */
export const alunoBodySchema = alunoDaPlanilhaSchema;

export const remocaoDoAlunoSchema = z.object({
  /**
   * Grupo em que o aluno estava, como ficou depois da saída (pode ficar abaixo do mínimo), ou
   * `null`: o aluno não tinha grupo, ou era o último integrante e o grupo foi apagado.
   */
  grupo: grupoSchema.nullable(),
});

export type RemocaoDoAluno = z.infer<typeof remocaoDoAlunoSchema>;
export type AlunoDaEdicao = z.infer<typeof alunoDaEdicaoSchema>;
export type AlunoBody = z.infer<typeof alunoBodySchema>;
export type AlunosDaEdicaoQuery = z.infer<typeof alunosDaEdicaoQuerySchema>;
export type AlunosDaEdicao = z.infer<typeof alunosDaEdicaoSchema>;
