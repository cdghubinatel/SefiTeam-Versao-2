import { z } from 'zod';

const booleano = z.enum(['true', 'false']).transform((valor) => valor === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SWAGGER_ENABLED: booleano.default(false),
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
