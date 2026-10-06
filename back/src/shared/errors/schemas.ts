import { z } from 'zod';

/** Formato padrão de erro da API (documentado no Swagger). */
export const erroSchema = z.object({
  erro: z.object({
    codigo: z.string(),
    mensagem: z.string(),
    detalhes: z.array(z.object({ campo: z.string(), mensagem: z.string() })).optional(),
  }),
});
