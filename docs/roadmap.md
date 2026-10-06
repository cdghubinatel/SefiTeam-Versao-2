# Roadmap

O que já está pronto e o que vem a seguir. Atualize este arquivo quando uma etapa for concluída.

## Pronto

- [x] **Base do back-end**: Node + TypeScript (ESM), Fastify, Zod, Swagger em `/docs`, ESLint, Prettier, Vitest e CI no GitHub Actions.
- [x] **Banco de dados**: modelo completo ([modelo-banco.md](modelo-banco.md)), migrations e seed do admin.
- [x] **Autenticação**: login, `/auth/me`, logout que encerra as sessões e controle de acesso por papel ([autenticacao.md](autenticacao.md)).

## Próximos passos (back-end)

Na ordem em que dependem um do outro:

1. **Edições e upload da planilha**
   - Criar a edição (semestre e prazo) e importar a planilha: uma aba por Física, com turmas e alunos (incluindo o e-mail).
   - Configurar cada Física: quantidade de grupos, mínimo e máximo de integrantes, multiturma.
   - Apenas uma edição ativa por vez.
   - Alunos novos recebem uma **senha aleatória por e-mail** (SMTP com Nodemailer; Mailpit em desenvolvimento). Alunos já cadastrados em edições anteriores são reaproveitados e não recebem uma senha nova.
2. **Grupos**
   - O aluno cria um grupo ou entra num grupo existente em cada Física, até o prazo.
   - Regras: máximo de integrantes, quantidade de grupos por Física, prazo da edição e multiturma.
   - O admin pode adicionar e remover alunos e apagar grupos, inclusive após o prazo.
3. **Alunos (admin)**: listagem de alunos e grupos, e reenvio de senha.
4. **Dúvidas frequentes**: o admin cadastra e edita; os alunos consultam.
5. **Recuperação de senha**: "Esqueci minha senha" na tela de login e "Reenviar senha" pelo admin.

## Front-end

- [ ] Iniciar o projeto (React + Vite + React Router) e implementar as telas do [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), conforme o [front/README.md](../front/README.md).

## Pendências de design (Figma)

- [ ] **Tela de login**: link "Esqueci minha senha" e a tela de confirmação.
- [ ] **Admin/ListaAlunos**: ação "Reenviar senha" por aluno.

## Decisões em aberto

- [ ] Onde hospedar a API e o banco em produção (deploy).
- [ ] Qual servidor SMTP usar em produção para enviar os e-mails.
