# CLAUDE.md

Contexto para o Claude Code neste repositório. Regras de negócio no `README.md`; detalhes em `docs/` (`modelo-banco.md`, `autenticacao.md`, `roadmap.md`) e em `back/README.md`.

## Forma de trabalho

Atue como engenheiro de software sênior: o objetivo é código de alta qualidade, no padrão de projetos modernos, e não apenas código que funciona.

**Antes de implementar**

- Ler os docs e o código relacionados antes de propor qualquer coisa. Seguir os padrões já estabelecidos no projeto.
- Levantar **todas** as dúvidas de negócio e de engenharia (tecnologia, modelagem, contrato da API, regras, casos de borda) e perguntar. Cada pergunta vem com uma **recomendação** e o motivo. Não assumir decisões que são do usuário ou do grupo.
- Para um módulo novo, apresentar um plano curto (o que será feito, arquivos, decisões) e esperar a confirmação antes de codar.
- **Não adicionar dependência, mudar a stack nem alterar uma decisão já documentada sem perguntar.** Ao sugerir uma lib, conferir no npm a versão atual e a compatibilidade com a stack.

**Durante**

- Trabalhar em **entregas pequenas**. Ao fim de cada uma, parar e esperar o usuário validar antes de seguir. O usuário aprova cada edição de arquivo manualmente.
- Toda funcionalidade nova vem com testes: unitários para regras do service e de integração para as rotas, cobrindo os casos de erro e de borda, não só o caminho feliz. Ao corrigir um bug, primeiro escrever o teste que o reproduz.
- Evitar gambiarras. Se um workaround for inevitável, explicar o porquê, comentar no código e registrar no doc pertinente.
- Quando algo der errado, investigar a causa raiz antes de corrigir.

**Ao entregar**

- Antes de dizer que terminou, rodar `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` (testes + cobertura mínima, como no CI) e `npm run build`, e testar a funcionalidade de ponta a ponta (API rodando / Swagger).
- Relatar com honestidade: o que foi feito, o que foi verificado, o que não foi verificado e quais decisões foram tomadas. Destacar as decisões que o usuário deve revisar.
- Atualizar a documentação afetada (`docs/`, READMEs, este arquivo) e o `docs/roadmap.md`.
- Explicar em linguagem simples quando o usuário pedir. Ele também quer entender o que o código faz do ponto de vista de quem usa o sistema e programa.

**Regras fixas**

- **Não rodar git que altere o repositório** (commit, push, branch, stash, checkout, merge). Quem faz isso é o usuário. Comandos de leitura (`git status`, `git diff`) podem ser usados.
- Ao fim de cada entrega validada, o usuário costuma pedir: (1) sugestão de branch; (2) lista de commits (título em Conventional Commits, em inglês, + arquivos); (3) descrição do PR num `.md` para copiar, sem emojis, no template do grupo (`.github/pull_request_template.md`: Por quê? / O que foi feito? / Pontos de atenção / Como testar? / Testes realizados / Checklist com "Reconhecimento de uso de IA" / Comentários / Evidências).
- Conversa e documentação em **português**. No código: domínio em português (`usuario`, `papel`, `edicao`), termos técnicos em inglês (`routes.ts`, `service.ts`, `plugins/`).

## Back-end (`back/`)

Comandos (rodar dentro de `back/`; o Docker precisa estar ligado para banco e testes):

```bash
docker compose up -d     # na raiz: PostgreSQL
npm run dev              # API em http://127.0.0.1:3333, Swagger em /docs
npm test                 # Vitest (integração usa o banco sefiteam_test)
npm run typecheck && npm run lint && npm run format:check
npm run db:migrate       # nova migration / aplicar no banco local
npm run db:seed          # admin a partir de ADMIN_EMAIL / ADMIN_SENHA
npm run db:seed:demo     # edição ativa DEMO com Físicas, alunos e grupo (teste manual de grupos)
```

Convenções:

