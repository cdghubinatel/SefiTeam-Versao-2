import { z } from 'zod';

export const loginBodySchema = z.object({
  /** Aluno: curso + matrícula (ex.: GES589); admin: o login dele. Sem diferenciar maiúsculas. */
  login: z.string().trim().min(1).max(100),
  senha: z.string().min(1).max(200),
});

export const usuarioSchema = z.object({
  id: z.number().int(),
  login: z.string(),
  nome: z.string(),
  papel: z.enum(['ADMIN', 'ALUNO']),
});

export const loginRespostaSchema = z.object({
  token: z.string(),
  usuario: usuarioSchema,
});

export type LoginBody = z.infer<typeof loginBodySchema>;
