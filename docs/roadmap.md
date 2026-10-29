# Roadmap

O que já está pronto e o que vem a seguir. Atualize este arquivo quando uma etapa for concluída.

## Pronto

- [x] **Base do back-end**: Node + TypeScript (ESM), Fastify, Zod, Swagger em `/docs`, ESLint, Prettier, Vitest e CI no GitHub Actions.
- [x] **Banco de dados**: modelo completo ([modelo-banco.md](modelo-banco.md)), migrations e seed do admin.
- [x] **Autenticação**: login por curso + matrícula (senha do aluno = primeiro nome), `/auth/me`, logout que encerra as sessões e controle de acesso por papel ([autenticacao.md](autenticacao.md)).
- [x] **Dúvidas frequentes**: o admin cadastra, edita, apaga e reordena; qualquer usuário logado consulta ([duvidas-frequentes.md](duvidas-frequentes.md)).

## Próximos passos (back-end)

O front-end só começa quando o back-end estiver finalizado. Ordem combinada:

1. **Grupos** (em andamento, ver [grupos.md](grupos.md))
   - [x] Leitura do aluno: minhas Físicas (dashboard), grupos em que pode entrar, colegas disponíveis (busca sem acentos). Seed de demonstração (`npm run db:seed:demo`).
   - [x] Criar grupo (com colegas), com lock na Física e testes de concorrência. O grupo já nasce formado (`GRUPO_INCOMPLETO` abaixo do mínimo).
   - [x] Entrar num grupo, com testes de concorrência (última vaga, clique duplo, criar e entrar ao mesmo tempo).
   - [x] Mensagens de validação do Zod em português (`z.locales.ptBR`).
   - Entrega 4: ações de gerenciamento, dividida em três partes. O admin age em **qualquer edição** e **sem prazo**, mas respeita o máximo de integrantes e a turma; as telas do admin focam na última edição que está ou já foi ativa (o professor ajusta os grupos depois do prazo).
     - [x] **4a. Adicionar integrantes** (`POST /grupos/:grupoId/integrantes`): qualquer integrante, na edição ativa e até o prazo; o admin, em qualquer grupo. Tudo ou nada, com testes de concorrência.
     - [x] **4b. Remover integrante** (`DELETE /grupos/:grupoId/integrantes/:alunoId`, admin): um aluno por vez, responde `200 { grupo }`, com `grupo: null` quando o último integrante sai e o grupo é apagado em cascata. **Não existe rota de apagar grupo** (decisão do grupo; o Figma também não tem). Os outros grupos não são renumerados. Trocar um aluno de grupo = remover + adicionar (sem "mover").
     - [ ] **4c. Admin cria grupo e leituras do admin**. Criar: com a lista de alunos, respeitando o máximo, a turma e a quantidade de grupos, **sem exigir o mínimo**; `criado_por_id` = admin. Leituras mínimas para gerenciar: grupos de uma Física (com integrantes, vagas e `formado`) e alunos sem grupo (com a busca sem acentos), padrão na última edição ativa. O Figma (`Admin/ListaGrupos`) tem filtros por Física e por status do grupo, o contador "3/5 Integrantes" em cada card e o modal "Adicionar Aluno no Grupo", com busca por nome ou matrícula e filtro por Física-Turma.
   - O aluno cria um grupo ou entra num grupo existente em cada Física, até o prazo, e pode adicionar colegas ao seu grupo. Ele não sai do grupo; só o admin remove.
   - Regras: máximo de integrantes, quantidade de grupos por Física, prazo da edição e multiturma.
   - Sem histórico de quem fez cada ação: é controle interno da organização.
2. **Edições e upload da planilha** (formato definido: é o mesmo que a professora recebe e envia)
   - Criar a edição (semestre e prazo) e importar a planilha (`.xlsx`): uma aba por Física, com o nome da aba como código (`Fis1`, `Fis2`...). Colunas, na linha 1: **Curso** (sigla, ex.: `GES`), **Matricula**, **Aluno** (nome completo) e **Turma**. Não há e-mail nem a configuração das Físicas.
   - Configurar cada Física: quantidade de grupos, mínimo e máximo de integrantes, multiturma.
   - Apenas uma edição ativa por vez.
   - Alunos novos são cadastrados com `loginDoAluno({ curso, matricula })` e a senha `senhaDoAluno({ nome })`. Alunos já cadastrados em edições anteriores (mesmo curso + matrícula) são reaproveitados, atualizando o nome e a senha.
   - A definir no plano da entrega: lib para ler `.xlsx`, contrato da API do assistente (Upload → Prazo → Físicas → Revisão) e validações da planilha (coluna faltando, linha repetida, aluno em duas turmas da mesma aba).
3. **Alunos (admin)**: listagem completa de alunos e grupos (filtros, todas as Físicas), além das leituras mínimas da Entrega 4c. A planejar, com as perguntas de negócio de cada ação (o Figma `Admin/ListaAlunos` já tem as telas):
   - Adicionar um aluno à edição manualmente (matrícula, curso, nome, Física e turma), fora da planilha.
   - Editar um aluno, inclusive a turma (e se ele já estiver num grupo sem multiturma?).
   - Tirar um aluno da edição ("não estará mais presente nessa edição"; e se ele for o último integrante de um grupo?).
   - Exportar a planilha de grupos (botão nas duas telas).

## Front-end

- [ ] Iniciar o projeto (React + Vite + React Router) e implementar as telas do [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), conforme o [front/README.md](../front/README.md). Só depois do back-end finalizado.

## Futuro

- [ ] **Login com segurança**, se um dia for necessário: hoje login e senha do aluno não são secretos, de propósito ([autenticacao.md](autenticacao.md#sem-segurança-de-propósito)). Uma senha aleatória enviada por e-mail exigiria outra fonte de e-mail, porque a planilha não o traz.

## Pendências de design (Figma)

Lista completa em [pendencias-design.md](pendencias-design.md).

## Decisões em aberto

- [ ] Onde hospedar a API e o banco em produção (deploy).

### Checklist para o deploy

Itens que dependem de onde a API vai rodar:

- [ ] **`trustProxy`** no Fastify, se a API ficar atrás de um proxy reverso (Nginx, load balancer da hospedagem). Sem isso, `request.ip` é o IP do proxy e o rate limit do login passa a valer por login apenas. Configurar só com o número de proxies confiáveis (nunca `true` cego, que permite falsificar o IP pelo header `X-Forwarded-For`).
- [ ] **`HOST=0.0.0.0`** quando a API rodar em container (o padrão `127.0.0.1` só aceita conexões da própria máquina).
- [ ] **`JWT_SECRET` forte** e próprio (a API recusa o de exemplo em produção), **`SWAGGER_ENABLED=false`** e **`CORS_ORIGIN`** com a URL real do front.
- [ ] **Seed do admin**: o `npm run db:seed` usa o `tsx`, que é dependência de desenvolvimento. Rodar o seed antes de podar as devDependencies, ou numa etapa separada.
- [ ] **Uma instância só da API**: o rate limit do login fica em memória. Com mais de uma instância, cada uma conta separado (precisaria de Redis).
