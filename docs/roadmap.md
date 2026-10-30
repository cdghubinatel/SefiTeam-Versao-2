# Roadmap

O que já está pronto e o que vem a seguir. Atualize este arquivo quando uma etapa for concluída.

## Pronto

- [x] **Base do back-end**: Node + TypeScript (ESM), Fastify, Zod, Swagger em `/docs`, ESLint, Prettier, Vitest e CI no GitHub Actions.
- [x] **Banco de dados**: modelo completo ([modelo-banco.md](modelo-banco.md)), migrations e seed do admin.
- [x] **Autenticação**: login por curso + matrícula (senha do aluno = primeiro nome), `/auth/me`, logout que encerra as sessões e controle de acesso por papel ([autenticacao.md](autenticacao.md)).
- [x] **Dúvidas frequentes**: o admin cadastra, edita, apaga e reordena; qualquer usuário logado consulta ([duvidas-frequentes.md](duvidas-frequentes.md)).

## Próximos passos (back-end)

O front-end só começa quando o back-end estiver finalizado. Ordem combinada:

1. **Grupos** (pronto no back-end, ver [grupos.md](grupos.md))
   - [x] Leitura do aluno: minhas Físicas (dashboard), grupos em que pode entrar, colegas disponíveis (busca sem acentos). Seed de demonstração (`npm run db:seed:demo`).
   - [x] Criar grupo (com colegas), com lock na Física e testes de concorrência. O grupo já nasce formado (`GRUPO_INCOMPLETO` abaixo do mínimo).
   - [x] Entrar num grupo, com testes de concorrência (última vaga, clique duplo, criar e entrar ao mesmo tempo).
   - [x] Mensagens de validação do Zod em português (`z.locales.ptBR`).
   - Entrega 4: ações de gerenciamento, dividida em três partes. O admin age em **qualquer edição** e **sem prazo**, mas respeita o máximo de integrantes e a turma; as telas do admin focam na última edição que está ou já foi ativa (o professor ajusta os grupos depois do prazo).
     - [x] **4a. Adicionar integrantes** (`POST /grupos/:grupoId/integrantes`): qualquer integrante, na edição ativa e até o prazo; o admin, em qualquer grupo. Tudo ou nada, com testes de concorrência.
     - [x] **4b. Remover integrante** (`DELETE /admin/grupos/:grupoId/integrantes/:alunoId`): um aluno por vez, responde `200 { grupo }`, com `grupo: null` quando o último integrante sai e o grupo é apagado em cascata. **Não existe rota de apagar grupo** (decisão do grupo; o Figma também não tem). Os outros grupos não são renumerados. Trocar um aluno de grupo = remover + adicionar (sem "mover").
     - [x] **4c. Admin cria grupo e leituras do admin** (tela `Admin/ListaGrupos`): `GET /admin/grupos` (por padrão a última edição criada, mesmo finalizada, ou `?edicaoId=`; filtros por Física e status, sem paginação), `GET /admin/fisicas/:fisicaId/alunos-sem-grupo` (busca sem acentos e filtro por turma) e `POST /admin/fisicas/:fisicaId/grupos` (de 1 aluno até o máximo, **sem exigir o mínimo**, respeitando a turma e a quantidade de grupos; o admin fica como autor).
   - O aluno cria um grupo ou entra num grupo existente em cada Física, até o prazo, e pode adicionar colegas ao seu grupo. Ele não sai do grupo; só o admin remove.
   - Regras: máximo de integrantes, quantidade de grupos por Física, prazo da edição e multiturma.
   - Sem histórico de quem fez cada ação: é controle interno da organização.
2. **Edições e upload da planilha** (formato definido: é o mesmo que a professora recebe e envia). Decisões de 2026-10-29: **o front lê a planilha** (`read-excel-file/browser`) e guarda os passos do assistente (Upload → Prazo → Físicas → Revisão); só "Criar edição" chama a API, numa **rota única** com tudo em JSON. Sem upload de arquivo no back e sem rascunho no banco. Duas partes:
   - [x] **5a. Criar a edição** (`POST /admin/edicoes`, ver [edicoes.md](edicoes.md)): prazo e Físicas (código, configuração e alunos), gravados numa transação. A nova edição já nasce **ativa** e a anterior é **finalizada** (só uma ativa por vez). O back valida tudo de novo, porque a API não confia no front.
   - [ ] **5b. Leituras do admin**: lista de edições (para o seletor; hoje `GET /admin/grupos?edicaoId=`) e dashboard (`Dashboard/Admin/Vazio` e `Ativo`), com o card de cada Física contando **grupos formados / quantidade de grupos**.
   - Planilha (lida pelo front): só `.xlsx`, uma aba por Física, com o nome da aba como código (`Fis1`, `Fis2`...) e o nome derivado (`Fis1` → "Física 1"; fora desse padrão, o próprio código). Colunas na linha 1, em qualquer ordem e sem diferenciar maiúsculas nem acentos: **Curso** (sigla, ex.: `GES`), **Matricula**, **Aluno** (nome completo) e **Turma**. Não há e-mail nem a configuração das Físicas. Aba sem as colunas (ex.: instruções) é ignorada; aba com coluna faltando é erro.
   - Validações do back (todos os erros de uma vez, `400 VALIDACAO`, identificados pela Física e pelo aluno em `detalhes`, ex.: `{ campo: "Fis1", mensagem: "GES589 (Maria Souza) aparece nas turmas A e B." }`): campo vazio; Física sem alunos; o mesmo aluno (curso + matrícula) em duas turmas da mesma Física; o mesmo aluno com nomes diferentes em Físicas diferentes (diferença só de maiúsculas, acentos ou espaços não conta). Aluno repetido na mesma turma conta uma vez. Essas regras só aparecem para o professor no "Criar edição"; o front pode repetir as checagens simples para avisar antes.
   - Prazo: só a data, valendo até 23:59 (horário de Brasília), no futuro. O **semestre é calculado pela data limite** (até junho → `AAAA/1`; depois → `AAAA/2`); semestre repetido → `409 SEMESTRE_EXISTENTE`.
   - Configurar cada Física: quantidade de grupos, mínimo e máximo de integrantes, multiturma, sem valores padrão. Mínimo ≥ 1, máximo ≥ mínimo, grupos ≥ 1 e todos os alunos precisam caber (grupos × máximo ≥ alunos).
   - Alunos novos são cadastrados com `loginDoAluno({ curso, matricula })` e a senha `senhaDoAluno({ nome })`. Alunos já cadastrados em edições anteriores (mesmo curso + matrícula) são reaproveitados, atualizando o nome e a senha, sem deslogar.
   - A edição **não é editável depois de criada** nesta etapa (nem prazo, nem configuração, nem planilha).
   - Pendências de design do assistente e da gestão de edições em [pendencias-design.md](pendencias-design.md#edições-admin).
3. **Alunos (admin)**, em branch própria: listagem completa de alunos (tela `Admin/ListaAlunos`, com busca e filtros por Física e status do grupo). A planejar, com as perguntas de negócio de cada ação (o Figma `Admin/ListaAlunos` já tem as telas):
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
