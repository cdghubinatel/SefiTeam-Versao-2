import { describe, expect, it } from 'vitest';
import { envSchema, JWT_SECRET_DE_EXEMPLO } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:s@127.0.0.1:5432/banco',
  JWT_SECRET: 'um-segredo-de-verdade-com-mais-de-32-caracteres',
};

describe('envSchema', () => {
  it('usa 127.0.0.1 como HOST padrão, para a API não ficar exposta na rede', () => {
    expect(envSchema.parse(base).HOST).toBe('127.0.0.1');
  });

  it('recusa o JWT_SECRET de exemplo em produção', () => {
    const resultado = envSchema.safeParse({
      ...base,
      NODE_ENV: 'production',
      JWT_SECRET: JWT_SECRET_DE_EXEMPLO,
    });

    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.path).toEqual(['JWT_SECRET']);
  });

  it('aceita o JWT_SECRET de exemplo fora de produção', () => {
    const resultado = envSchema.safeParse({ ...base, JWT_SECRET: JWT_SECRET_DE_EXEMPLO });

    expect(resultado.success).toBe(true);
  });

  it('aceita um JWT_SECRET próprio em produção', () => {
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'production' }).success).toBe(true);
  });

  it('recusa JWT_SECRET com menos de 32 caracteres', () => {
    expect(envSchema.safeParse({ ...base, JWT_SECRET: 'curto' }).success).toBe(false);
  });
});
