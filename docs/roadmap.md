# Roadmap

O que já está pronto e o que vem a seguir. Atualize este arquivo quando uma etapa for concluída.

## Pronto

- [x] **Base do back-end**: Node + TypeScript (ESM), Fastify, Zod, Swagger em `/docs`, ESLint, Prettier, Vitest e CI no GitHub Actions.
- [x] **Banco de dados**: modelo completo ([modelo-banco.md](modelo-banco.md)), migrations e seed do admin.
- [x] **Autenticação**: login, `/auth/me`, logout que encerra as sessões e controle de acesso por papel ([autenticacao.md](autenticacao.md)).
- [x] **Dúvidas frequentes**: o admin cadastra, edita, apaga e reordena; qualquer usuário logado consulta ([duvidas-frequentes.md](duvidas-frequentes.md)).

## Próximos passos (back-end)

O front-end só começa quando o back-end estiver finalizado. Ordem combinada:

1. **E-mail e senhas**
   - Envio por SMTP com Nodemailer; Mailpit no `docker-compose` em desenvolvimento.
   - Geração de senha aleatória (usada pelo upload da planilha e pela recuperação).
   - "Esqueci minha senha" na tela de login e "Reenviar senha" pelo admin ([autenticacao.md](autenticacao.md)).
2. **Grupos**
   - O aluno cria um grupo ou entra num grupo existente em cada Física, até o prazo.
   - Regras: máximo de integrantes, quantidade de grupos por Física, prazo da edição e multiturma.
   - O admin pode adicionar e remover alunos e apagar grupos, inclusive após o prazo.
3. **Edições e upload da planilha** (aguardando a planilha de exemplo do cliente)
   - Criar a edição (semestre e prazo) e importar a planilha: uma aba por Física, com turmas e alunos (incluindo o e-mail).
   - Configurar cada Física: quantidade de grupos, mínimo e máximo de integrantes, multiturma.
   - Apenas uma edição ativa por vez.
   - Alunos novos recebem uma **senha aleatória por e-mail**. Alunos já cadastrados em edições anteriores são reaproveitados e não recebem uma senha nova.
4. **Alunos (admin)**: listagem de alunos e grupos.

Se a planilha chegar antes, edições pode passar na frente de grupos.

## Front-end

- [ ] Iniciar o projeto (React + Vite + React Router) e implementar as telas do [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), conforme o [front/README.md](../front/README.md). Só depois do back-end finalizado.

## Pendências de design (Figma)

- [ ] **Tela de login**: link "Esqueci minha senha" e a tela de confirmação.
- [ ] **Admin/ListaAlunos**: ação "Reenviar senha" por aluno.
- [ ] **Admin/DuvidasFrequentes**: excluir dúvida (com confirmação), modo "Reordenar" (setinhas ↑/↓, "Salvar ordem" e "Cancelar") e o modal de adicionar/editar. Detalhes em [duvidas-frequentes.md](duvidas-frequentes.md#pendências-de-design-figma).

## Decisões em aberto

- [ ] Onde hospedar a API e o banco em produção (deploy).
- [ ] Qual servidor SMTP usar em produção para enviar os e-mails.
