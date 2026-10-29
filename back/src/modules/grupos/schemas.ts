import { z } from 'zod';

const id = z.coerce.number().int().positive();

export const fisicaParamsSchema = z.object({ fisicaId: id });

export const grupoParamsSchema = z.object({ grupoId: id });

export const integranteParamsSchema = z.object({ grupoId: id, alunoId: id });

export const colegasQuerySchema = z.object({
  /** Parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos. Vazio = todos. */
  busca: z.string().trim().max(100).optional(),
});

/** Ids de aluno, sem repetição, até 50 por requisição. */
function idsDeAlunos({ minimo }: { minimo: number }) {
  return z
    .array(z.number().int().positive())
    .min(minimo)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'A lista não pode ter ids repetidos.');
}

export const criarGrupoBodySchema = z.object({
  /**
   * Ids (de aluno) dos colegas que entram junto com quem cria. Quem cria + colegas precisa
   * atingir o mínimo da Física; vazio só passa se o mínimo for 1.
   */
  colegas: idsDeAlunos({ minimo: 0 }).default([]),
});

export const adicionarIntegrantesBodySchema = z.object({
  /** Ids (de aluno) de quem entra no grupo: inscritos na Física e sem grupo nela. */
  alunos: idsDeAlunos({ minimo: 1 }),
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

export const remocaoDeIntegranteSchema = z.object({
  /** Grupo depois da remoção; `null` quando era o último integrante e o grupo foi apagado. */
  grupo: grupoSchema.nullable(),
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

export type CriarGrupoBody = z.infer<typeof criarGrupoBodySchema>;
export type AdicionarIntegrantesBody = z.infer<typeof adicionarIntegrantesBodySchema>;
export type Grupo = z.infer<typeof grupoSchema>;
export type RemocaoDeIntegrante = z.infer<typeof remocaoDeIntegranteSchema>;
export type AlunoResumo = z.infer<typeof alunoResumoSchema>;
export type MinhasFisicas = z.infer<typeof minhasFisicasSchema>;
