import { defineConfig } from 'vitest/config';

// Variáveis dos testes; src/config/env.ts valida o ambiente ao ser importado.
// O DATABASE_URL pode vir de fora (no CI, aponta para o Postgres do service).
const envTeste = {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://sefiteam:sefiteam@127.0.0.1:5432/sefiteam_test?schema=public',
  JWT_SECRET: 'segredo-de-teste-com-pelo-menos-32-caracteres',
  SWAGGER_ENABLED: 'false',
};

// Também no processo principal, para o globalSetup (migrations) usar o mesmo banco.
Object.assign(process.env, envTeste);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: envTeste,
    globalSetup: ['./vitest.global-setup.ts'],
    // Os testes de integração compartilham o banco de teste: um arquivo por vez.
    fileParallelism: false,
    clearMocks: true,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/generated/**', 'src/test/**'],
      // Mínimo cobrado no CI (npm run test:coverage). Abaixo disso, o comando falha.
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
