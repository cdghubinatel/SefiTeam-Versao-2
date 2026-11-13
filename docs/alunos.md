# Alunos (admin)

A tela `Admin/ListaAlunos` mostra os alunos da edição, com busca e filtros. Dela, o admin adiciona, edita e tira alunos da edição e exporta a planilha de grupos.

Código em `back/src/modules/alunos/`. Tabelas `usuario`, `inscricao`, `turma`, `fisica` e `grupo` ([modelo-banco.md](modelo-banco.md)).

> Pronto no back-end: a lista (`GET /admin/alunos`), adicionar (`POST /admin/fisicas/:fisicaId/alunos`) e editar (`PUT /admin/fisicas/:fisicaId/alunos/:alunoId`). Faltam tirar da edição e exportar ([roadmap](roadmap.md#próximos-passos-back-end)). O que falta no Figma está em [pendencias-design.md](pendencias-design.md#alunos-admin).

## Regras

Decisões de 2026-11-03:

- A lista mostra **só a edição atual**, que é a última criada, ativa ou não. A tela não tem seletor de edição.
- **Uma linha por aluno em cada Física**: quem está em duas Físicas aparece duas vezes. O lápis e a lixeira agem sobre aquela linha (o aluno naquela Física).
- **Status**, por Física:
  - **Formado**: está num grupo que atingiu o mínimo de integrantes;
  - **Não formado**: está num grupo abaixo do mínimo;
  - **Sem grupo**: não está em nenhum grupo.
- Os botões Curso, Turma, Física e Status do grupo, acima da tabela, **mostram ou escondem colunas**. Isso é coisa só do front: a API sempre devolve todos os campos.
- **Exportar a planilha de grupos** é feito no front, como a leitura da planilha. A lista traz o que ele precisa, inclusive o número do grupo.
- **Adicionar e editar** valem só na edição atual (Física de outra edição dá `404`) e sem prazo: o admin age mesmo depois da data limite.
- **Trocar de turma** só para quem está sem grupo naquela Física. Aluno em grupo recebe `409 ALUNO_EM_GRUPO`, e o admin precisa tirá-lo do grupo antes, senão um grupo sem multiturma ficaria com turmas misturadas.
- Regra da próxima parte, já combinada:
  - **Tirar um aluno da edição** age em cascata: ele sai do grupo, e o grupo é apagado se ele era o último integrante, como na [remoção de integrante](grupos.md).

## Rotas

| Método | Rota                                       | Acesso | Resposta                         |
| ------ | ------------------------------------------ | ------ | -------------------------------- |
| GET    | `/admin/alunos`                            | ADMIN  | `200` lista; `400`; `404`        |
| POST   | `/admin/fisicas/:fisicaId/alunos`          | ADMIN  | `201` linha; `400`; `404`; `409` |
| PUT    | `/admin/fisicas/:fisicaId/alunos/:alunoId` | ADMIN  | `200` linha; `400`; `404`; `409` |

### `GET /admin/alunos`

Filtros opcionais, que podem ser combinados:

- `busca`: parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos ("joao" encontra "João"). `%` e `_` contam como texto. Vazia ou só com espaços, traz todos.
- `fisicaId`: uma Física de outra edição dá `404 NAO_ENCONTRADO`.
- `status`: `formado`, `nao-formado` ou `sem-grupo`.

```json
{
  "edicao": {
    "id": 55,
    "semestre": "2026/2",
    "dataLimite": "2026-11-20T02:59:59.999Z",
    "ativa": true
  },
  "fisicas": [
    { "id": 101, "codigo": "F03", "nome": "Física 3", "turmas": ["A", "B"] }
  ],
  "alunos": [
    {
      "id": 12,
      "nome": "João Victor Godoy da Silva",
      "curso": "GES",
      "matricula": "364",
      "fisica": { "id": 101, "codigo": "F03" },
      "turma": "A",
      "grupo": { "id": 55, "numero": 2 },
      "status": "formado"
    }
  ]
}
```

- `fisicas` traz todas as Físicas da edição, mesmo com filtro, para o dropdown (o mesmo padrão do `GET /admin/grupos`).
- `alunos` vem em ordem de nome e depois de código da Física, **sem paginação**: são centenas a poucos milhares de linhas por edição, e o front usa a lista inteira para exportar.
- O `id` do aluno com o `fisica.id` identificam a linha.
- Sem nenhuma edição: `{ "edicao": null, "fisicas": [], "alunos": [] }`.

### `POST /admin/fisicas/:fisicaId/alunos`

Modal "Adicionar Aluno". Corpo, com a mesma normalização de uma linha da planilha (curso e matrícula sem espaços e em maiúsculas, nome com espaços repetidos reduzidos, turma em maiúsculas):

```json
{ "curso": "GES", "matricula": "589", "nome": "Maria Souza", "turma": "A" }
```

Responde `201` com a linha, no mesmo formato de um item de `alunos` da lista (`grupo: null`, `status: "sem-grupo"`).

- O aluno é identificado por **curso + matrícula**, como na planilha. Um cadastro existente (de outra Física ou de outra edição) é **reaproveitado**: o nome é atualizado e, com ele, a senha, sem deslogar. Com o nome igual, o cadastro não muda.
- Se o mesmo aluno novo for adicionado em duas Físicas ao mesmo tempo, a segunda requisição é repetida uma vez e reaproveita o cadastro que a primeira acabou de criar.

Erros, na ordem em que são checados:

1. `400 VALIDACAO` do schema (campo vazio, longo demais).
2. `404 NAO_ENCONTRADO`: Física inexistente ou de outra edição.
3. `400 VALIDACAO` no campo `turma`: "A Física F01 não tem a turma Z. Turmas: A, B."
4. `400 VALIDACAO` no campo `matricula`: "GES589 é o login de um administrador."
5. `409 JA_INSCRITO`: "Este aluno já está nesta Física."
6. `409 FISICA_LOTADA`: "A Física já tem 40 alunos, o que cabe em 10 grupos de até 4 integrantes." Todos precisam caber nos grupos, a mesma regra da criação da edição.

### `PUT /admin/fisicas/:fisicaId/alunos/:alunoId`

Modal "Editar Aluno". Mesmo corpo do `POST`; responde `200` com a linha atualizada.

- **Nome, curso e matrícula são do cadastro**: a mudança aparece em todas as Físicas e edições do aluno. Mudar o nome troca a senha (a primeira palavra do nome); mudar curso ou matrícula troca o login. O aluno **não é deslogado**: a sessão aberta continua, e o login e a senha novos valem a partir do próximo acesso.
- **A turma é só desta Física.**
- Sem nenhuma mudança, responde `200` e não mexe no cadastro.

Erros, na ordem em que são checados:

1. `400 VALIDACAO` do schema.
2. `404 NAO_ENCONTRADO`: Física inexistente ou de outra edição ("Física não encontrada."); aluno que não está nesta Física ("Aluno não encontrado nesta Física.").
3. `400 VALIDACAO` no campo `turma`: turma que não existe na Física.
4. `409 ALUNO_EM_GRUPO`: "Tire o aluno do grupo antes de trocar a turma."
5. `409 LOGIN_EXISTENTE`: "Já existe um cadastro com o login GES589." (de outro aluno ou de um admin).

### Concorrência

Adicionar e editar rodam numa transação que começa com `travarFisica`, como as ações de grupo ([grupos.md](grupos.md#concorrência)):

- dois admins adicionando alunos na última vaga: um entra, o outro recebe `FISICA_LOTADA`;
- o aluno entra num grupo enquanto o admin troca a turma dele: só uma das duas ações passa;
- duas edições ao mesmo tempo, em Físicas diferentes, levando ao mesmo login: uma recebe `LOGIN_EXISTENTE` (o índice único do login decide, porque cada uma trava só a própria Física).
