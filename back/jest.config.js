/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // O Prisma Client gerado importa com extensão .js (padrão nodenext); no Jest, resolve para o .ts.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/server.ts', '!src/generated/**'],
  clearMocks: true,
};
