# Pendências de design (Figma)

O que a API já faz (ou vai fazer), mas ainda não está desenhado no [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), ou foi desenhado de outro jeito. Marque o item quando o design for atualizado.

## Login

- [ ] **Tela de login**: o campo passa a ser **e-mail** (não mais curso + matrícula). Ver [autenticacao.md](autenticacao.md).

## Dúvidas frequentes

Regras em [duvidas-frequentes.md](duvidas-frequentes.md). A tela **Admin/DuvidasFrequentes** hoje só tem "Adicionar" e o lápis de editar. Faltam:

- [ ] **Excluir**: ação para apagar uma dúvida (ex.: botão no modal de edição), com confirmação.
- [ ] **Reordenar**: botão "Reordenar" e o modo com setinhas ↑/↓, "Salvar ordem" e "Cancelar", em desktop e mobile.
- [ ] **Modal de adicionar/editar**: o formulário de pergunta e resposta não está desenhado.

As telas mostram "Edição 2026/1" no subtítulo, mas as dúvidas são globais. Se o subtítulo ficar, ele vem da edição ativa, não das dúvidas.

## Grupos

Regras em [grupos.md](grupos.md).

- [ ] **Aluno adicionar colegas ao próprio grupo**: qualquer integrante pode incluir colegas sem grupo, até o prazo e respeitando o máximo e a turma. O Figma não tem essa ação. Sugestão: no card do grupo (dashboard) ou na tela "Montar Grupo", um botão "Adicionar colegas" que abre a mesma busca/seleção da aba "Criar um grupo", com o limite de vagas restantes.
- [ ] **"Montar Grupo" para quem já tem grupo**: a aba "Entrar em um grupo" não se aplica (a API responde `409 JA_EM_GRUPO`). A tela deve mostrar o grupo do aluno e a ação de adicionar colegas, ou o front não deve levar o aluno até ela.
- [ ] **Busca de colegas**: o placeholder "Buscar por nome ou matrícula" está certo; vale indicar que a busca ignora acentos e maiúsculas (ex.: "joao" encontra "João").
