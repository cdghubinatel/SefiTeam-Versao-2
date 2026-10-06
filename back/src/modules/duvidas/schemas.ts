import { z } from 'zod';

/** Texto puro (sem HTML/Markdown); quebras de linha são mantidas. */
export const duvidaBodySchema = z.object({
  pergunta: z.string().trim().min(1).max(300),
  resposta: z.string().trim().min(1).max(5000),
});

export const duvidaParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Todos os ids, na nova ordem de exibição. */
export const reordenarBodySchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'A lista não pode ter ids repetidos.'),
});

export const duvidaSchema = z.object({
  id: z.number().int(),
  pergunta: z.string(),
  resposta: z.string(),
  ordem: z.number().int(),
});

export type DuvidaBody = z.infer<typeof duvidaBodySchema>;
