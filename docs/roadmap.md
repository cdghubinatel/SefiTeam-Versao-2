# Roadmap

O que já está pronto e o que vem a seguir. Atualize este arquivo quando uma etapa for concluída.

## Pronto

- [x] **Base do back-end**: Node + TypeScript (ESM), Fastify, Zod, Swagger em `/docs`, ESLint, Prettier, Vitest e CI no GitHub Actions.
- [x] **Banco de dados**: modelo completo ([modelo-banco.md](modelo-banco.md)), migrations e seed do admin.
- [x] **Autenticação**: login por e-mail (senha do aluno = curso + matrícula), `/auth/me`, logout que encerra as sessões e controle de acesso por papel ([autenticacao.md](autenticacao.md)).
- [x] **Dúvidas frequentes**: o admin cadastra, edita, apaga e reordena; qualquer usuário logado consulta ([duvidas-frequentes.md](duvidas-frequentes.md)).

## Próximos passos (back-end)

O front-end só começa quando o back-end estiver finalizado. Ordem combinada:

1. **Grupos**
   - O aluno cria um grupo ou entra num grupo existente em cada Física, até o prazo.
   - Regras: máximo de integrantes, quantidade de grupos por Física, prazo da edição e multiturma.
   - O admin pode adicionar e remover alunos e apagar grupos, inclusive após o prazo.
2. **Edições e upload da planilha** (aguardando a planilha de exemplo do cliente)
   - Criar a edição (semestre e prazo) e importar a planilha: uma aba por Física, com turmas e alunos. O **e-mail é obrigatório** (é o login), além de curso e matrícula.
   - Configurar cada Física: quantidade de grupos, mínimo e máximo de integrantes, multiturma.
   - Apenas uma edição ativa por vez.
   - Alunos novos são cadastrados com o e-mail normalizado e a senha `senhaDoAluno({ curso, matricula })`. Alunos já cadastrados em edições anteriores são reaproveitados.
3. **Alunos (admin)**: listagem de alunos e grupos.

Se a planilha chegar antes, edições pode passar na frente de grupos.

## Front-end

- [ ] Iniciar o projeto (React + Vite + React Router) e implementar as telas do [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), conforme o [front/README.md](../front/README.md). Só depois do back-end finalizado.

## Futuro

- [ ] **Senha aleatória por e-mail** via SMTP do Inatel, se o coordenador aprovar: fecha o risco de a senha ser curso + matrícula ([autenticacao.md](autenticacao.md#risco-aceito)). Incluiria o "Esqueci minha senha" e o "Reenviar senha" pelo admin, que saíram do escopo desta versão. O upload da planilha precisaria de uma fila com limite de envios por minuto, porque cadastra muitos alunos de uma vez.

## Pendências de design (Figma)

- [ ] **Tela de login**: o campo passa a ser **e-mail** (não mais curso + matrícula).
- [ ] **Admin/DuvidasFrequentes**: excluir dúvida (com confirmação), modo "Reordenar" (setinhas ↑/↓, "Salvar ordem" e "Cancelar") e o modal de adicionar/editar. Detalhes em [duvidas-frequentes.md](duvidas-frequentes.md#pendências-de-design-figma).

## Decisões em aberto

- [ ] Onde hospedar a API e o banco em produção (deploy).

### Checklist para o deploy

Itens que dependem de onde a API vai rodar:

- [ ] **`trustProxy`** no Fastify, se a API ficar atrás de um proxy reverso (Nginx, load balancer da hospedagem). Sem isso, `request.ip` é o IP do proxy e o rate limit do login passa a valer por e-mail apenas. Configurar só com o número de proxies confiáveis (nunca `true` cego, que permite falsificar o IP pelo header `X-Forwarded-For`).
- [ ] **`HOST=0.0.0.0`** quando a API rodar em container (o padrão `127.0.0.1` só aceita conexões da própria máquina).
- [ ] **`JWT_SECRET` forte** e próprio (a API recusa o de exemplo em produção), **`SWAGGER_ENABLED=false`** e **`CORS_ORIGIN`** com a URL real do front.
- [ ] **Seed do admin**: o `npm run db:seed` usa o `tsx`, que é dependência de desenvolvimento. Rodar o seed antes de podar as devDependencies, ou numa etapa separada.
- [ ] **Uma instância só da API**: o rate limit do login fica em memória. Com mais de uma instância, cada uma conta separado (precisaria de Redis).
