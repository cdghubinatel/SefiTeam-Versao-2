import { z } from 'zod';

// Remove os espaços antes de validar: `z.email().trim()` validaria primeiro e recusaria " a@b.com".
// O preprocess mantém o `format: email` no Swagger (um `.pipe` perderia).
const emailSchema = z.preprocess(
  (valor) => (typeof valor === 'string' ? valor.trim() : valor),
  z.email().max(254),
);

export const loginBodySchema = z.object({
  email: emailSchema,
  senha: z.string().min(1).max(200),
});

export const usuarioSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  nome: z.string(),
  papel: z.enum(['ADMIN', 'ALUNO']),
});

export const loginRespostaSchema = z.object({
  token: z.string(),
  usuario: usuarioSchema,
});

export type LoginBody = z.infer<typeof loginBodySchema>;
