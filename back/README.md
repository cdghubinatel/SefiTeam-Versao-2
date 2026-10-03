# SefiTeam — Back-end

API REST do SefiTeam.

## Stack

- Node.js + TypeScript
- [Fastify](https://fastify.dev/)
- [Prisma](https://www.prisma.io/) + PostgreSQL

> O projeto ainda não foi inicializado (`package.json`, dependências e `schema.prisma` serão criados na próxima etapa).

## Estrutura planejada

```
back/
├── prisma/
│   ├── schema.prisma       # Modelo (ver docs/modelo-banco.md)
│   └── migrations/
├── src/
│   ├── server.ts           # Inicialização do Fastify
│   ├── config/             # Variáveis de ambiente
│   ├── plugins/            # Plugins do Fastify (prisma, auth...)
│   └── modules/            # Um módulo por domínio
│       ├── auth/           # Login, troca de senha
│       ├── edicoes/        # Criação da edição, upload da planilha
│       ├── fisicas/
│       ├── alunos/
│       ├── grupos/         # Criar, entrar, remover, exportar
│       └── duvidas/        # Dúvidas Frequentes
└── .env.example
```

Cada módulo segue o padrão `routes.ts` (rotas + validação) → `service.ts` (regras de negócio) → Prisma.

## Variáveis de ambiente

Copie `.env.example` para `.env`.

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | URL de conexão do PostgreSQL |
| `PORT` | Porta da API |
| `JWT_SECRET` | Segredo para assinar tokens de sessão |

## Scripts previstos

| Script | Descrição |
|---|---|
| `npm run dev` | Sobe a API em modo desenvolvimento |
| `npm run build` | Compila para JavaScript |
| `npm start` | Roda a versão compilada |
| `npx prisma migrate dev` | Aplica as migrations no banco local |

## Regras garantidas pela aplicação

Algumas regras não são garantidas pelo banco e precisam ser validadas no service, dentro de uma transação:

- Máximo de integrantes por grupo.
- Quantidade máxima de grupos por Física.
- Prazo da edição (bloqueia o aluno, não o admin).
- Multiturma desligado: todos os integrantes da mesma turma.

Detalhes em [docs/modelo-banco.md](../docs/modelo-banco.md).
