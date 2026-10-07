import { z } from 'zod';

const id = z.coerce.number().int().positive();

export const fisicaParamsSchema = z.object({ fisicaId: id });

export const colegasQuerySchema = z.object({
  /** Parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos. Vazio = todos. */
  busca: z.string().trim().max(100).optional(),
});

/** Aluno como aparece nas listas: o front monta "GES 589 · Turma F01-A". */
export const alunoResumoSchema = z.object({
  id: z.number().int(),
  nome: z.string(),
  curso: z.string().nullable(),
  matricula: z.string().nullable(),
  /** Código da turma na Física (ex.: "A"). */
  turma: z.string(),
});

export const grupoSchema = z.object({
  id: z.number().int(),
  numero: z.number().int(),
  fisicaId: z.number().int(),
  /** Atingiu o mínimo de integrantes da Física. */
  formado: z.boolean(),
  /** Em ordem de entrada no grupo. */
  integrantes: z.array(alunoResumoSchema),
});

export const minhasFisicasSchema = z.object({
  /** Edição ativa; `null` quando não há nenhuma. */
  edicao: z.object({ semestre: z.string(), dataLimite: z.iso.datetime() }).nullable(),
  fisicas: z.array(
    z.object({
      id: z.number().int(),
      codigo: z.string(),
      nome: z.string(),
      minimoIntegrantes: z.number().int(),
      maximoIntegrantes: z.number().int(),
      multiturma: z.boolean(),
      /** Turma do aluno nesta Física. */
      turma: z.string(),
      /** Grupo do aluno nesta Física, ou `null` se ainda não tem. */
      grupo: grupoSchema.nullable(),
    }),
  ),
});

export type Grupo = z.infer<typeof grupoSchema>;
export type AlunoResumo = z.infer<typeof alunoResumoSchema>;
export type MinhasFisicas = z.infer<typeof minhasFisicasSchema>;
