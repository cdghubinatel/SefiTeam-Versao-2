# SefiTeam — Back-end

API REST do SefiTeam.

## Stack

- Node.js 24 (LTS) + TypeScript 6.0 (CommonJS)
- [Fastify](https://fastify.dev/) 5
- [Zod](https://zod.dev/) para validação (via `fastify-type-provider-zod`)
- [Prisma](https://www.prisma.io/) 7 + PostgreSQL
- Swagger (`@fastify/swagger` + `@fastify/swagger-ui`) em `/docs`
- Jest + ts-jest, ESLint e Prettier

> TypeScript fixado em `~6.0`: `ts-jest` e `typescript-eslint` ainda não suportam o TypeScript 7.

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
cp .env.example .env
npm install
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

| Script                   | Descrição                                        |
| ------------------------ | ------------------------------------------------ |
| `npm run dev`            | Sobe a API em modo desenvolvimento (watch)       |
| `npm run build`          | Compila para JavaScript em `dist/`               |
| `npm start`              | Roda a versão compilada                          |
| `npm run typecheck`      | Checa os tipos sem gerar arquivos                |
| `npm run lint`           | ESLint (`lint:fix` corrige o que for possível)   |
| `npm run format`         | Formata com Prettier (`format:check` só confere) |
| `npm test`               | Roda os testes (`test:watch`, `test:coverage`)   |
| `npx prisma migrate dev` | Aplica as migrations no banco local              |

## Testes

- Jest + ts-jest. Os arquivos `*.test.ts` ficam ao lado do código testado.
- Testes de rota usam `buildApp()` + `app.inject()`, sem subir servidor HTTP.
- Variáveis de ambiente de teste ficam em `jest.setup.js`.

## Regras garantidas pela aplicação

Algumas regras não são garantidas pelo banco e precisam ser validadas no service, dentro de uma transação:

- Máximo de integrantes por grupo.
- Quantidade máxima de grupos por Física.
- Prazo da edição (bloqueia o aluno, não o admin).
- Multiturma desligado: todos os integrantes da mesma turma.

Detalhes em [docs/modelo-banco.md](../docs/modelo-banco.md).
