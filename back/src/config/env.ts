import { z } from 'zod';

const booleano = z.enum(['true', 'false']).transform((valor) => valor === 'true');

/** Valor do `.env.example`; a API não sobe com ele em produção. */
export const JWT_SECRET_DE_EXEMPLO = 'troque-isto-por-um-segredo-com-pelo-menos-32-caracteres';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // 127.0.0.1: a API só aceita conexões da própria máquina. Em container/produção, use 0.0.0.0.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(3333),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('8h'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    SWAGGER_ENABLED: booleano.default(false),
  })
  .superRefine((dados, ctx) => {
    if (dados.NODE_ENV === 'production' && dados.JWT_SECRET === JWT_SECRET_DE_EXEMPLO) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET de exemplo não pode ser usado em produção',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function carregarEnv(): Env {
  const resultado = envSchema.safeParse(process.env);

  if (!resultado.success) {
    console.error('Variáveis de ambiente inválidas:', z.flattenError(resultado.error).fieldErrors);
    throw new Error('Variáveis de ambiente inválidas. Confira o arquivo .env.');
  }

  return resultado.data;
}

export const env = carregarEnv();
