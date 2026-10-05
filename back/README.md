# SefiTeam — Back-end

API REST do SefiTeam.

## Stack

- Node.js 24 (LTS) + TypeScript 6.0, em **ESM** (`"type": "module"`)
- [Fastify](https://fastify.dev/) 5
- [Zod](https://zod.dev/) para validação (via `fastify-type-provider-zod`)
- [Prisma](https://www.prisma.io/) 7 + PostgreSQL
- Swagger (`@fastify/swagger` + `@fastify/swagger-ui`) em `/docs`
- [Vitest](https://vitest.dev/), ESLint e Prettier

> TypeScript fixado em `~6.0`: o `typescript-eslint` ainda não suporta o TypeScript 7.

**Imports em ESM:** imports relativos levam a extensão `.js`, mesmo apontando para arquivos `.ts`, por exemplo `import { env } from './config/env.js'`. É o padrão do Node em ESM (`moduleResolution: nodenext`). O `verbatimModuleSyntax` está ligado, então imports que são só de tipo usam `import type`.

## Estrutura

```
back/
├── prisma/
│   ├── schema.prisma       # Modelo (ver docs/modelo-banco.md)
│   └── migrations/
├── src/
│   ├── server.ts           # Sobe o servidor (listen)
│   ├── app.ts              # buildApp(): monta o Fastify (usado também nos testes)
│   ├── config/
│   │   └── env.ts          # Variáveis de ambiente validadas com Zod
│   ├── plugins/            # Plugins do Fastify (swagger, prisma, auth...)
│   ├── shared/
│   │   └── errors/         # AppError e error handler central
│   └── modules/            # Um módulo por domínio
│       ├── auth/           # Login, sessão
│       ├── edicoes/        # Criação da edição, upload da planilha
│       ├── fisicas/
│       ├── alunos/
│       ├── grupos/         # Criar, entrar, remover, exportar
│       └── duvidas/        # Dúvidas Frequentes
└── .env.example
```

Cada módulo segue o padrão `routes.ts` (rotas + validação) → `service.ts` (regras de negócio) → Prisma.

Autenticação e permissões: [docs/autenticacao.md](../docs/autenticacao.md).

## Rodando

```bash
docker compose up -d     # na raiz do repositório: sobe o PostgreSQL
cd back
cp .env.example .env
npm install              # também gera o Prisma Client (postinstall)
npm run db:migrate       # aplica as migrations no banco local
npm run db:seed          # cria o admin (ADMIN_LOGIN / ADMIN_SENHA)
npm run dev
```

- API: `http://localhost:3333`
- Swagger: `http://localhost:3333/docs` (com `SWAGGER_ENABLED=true`)

## Variáveis de ambiente

Copie `.env.example` para `.env`. As variáveis são validadas ao iniciar (`src/config/env.ts`): se alguma estiver inválida, a API não sobe.

| Variável          | Descrição                                           |
| ----------------- | --------------------------------------------------- |
| `NODE_ENV`        | `development`, `test` ou `production`               |
| `PORT`            | Porta da API                                        |
| `DATABASE_URL`    | URL de conexão do PostgreSQL                        |
| `JWT_SECRET`      | Segredo para assinar os tokens (mín. 32 caracteres) |
| `JWT_EXPIRES_IN`  | Validade do token (ex.: `8h`)                       |
| `CORS_ORIGIN`     | Origem do front-end liberada no CORS                |
| `ADMIN_LOGIN`     | Login do admin criado pelo seed                     |
| `ADMIN_SENHA`     | Senha do admin criado pelo seed                     |
| `SWAGGER_ENABLED` | Expõe o Swagger em `/docs` (`false` em produção)    |

## Scripts

| Script                | Descrição                                        |
| --------------------- | ------------------------------------------------ |
| `npm run dev`         | Sobe a API em modo desenvolvimento (watch)       |
| `npm run build`       | Compila para JavaScript em `dist/`               |
| `npm start`           | Roda a versão compilada                          |
| `npm run typecheck`   | Checa os tipos sem gerar arquivos                |
| `npm run lint`        | ESLint (`lint:fix` corrige o que for possível)   |
| `npm run format`      | Formata com Prettier (`format:check` só confere) |
| `npm test`            | Roda os testes (`test:watch`, `test:coverage`)   |
| `npm run db:generate` | Gera o Prisma Client em `src/generated/`         |
| `npm run db:migrate`  | Cria/aplica migrations no banco local (dev)      |
| `npm run db:deploy`   | Aplica migrations pendentes (CI/produção)        |
| `npm run db:seed`     | Cria ou atualiza o admin                         |
| `npm run db:studio`   | Abre o Prisma Studio                             |

## Banco de dados

- Configuração do Prisma em `prisma.config.ts` (o Prisma 7 não lê o `.env` sozinho; o arquivo carrega o `.env` quando ele existe).
- O Prisma Client é gerado em `src/generated/prisma` (fora do Git) e conecta via driver adapter `@prisma/adapter-pg`.
- O índice único parcial de `edicao` usa o preview `partialIndexes` direto no schema.
- `CHECK(minimo_integrantes <= maximo_integrantes)` foi escrito à mão na migration inicial, porque o Prisma não suporta CHECK no schema. Ao gerar novas migrations, confira se o Prisma não tentou removê-lo.

## Testes

- Vitest (`vitest.config.ts`). Os arquivos `*.test.ts` ficam ao lado do código testado. As funções (`describe`, `it`, `expect`, `vi`...) são importadas explicitamente de `'vitest'`.
- **Unitários** (ex.: `service.test.ts`): dependências mockadas, sem banco.
- **Integração** (ex.: `routes.test.ts`): `buildApp()` + `app.inject()` contra um banco real, sem subir servidor HTTP.
- Os testes de integração usam o banco **`sefiteam_test`**, separado do de desenvolvimento. Ele é criado e migrado automaticamente pelo `vitest.global-setup.ts`, que se recusa a rodar se o `DATABASE_URL` não terminar em `_test`. Por isso o `npm test` precisa do Docker ligado.
- Cada arquivo de teste limpa o banco antes de cada caso (`src/test/db.ts`). Os arquivos rodam um por vez (`fileParallelism: false`), porque compartilham o banco.
- Variáveis de ambiente de teste ficam no `vitest.config.ts`.
- `npm run test:watch` roda os testes afetados a cada arquivo salvo; `npm run test:coverage` gera o relatório de cobertura em `coverage/`.

## Regras garantidas pela aplicação

Algumas regras não são garantidas pelo banco e precisam ser validadas no service, dentro de uma transação:

- Máximo de integrantes por grupo.
- Quantidade máxima de grupos por Física.
- Prazo da edição (bloqueia o aluno, não o admin).
- Multiturma desligado: todos os integrantes da mesma turma.

Detalhes em [docs/modelo-banco.md](../docs/modelo-banco.md).
