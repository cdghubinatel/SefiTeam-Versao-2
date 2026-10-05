// Variáveis mínimas para os testes; src/config/env.ts valida o ambiente ao ser importado.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??=
  'postgresql://sefiteam:sefiteam@localhost:5432/sefiteam_test?schema=public';
process.env.JWT_SECRET ??= 'segredo-de-teste-com-pelo-menos-32-caracteres';
process.env.SWAGGER_ENABLED ??= 'false';
