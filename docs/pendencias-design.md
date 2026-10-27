# Pendências de design (Figma)

O que a API já faz (ou vai fazer), mas ainda não está desenhado no [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), ou foi desenhado de outro jeito. Marque o item quando o design for atualizado.

## Login

- [ ] **Tela de login**: os campos são **Login** (curso + matrícula, ex.: `GES589`) e **Senha** (o primeiro nome, ex.: `maria`), sem diferenciar maiúsculas nem acentos. Vale um texto de ajuda com esse formato, já que o aluno não recebe a senha. Ver [autenticacao.md](autenticacao.md).

## Físicas

- [ ] **Código da Física**: é o nome da aba da planilha, como está (`Fis1`, `Fis2`...), não `F01`. As telas que mostram "F01-A" passam a mostrar "Fis1-A" (código da Física + turma).

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
- [ ] **Criar grupo: mínimo de colegas.** O grupo já nasce formado: o botão "Criar grupo" deve ficar desabilitado até quem cria + selecionados atingir o mínimo da Física (ex.: "1/2 selecionados — selecione mais 1 colega"). O contador "3/5 selecionados" do Figma já vai nessa direção; falta o estado desabilitado e a mensagem. Se a API responder `409 GRUPO_INCOMPLETO`, mostrar a mensagem dela.
- [ ] **Busca de colegas**: o placeholder "Buscar por nome ou matrícula" está certo; vale indicar que a busca ignora acentos e maiúsculas (ex.: "joao" encontra "João").