- **ESM**: imports relativos com extensão `.js` (`from './config/env.js'`); `verbatimModuleSyntax` ligado → imports só de tipo usam `import type`.
- Módulos em `src/modules/<dominio>/`: `schemas.ts` (Zod) → `routes.ts` (rotas + validação) → `service.ts` (regras, recebe `{ prisma }` como dependência, sem saber de HTTP).
- **Toda rota exige token por padrão.** Rota pública: `config: { publica: true }`. Restrição por papel: `config: { papeis: ['ADMIN'] }`. O usuário logado fica em `request.usuario`.
- Erros: lançar subclasses de `AppError` (`src/shared/errors/app-error.ts`); a resposta sai como `{ erro: { codigo, mensagem } }`. Novos códigos devem entrar na tabela de `docs/autenticacao.md`.
- Schemas de resposta com Zod em todas as rotas (eles geram o Swagger); erros documentados com `erroSchema`.
- Testes `*.test.ts` ao lado do código, importando de `'vitest'`. Unitários mockam o Prisma; os de integração usam `buildApp()` + `app.inject()` e `src/test/db.ts` (`limparBanco`, `criarUsuario`).
- Login é o **e-mail** (`usuario.email`, único), sempre gravado com `normalizarEmail` (minúsculas). A senha do aluno é `senhaDoAluno({ curso, matricula })` (ex.: `GES589`) e é comparada sem diferenciar maiúsculas; a do admin, exata. Tudo em `src/modules/auth/service.ts`.
- Testes que precisam de edição/Física/turma/inscrição/grupo: helpers `criarEdicao`, `criarFisica`, `criarAluno`, `inscrever`, `criarGrupo` em `src/test/db.ts`.
- Busca de alunos por texto: ignora acentos com `unaccent` via `$queryRaw` (ver `alunosDaBusca` em `modules/grupos/service.ts`). Em qualquer `LIKE`/`contains`, passar o texto por `escaparLike` (`src/lib/prisma.ts`), senão `%` e `_` viram curingas.
- Regras que dependem de contagem ou de prazo (máximo de integrantes, quantidade de grupos, prazo, multiturma) ficam no service, **dentro de transação**.

Armadilhas conhecidas:

- **TypeScript fixado em `~6.0`**: o `typescript-eslint` ainda não suporta a 7.
- **Prisma fixado em `7.10.0`**: a tag `latest` do npm aponta para uma RC da 8. Não aplicar `npm audit fix --force` (rebaixa o Prisma para a 6). As vulnerabilidades apontadas (`mysql2`, `deepmerge-ts`) vêm do pacote `prisma` (CLI). Ele é _peer dependency_ do `@prisma/client`, então **também é instalado em produção** (`npm ci --omit=dev`), o que serve para rodar o `prisma migrate deploy`. O risco real é baixo: não usamos MySQL, e o `deepmerge-ts` é dependência do `@prisma/config` (carregamento de configuração do CLI), não do código da API. Acompanhar a correção nas versões 7.x pelo Dependabot.
- **`vite` declarado nas devDependencies de propósito** (peer do Vitest; ver `back/README.md`). Sem ele, o `npm install` apaga do lock os binários nativos do rolldown/lightningcss e o Vitest quebra. Depois de instalar um pacote, conferir no `git diff package-lock.json` se só entrou o que devia.
- O `CHECK(minimo_integrantes <= maximo_integrantes)` está escrito à mão na migration inicial. Ao gerar migrations, conferir que o Prisma não tentou removê-lo.
- Apagar grupo: a FK `(grupo_id, fisica_id)` é `ON DELETE RESTRICT`; desvincular os integrantes antes, na mesma transação.
- URLs do banco usam **`127.0.0.1`**, não `localhost` (na máquina do usuário, outro processo escuta em `::1:5432`).
- O usuário costuma deixar `npm run dev` rodando na porta 3333. Para testar a API compilada, usar outra porta (`PORT=3399`).
- Depois de mudar o `schema.prisma`, rodar `npm run db:generate` e reiniciar o `npm run dev`.
- `ADMIN_SENHA` precisa ter 16+ caracteres, senão o `db:seed` falha (o valor do `.env.example` é recusado de propósito).
- O ESLint usa regras com tipos (`recommendedTypeChecked`), inclusive nos testes: promise solta precisa de `await`, `.catch` ou `void` explícito, e `any` não passa. Nos testes, tipar o corpo com `resposta.json<T>()` (com `z.infer` do schema da rota) e ler erros com `erroDa(resposta)` (`src/test/http.ts`).
- A API escuta em `HOST` (padrão `127.0.0.1`) e o Postgres do compose só em `127.0.0.1`: não expor dev na rede local/VPN.

## Front-end (`front/`)

Ainda não iniciado. Planejado: React + TypeScript + Vite + React Router; telas e rotas em `front/README.md`; design no Figma (link no `README.md`). O token fica no `localStorage` e vai em `Authorization: Bearer <token>`; `401` → apagar o token e ir para `/login`; `403` → tela "sem acesso" (sem deslogar).
