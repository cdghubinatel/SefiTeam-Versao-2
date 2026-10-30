# Pendências de design (Figma)

O que a API já faz (ou vai fazer), mas ainda não está desenhado no [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam), ou foi desenhado de outro jeito. Marque o item quando o design for atualizado.

## Login

- [ ] **Tela de login**: os campos são **Login** (curso + matrícula, ex.: `GES589`) e **Senha** (o primeiro nome, ex.: `maria`), sem diferenciar maiúsculas nem acentos. Vale um texto de ajuda com esse formato, já que o aluno não recebe a senha. Ver [autenticacao.md](autenticacao.md).

## Edições (admin)

### Criar edição (`Admin/CriarEdição`)

O assistente tem quatro passos: Upload → Prazo → Físicas → Revisão. O **front lê a planilha** e guarda os passos; nada é gravado até "Criar edição", que envia tudo à API de uma vez.

- [ ] **Upload: só `.xlsx`**: a tela diz "Formatos aceitos: .xlsx, .csv", mas cada aba da planilha é uma Física, e um CSV não tem abas. Trocar para "Formato aceito: .xlsx".
- [ ] **Upload: erros de leitura**: o front acusa no Upload o que dá para ver no arquivo (não é `.xlsx`, aba com coluna faltando, célula vazia, nenhuma aba de Física), com a aba e a linha (ex.: "Fis1, linha 5: Matricula vazia."). Falta o estado de erro na tela (a lista, e o "Continuar" desabilitado) e o de carregando enquanto o arquivo é lido.
- [ ] **Upload: o que foi lido**: depois do upload, mostrar um resumo para o professor conferir antes de seguir (ex.: "3 Físicas: Fis1 (40 alunos, turmas A e B), Fis2 (...)").
- [ ] **Prazo: até que horas**: a tela tem só a data, e o prazo vale até **23:59 daquele dia** (horário de Brasília). Vale um texto de ajuda ("Os alunos podem montar grupos até 23:59 do dia escolhido"). A data precisa ser futura.
- [ ] **Semestre da edição**: nenhum passo tem o campo. Ele é **calculado pela data limite** (até junho → `2026/1`; de julho em diante → `2026/2`). Mostrar o semestre na Revisão (ex.: "Edição 2026/1") e o erro quando ele já existir ("Já existe a edição 2026/1").
- [ ] **Físicas: alunos e turmas da Física**: o card "Configuração — Física 1" não mostra quantos alunos e quais turmas a Física tem, e o professor precisa disso para escolher a quantidade de grupos e o máximo (ex.: "40 alunos · turmas A e B").
- [ ] **Físicas: validação dos campos**: mínimo ≥ 1, máximo ≥ mínimo, grupos ≥ 1, e **todos os alunos precisam caber** (grupos × máximo ≥ alunos; ex.: "Fis1 tem 40 alunos, mas 5 grupos de até 6 cabem 30."). Falta onde mostrar essas mensagens, e o "Próxima Física" desabilitado.
- [ ] **Revisão: edição ativa será finalizada**: criar uma edição nova **finaliza a edição ativa** (só há uma ativa por vez). A Revisão deve avisar antes ("A edição 2026/1 será finalizada e vira histórico"). Também cabe o total de alunos da edição.
- [ ] **Revisão: erros ao criar**: algumas regras só a API confere, e só no "Criar edição": semestre já existente, aluno em duas turmas da mesma Física, o mesmo aluno com nomes diferentes em Físicas diferentes, configuração inválida. A API devolve todos de uma vez, identificados pela Física e pelo aluno (ex.: "Fis1: GES589 (Maria Souza) aparece nas turmas A e B."). Falta o lugar da lista na Revisão, com o caminho de volta ao Upload para trocar a planilha.

### Gerenciar edições

- [ ] **Lista de edições (histórico)**: não há tela com as edições anteriores. O admin altera grupos de **qualquer edição** (para ajustar alunos depois do prazo), mas todas as telas mostram só "Edição 2026/1". Falta uma tela ou um seletor (ex.: no subtítulo ou no header) com semestre, prazo e situação (ativa / finalizada), que leve aos grupos e alunos daquela edição. Sem escolher, as telas mostram a última edição criada.
- [ ] **Edição não é editável depois de criada** (decisão desta etapa): prazo e configuração das Físicas só mudam dentro do assistente (os "Editar" da Revisão). Nenhuma tela deve oferecer editar a edição criada, nem trocar a planilha.
- [ ] **Finalizar edição**: não existe ação separada; a edição ativa é finalizada quando a próxima é criada. Se o professor precisar finalizar sem criar outra, a tela e a regra precisam ser definidas.
- [ ] **Dashboard do admin, card de cada Física** (`Dashboard/Admin/Ativo`): o "14/20" conta **grupos formados / quantidade de grupos** da Física. Escrever o rótulo no card (ex.: "14/20 grupos formados").

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
- [ ] **Admin: erros ao adicionar alunos a um grupo**: o modal "Adicionar Aluno no Grupo" (`Admin/ListaGrupos`) já existe e bate com a API (`POST /grupos/:grupoId/integrantes`). Como o admin também respeita o máximo e a turma, o modal precisa de um lugar para a mensagem de `409` (`GRUPO_CHEIO`, `TURMA_DIFERENTE`, `JA_EM_GRUPO`), e o "Confirmar" deveria ficar desabilitado quando a seleção passa das vagas (o contador "4/5 Integrantes" já ajuda).
- [ ] **Admin: opções do filtro "Status de grupo"** (`Admin/ListaGrupos`): o dropdown só mostra "Todos". A API aceita **Formado** e **Não formado** (`status=formado` / `nao-formado` em `GET /admin/grupos`), os mesmos textos da coluna "Status do grupo" da ListaAlunos.
- [ ] **Admin: confirmar antes de remover um integrante**: a lixeira de cada integrante (`Admin/ListaGrupos`) não tem modal de confirmação, e a API remove na hora (`DELETE /admin/grupos/:grupoId/integrantes/:alunoId`). Sugestão: um modal como o "Confirmar Deletar o Aluno?", avisando quando o aluno é o último integrante, porque aí o grupo é apagado junto.
- [ ] **Busca de colegas**: o placeholder "Buscar por nome ou matrícula" está certo; vale indicar que a busca ignora acentos e maiúsculas (ex.: "joao" encontra "João").

## Alunos (admin)

- [ ] **Campo e-mail nos modais "Adicionar Aluno" e "Editar Aluno"** (`Admin/ListaAlunos`): a planilha não traz e-mail e o sistema não usa e-mail (login = curso + matrícula). Remover o campo.
