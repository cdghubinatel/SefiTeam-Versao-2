# Grupos

O aluno cria um grupo ou entra num grupo existente em cada Física em que está inscrito, até o prazo da edição, e pode adicionar colegas ao seu grupo. O admin adiciona e remove alunos, inclusive depois do prazo; o grupo que fica vazio é apagado.

Código em `back/src/modules/grupos/`. Tabelas `grupo` e `inscricao` ([modelo-banco.md](modelo-banco.md)).

> Pronto no back-end: as ações do aluno (ler, criar, entrar, adicionar colegas) e as do admin (lista de grupos, alunos sem grupo, criar grupo, adicionar e remover integrantes). A listagem completa de alunos do admin e as ações da tela ListaAlunos ficam para outra entrega ([roadmap](roadmap.md#próximos-passos-back-end)). O que falta no Figma está em [pendencias-design.md](pendencias-design.md#grupos).

## Regras

- O aluno só vê e age nas Físicas da **edição ativa** em que está inscrito.
- O admin age em **qualquer edição** e **sem prazo**: o professor ajusta os grupos depois da data limite (ex.: aluno que não entrou num grupo a tempo). A lista de grupos do admin mostra por padrão a **última edição criada**, mesmo que já esteja finalizada (`?edicaoId=` escolhe outra; o seletor de edição ainda não está no Figma).
- Ao **criar** um grupo, o aluno entra nele automaticamente e pode incluir colegas sem grupo naquela Física. Os colegas entram na hora, sem precisar aceitar. **O grupo já nasce formado:** quem cria + colegas precisa atingir o mínimo de integrantes da Física (com mínimo 2, pelo menos 1 colega). Só dá para criar sozinho se o mínimo for 1.
- Depois, **qualquer integrante** (não só quem criou) pode adicionar colegas sem grupo, até o prazo, respeitando o máximo e a turma. O admin também adiciona, pela mesma rota, em qualquer grupo e sem prazo, mas **respeitando o máximo e a turma**, como o aluno.
- Para trocar um aluno de grupo, o admin remove e depois adiciona (não existe "mover"). Adicionar quem já tem grupo dá `409 JA_EM_GRUPO`.
- Cada aluno fica em **um único grupo** por Física. Ações de quem já tem grupo (entrar, criar outro) dão `409 JA_EM_GRUPO`.
- O aluno **não sai** do grupo. Só o admin remove integrantes, um por vez. Quando o admin remove o último integrante, o grupo é apagado junto: não existe grupo vazio nem uma ação separada de apagar grupo (decisão do grupo; o Figma também não tem). Os outros grupos **não** são renumerados, e o número que ficou livre vai para o próximo grupo criado.
- **Formado**: o grupo atingiu o mínimo de integrantes da Física. Continua aceitando alunos até o máximo. Como todo grupo criado pelo aluno nasce formado, `formado: false` só aparece quando um grupo perde integrantes (remoção pelo admin) ou quando o admin cria um grupo abaixo do mínimo.
- **Multiturma desligado**: o grupo só aceita alunos da turma dos integrantes atuais.
- **Quantidade de grupos**: o total por Física, mesmo com o multiturma desligado. Risco: uma turma pode ocupar todos os grupos e deixar a outra sem nenhum. Cabe ao professor configurar uma quantidade que comporte todas as turmas.
- **Numeração**: um grupo novo recebe o menor número livre na Física (com os grupos 1, 3 e 4, o próximo é o 2).
- Curso e matrícula dos colegas aparecem para o aluno (como no Figma). Com isso, ele sabe o login dos colegas; foi aceito, porque o login não tem segurança de propósito ([autenticacao.md](autenticacao.md#sem-segurança-de-propósito)).

## Rotas

| Método | Rota                                          | Acesso       | Resposta                                                |
| ------ | --------------------------------------------- | ------------ | ------------------------------------------------------- |
| GET    | `/fisicas/minhas`                             | ALUNO        | `200` Físicas do aluno na edição ativa                  |
| GET    | `/fisicas/:fisicaId/grupos`                   | ALUNO        | `200` grupos em que o aluno pode entrar; `404`; `409`   |
| GET    | `/fisicas/:fisicaId/colegas-disponiveis`      | ALUNO        | `200` colegas que ele pode incluir; `404`               |
| POST   | `/fisicas/:fisicaId/grupos`                   | ALUNO        | `201` grupo criado; `400`; `404`; `409`                 |
| POST   | `/grupos/:grupoId/entrar`                     | ALUNO        | `200` grupo atualizado; `400`; `404`; `409`             |
| POST   | `/grupos/:grupoId/integrantes`                | ALUNO, ADMIN | `200` grupo atualizado; `400`; `404`; `409`             |
| DELETE | `/admin/grupos/:grupoId/integrantes/:alunoId` | ADMIN        | `200` `{ grupo }` (`null` se foi apagado); `400`; `404` |
| GET    | `/admin/grupos`                               | ADMIN        | `200` edição, Físicas e grupos; `400`; `404`            |
| GET    | `/admin/fisicas/:fisicaId/alunos-sem-grupo`   | ADMIN        | `200` alunos sem grupo; `400`; `404`                    |
| POST   | `/admin/fisicas/:fisicaId/grupos`             | ADMIN        | `201` grupo criado; `400`; `404`; `409`                 |

`:fisicaId` precisa ser inteiro positivo; senão, `400 VALIDACAO`. Física inexistente, de outra edição ou em que o aluno não está inscrito: `404 NAO_ENCONTRADO` ("Física não encontrada.").

### Formatos

**Aluno** (integrante ou colega): `{ id, nome, curso, matricula, turma }`. `turma` é o código na Física (ex.: `"A"`); o front monta "GES 589 · Turma F01-A".

**Grupo**: `{ id, numero, fisicaId, formado, integrantes }`. Os integrantes vêm em ordem de entrada no grupo.

### `GET /fisicas/minhas`

Usada no dashboard do aluno.

```json
{
  "edicao": { "semestre": "2026/1", "dataLimite": "2026-06-17T02:59:59.000Z" },
  "fisicas": [
    {
      "id": 1,
      "codigo": "F01",
      "nome": "Física 1",
      "minimoIntegrantes": 5,
      "maximoIntegrantes": 10,
      "multiturma": false,
      "turma": "A",
      "grupo": null
    }
  ]
}
```

Sem edição ativa: `{ "edicao": null, "fisicas": [] }`. As Físicas vêm em ordem de código.

### `GET /fisicas/:fisicaId/grupos`

Aba "Entrar em um grupo". Só os grupos em que o aluno pode entrar agora: com vaga e, sem multiturma, da turma dele. Ordenados por número. Lista vazia = tela "Nenhum grupo com vaga no momento". Se o aluno já tem grupo nesta Física: `409 JA_EM_GRUPO` (o front mostra o grupo dele, que vem em `/fisicas/minhas`).

### `GET /fisicas/:fisicaId/colegas-disponiveis?busca=`

Aba "Criar um grupo" e, para quem já tem grupo, a seleção de colegas para adicionar a ele. Colegas inscritos na Física, sem grupo e, sem multiturma, da mesma turma, sem o próprio aluno, em ordem de nome.

- `busca` (opcional, até 100 caracteres): parte do nome (inclusive só o sobrenome) ou da matrícula, **sem diferenciar maiúsculas nem acentos** ("joao" encontra "João"). Espaços nas pontas são ignorados; vazia lista todos.
- Implementação: a extensão `unaccent` do Postgres, numa consulta `$queryRaw` (o Prisma não aplica funções no `where`). O texto vai como parâmetro (sem risco de SQL injection), e `%`, `_` e `\` são buscados literalmente (`escaparLike` em `back/src/lib/prisma.ts`).

### `POST /fisicas/:fisicaId/grupos`

Aba "Criar um grupo". Corpo: `{ "colegas": [7, 8] }`, com os **ids de aluno** que vêm de `colegas-disponiveis`. Quem cria + colegas precisa ficar entre o mínimo e o máximo de integrantes da Física; vazio ou `{}` só é aceito se o mínimo for 1. Responde `201` com o grupo criado (mesmo formato de **Grupo**).

- Quem cria entra no grupo, junto com os colegas (sem aceite), e fica registrado como autor (`grupo.criado_por_id`).
- O grupo recebe o **menor número livre** da Física.
- Todos ficam com o mesmo `entrou_no_grupo_em`, então, na resposta, os integrantes do grupo recém-criado aparecem em ordem de nome.

Erros, na ordem em que são checados:

| Status | Código             | Quando                                                                                                        |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDACAO`        | Ids repetidos, inválidos ou mais de 50; ou o próprio aluno em `colegas` (`detalhes` aponta o campo `colegas`) |
| 404    | `NAO_ENCONTRADO`   | Física fora da edição ativa ou aluno não inscrito ("Física não encontrada.")                                  |
| 409    | `PRAZO_ENCERRADO`  | Depois da data limite da edição                                                                               |
| 409    | `JA_EM_GRUPO`      | Quem cria já tem grupo nesta Física                                                                           |
| 409    | `GRUPO_CHEIO`      | `1 + colegas` passa do máximo de integrantes                                                                  |
| 409    | `GRUPO_INCOMPLETO` | `1 + colegas` fica abaixo do mínimo de integrantes ("Selecione mais colegas.")                                |
| 404    | `NAO_ENCONTRADO`   | Um colega não está inscrito nesta Física ("Um dos alunos selecionados não está inscrito nesta Física.")       |
| 409    | `JA_EM_GRUPO`      | Um colega já tem grupo (a mensagem traz o nome dele)                                                          |
| 409    | `TURMA_DIFERENTE`  | Sem multiturma, um colega é de outra turma (a mensagem traz o nome dele)                                      |
| 409    | `LIMITE_DE_GRUPOS` | A Física já tem `quantidade_grupos` grupos                                                                    |

Em qualquer erro, nada é gravado.

### `POST /grupos/:grupoId/entrar`

Aba "Entrar em um grupo". Sem corpo. O aluno entra no grupo e recebe o grupo atualizado (`200`, mesmo formato de **Grupo**), com ele por último na lista de integrantes (ordem de entrada). O `formado` já reflete a entrada.

Erros, na ordem em que são checados:

| Status | Código            | Quando                                                                                                                      |
| ------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDACAO`       | `grupoId` não é inteiro positivo                                                                                            |
| 404    | `NAO_ENCONTRADO`  | Grupo inexistente, de edição inativa ou de Física em que o aluno não está inscrito ("Grupo não encontrado." nos três casos) |
| 409    | `PRAZO_ENCERRADO` | Depois da data limite da edição                                                                                             |
| 409    | `JA_EM_GRUPO`     | O aluno já tem grupo nesta Física (inclusive este mesmo)                                                                    |
| 409    | `GRUPO_CHEIO`     | O grupo já tem o máximo de integrantes                                                                                      |
| 409    | `TURMA_DIFERENTE` | Sem multiturma, o grupo é de outra turma                                                                                    |

Os três casos de `404` têm a mesma mensagem de propósito: o aluno não precisa (nem deve) saber se um grupo de outra Física ou de outra edição existe.

### `POST /grupos/:grupoId/integrantes`

Adiciona alunos a um grupo existente. Corpo: `{ "alunos": [7, 8] }`, com 1 a 50 **ids de aluno**, sem repetir (o aluno os obtém em `colegas-disponiveis`). Os novos entram sem precisar aceitar e aparecem depois dos integrantes atuais (entre eles, em ordem de nome). Responde `200` com o grupo atualizado (formato **Grupo**). É **tudo ou nada**: se um aluno da lista falhar, ninguém é adicionado.

- **Aluno**: só no grupo de que é integrante, na edição ativa e até o prazo. Incluir o próprio id dá `400 VALIDACAO` ("Não inclua você mesmo: informe só os colegas que vão entrar no grupo."), como no criar: mandar o próprio id é erro de quem montou a requisição, e a tela nem oferece essa opção. Essa checagem vem antes de todas, inclusive para quem não é integrante; por isso a mensagem não diz "você já está neste grupo".
- **Admin**: qualquer grupo, de qualquer edição, sem prazo.
- Os dois respeitam o **máximo de integrantes** e, sem multiturma, a **turma do grupo**.

Erros, na ordem em que são checados:

| Status | Código            | Quando                                                                                                                                                              |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDACAO`       | `grupoId` inválido; `alunos` vazio, com ids repetidos, inválidos ou mais de 50; (aluno) o próprio id em `alunos` (`detalhes` aponta o campo `alunos`)               |
| 404    | `NAO_ENCONTRADO`  | "Grupo não encontrado.": grupo inexistente. Para o aluno, também grupo de edição inativa, de Física em que ele não está inscrito ou de que ele **não é integrante** |
| 409    | `PRAZO_ENCERRADO` | (só aluno) depois da data limite da edição                                                                                                                          |
| 409    | `GRUPO_CHEIO`     | Integrantes atuais + novos passam do máximo                                                                                                                         |
| 404    | `NAO_ENCONTRADO`  | Um aluno da lista não está inscrito nesta Física ("Um dos alunos selecionados não está inscrito nesta Física.")                                                     |
| 409    | `JA_EM_GRUPO`     | Um aluno da lista já tem grupo, inclusive este (a mensagem traz o nome dele)                                                                                        |
| 409    | `TURMA_DIFERENTE` | Sem multiturma, um aluno da lista é de outra turma que o grupo (a mensagem traz o nome dele)                                                                        |

O aluno que não é integrante recebe `404`, e não `403`: o front trata `403` como a tela "sem acesso", e aqui é só um grupo que não é dele.

### `DELETE /admin/grupos/:grupoId/integrantes/:alunoId`

Só admin, em qualquer edição e sem prazo. Tira o aluno do grupo (ele fica sem grupo nesta Física e pode entrar em outro ou ser adicionado de novo). Responde `200` com `{ "grupo": Grupo | null }`:

- `grupo` é o grupo atualizado, sem o aluno. Ele pode ficar abaixo do mínimo (`formado: false`).
- `grupo: null` quando o aluno era o último integrante: o grupo foi apagado na mesma transação (primeiro o aluno é desvinculado, por causa da FK `ON DELETE RESTRICT`, depois o grupo é apagado).

Erros, na ordem em que são checados:

| Status | Código           | Quando                                                                                                      |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDACAO`      | `grupoId` ou `alunoId` não é inteiro positivo                                                               |
| 404    | `NAO_ENCONTRADO` | "Grupo não encontrado.": grupo inexistente (ou apagado enquanto a requisição esperava)                      |
| 404    | `NAO_ENCONTRADO` | "Aluno não encontrado neste grupo.": o aluno não existe, não tem grupo, é de outro grupo ou de outra Física |

O aluno, mesmo integrante, recebe `403`: ele não sai do grupo nem tira colegas.

### `GET /admin/grupos?edicaoId=&fisicaId=&status=`

Tela `Admin/ListaGrupos`. Grupos de uma edição: a do `edicaoId` ou, sem ele, a **última edição criada**, mesmo que já esteja finalizada (inativa ou depois do prazo), porque o professor ajusta os grupos depois do prazo. Sem paginação (são poucas centenas de grupos por edição).

```json
{
  "edicao": {
    "id": 1,
    "semestre": "2026/1",
    "dataLimite": "2026-06-17T02:59:59.000Z",
    "ativa": true
  },
  "fisicas": [
    {
      "id": 1,
      "codigo": "Fis1",
      "nome": "Física 1",
      "quantidadeGrupos": 10,
      "minimoIntegrantes": 3,
      "maximoIntegrantes": 5,
      "multiturma": false,
      "turmas": ["A", "B"]
    }
  ],
  "grupos": [
    { "id": 7, "numero": 1, "fisicaId": 1, "formado": true, "integrantes": [] }
  ]
}
```

- `fisicas`: **todas** as Físicas da edição, em ordem de código, mesmo com filtro. Servem para o dropdown de Física, para o "3/5 Integrantes" de cada card (`maximoIntegrantes`) e para o filtro de turma do modal "Adicionar Aluno no Grupo" (`turmas`).
- `grupos`: no formato **Grupo**, em ordem de Física (código) e número. O card mostra a Física pelo `fisicaId`.
- Filtros opcionais, os mesmos da tela: `fisicaId` e `status` (`formado` | `nao-formado`).
- Sem nenhuma edição cadastrada (e sem `edicaoId`): `{ "edicao": null, "fisicas": [], "grupos": [] }`.
- `404 NAO_ENCONTRADO`: "Edição não encontrada." (`edicaoId` inexistente) ou "Física não encontrada." (`fisicaId` fora da edição). `400 VALIDACAO` para ids ou `status` inválidos.

### `GET /admin/fisicas/:fisicaId/alunos-sem-grupo?busca=&turma=`

Modais "Adicionar Aluno no Grupo" e "Adicionar Grupo". Inscritos na Física (de qualquer edição) sem grupo, em ordem de nome, no formato **Aluno**.

- `busca` (opcional, até 100 caracteres): a mesma busca de `colegas-disponiveis` (nome ou matrícula, sem diferenciar maiúsculas nem acentos).
- `turma` (opcional): código da turma (ex.: `A`). Ao adicionar num grupo de Física sem multiturma, o front passa a turma do grupo, e a lista já vem só com quem pode entrar. Turma que não existe: lista vazia.
- `404` "Física não encontrada."

### `POST /admin/fisicas/:fisicaId/grupos`

Modal "Adicionar Grupo". Corpo: `{ "alunos": [7, 8] }` (1 a 50 ids, sem repetir). Responde `201` com o grupo (formato **Grupo**).

- Em qualquer edição e sem prazo. **Não exige o mínimo** (o professor pode montar o grupo aos poucos; ele nasce com `formado: false` se ficar abaixo), mas precisa de pelo menos 1 aluno: não existe grupo vazio.
- Respeita o máximo de integrantes, a quantidade de grupos da Física e, sem multiturma, a turma: todos da mesma turma, e **o primeiro da lista define a turma** (a mensagem de erro aponta o primeiro que diverge).
- O admin fica como autor (`grupo.criado_por_id`), e o grupo recebe o menor número livre.

Erros, na ordem em que são checados:

| Status | Código             | Quando                                                                                                 |
| ------ | ------------------ | ------------------------------------------------------------------------------------------------------ |
| 400    | `VALIDACAO`        | `fisicaId` inválido; `alunos` vazio, com ids repetidos, inválidos ou mais de 50                        |
| 404    | `NAO_ENCONTRADO`   | Física inexistente ("Física não encontrada.")                                                          |
| 409    | `GRUPO_CHEIO`      | Mais alunos que o máximo de integrantes                                                                |
| 404    | `NAO_ENCONTRADO`   | Um aluno não está inscrito nesta Física ("Um dos alunos selecionados não está inscrito nesta Física.") |
| 409    | `JA_EM_GRUPO`      | Um aluno já tem grupo (a mensagem traz o nome dele)                                                    |
| 409    | `TURMA_DIFERENTE`  | Sem multiturma, alunos de turmas diferentes (a mensagem traz o nome do primeiro que diverge)           |
| 409    | `LIMITE_DE_GRUPOS` | A Física já tem `quantidade_grupos` grupos                                                             |

## Concorrência

Toda ação que altera grupos roda numa transação que começa travando a linha da Física (`SELECT ... FOR UPDATE`, em `travarFisica`). Assim, as ações de uma mesma Física rodam uma de cada vez, e as contagens (integrantes, grupos, número livre) não ficam desatualizadas entre a checagem e a gravação. Ações em Físicas diferentes não se bloqueiam.

Nas rotas por grupo (entrar, adicionar e remover integrantes), o service lê primeiro só o `fisicaId` do grupo (`fisicaDoGrupo`), trava a Física e então relê o grupo, que pode ter mudado (ou sido apagado) enquanto esperava o lock.

Os testes de concorrência (blocos `concorrência` em `routes.criar-grupo.test.ts`, `routes.entrar.test.ts` e `routes.adicionar-integrantes.test.ts`) disparam requisições simultâneas. Criar: dois alunos criando o último grupo, dois alunos incluindo o mesmo colega e o clique duplo. Entrar: dois alunos disputando a última vaga, o clique duplo e o mesmo aluno criando e entrando ao mesmo tempo. Adicionar: dois integrantes disputando a última vaga, o mesmo colega adicionado a dois grupos, o admin adicionando enquanto um aluno entra na última vaga e o clique duplo. Remover: o clique duplo, os dois últimos integrantes removidos ao mesmo tempo (o grupo é apagado uma vez só) e o último sendo removido enquanto um aluno entra (o grupo nunca fica vazio, e a entrada recebe `404` se chegar depois). Admin criar grupo: admin e aluno criando o último grupo, o admin incluindo um aluno que entra num grupo ao mesmo tempo e o clique duplo. O teste "remover de um grupo cheio enquanto um aluno entra" confere só o resultado final: remover apenas libera vaga, então ele passa mesmo sem o lock. Em todos, só uma ação vale e a outra recebe `409`. Sem o lock, todos falham.

## Dados de demonstração

Enquanto o upload da planilha não existe, `npm run db:seed:demo` (em `back/`) cria a edição ativa `DEMO` com duas Físicas (F01 sem multiturma e com 4 grupos; F02 com multiturma e 3 grupos; as duas com 2 a 3 integrantes), turmas A e B, 12 alunos e um grupo já formado na F01 (Ana e Bruno, com 1 vaga). Os logins e senhas aparecem no terminal. Só roda fora de produção e recusa rodar se outra edição estiver ativa. Rodar de novo recria a edição `DEMO`.
