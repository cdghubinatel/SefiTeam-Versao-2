# Alunos (admin)

A tela `Admin/ListaAlunos` mostra os alunos da edição, com busca e filtros. Dela, o admin adiciona, edita e tira alunos da edição e exporta a planilha de grupos.

Código em `back/src/modules/alunos/`. Tabelas `usuario`, `inscricao`, `turma`, `fisica` e `grupo` ([modelo-banco.md](modelo-banco.md)).

> Pronto no back-end: a lista (`GET /admin/alunos`). Faltam adicionar, editar, tirar da edição e exportar ([roadmap](roadmap.md#próximos-passos-back-end)). O que falta no Figma está em [pendencias-design.md](pendencias-design.md#alunos-admin).

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
- Regras das próximas partes, já combinadas:
  - **Trocar de turma** não é possível depois que a escolha de grupo acontece (detalhes na parte 3b).
  - **Tirar um aluno da edição** age em cascata: ele sai do grupo, e o grupo é apagado se ele era o último integrante, como na [remoção de integrante](grupos.md).

## Rotas

| Método | Rota            | Acesso | Resposta                  |
| ------ | --------------- | ------ | ------------------------- |
| GET    | `/admin/alunos` | ADMIN  | `200` lista; `400`; `404` |

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
