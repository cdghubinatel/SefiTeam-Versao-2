import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'coverage', 'node_modules', 'src/generated'] },
  js.configs.recommended,
  // Regras que usam os tipos (ex.: promise sem await/tratamento).
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Plugins e handlers do Fastify são async por contrato, mesmo sem await.
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Arquivos JS de configuração ficam fora do tsconfig.
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
