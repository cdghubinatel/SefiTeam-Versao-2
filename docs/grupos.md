# Grupos

O aluno cria um grupo ou entra num grupo existente em cada Física em que está inscrito, até o prazo da edição, e pode adicionar colegas ao seu grupo. O admin adiciona e remove alunos e apaga grupos, inclusive depois do prazo.

Código em `back/src/modules/grupos/`. Tabelas `grupo` e `inscricao` ([modelo-banco.md](modelo-banco.md)).

> Em andamento: as rotas de leitura do aluno e a criação de grupo estão prontas. Entrar, adicionar integrantes e as ações do admin vêm nas próximas entregas ([roadmap](roadmap.md)). O que falta no Figma está em [pendencias-design.md](pendencias-design.md#grupos).

## Regras

- O aluno só vê e age nas Físicas da **edição ativa** em que está inscrito. O admin age em qualquer edição.
- Ao **criar** um grupo, o aluno entra nele automaticamente e pode incluir colegas sem grupo naquela Física. Os colegas entram na hora, sem precisar aceitar. Também pode criar sozinho.
- Depois, **qualquer integrante** pode adicionar colegas sem grupo, até o prazo, respeitando o máximo e a turma. O admin também adiciona (sem prazo), pela mesma rota.
- Cada aluno fica em **um único grupo** por Física. Ações de quem já tem grupo (entrar, criar outro) dão `409 JA_EM_GRUPO`.
- O aluno **não sai** do grupo. Só o admin remove integrantes. Quando o admin remove o último integrante, o grupo é apagado.
- **Formado**: o grupo atingiu o mínimo de integrantes da Física. Continua aceitando alunos até o máximo.
- **Multiturma desligado**: o grupo só aceita alunos da turma dos integrantes atuais.
- **Quantidade de grupos**: o total por Física, mesmo com o multiturma desligado. Risco: uma turma pode ocupar todos os grupos e deixar a outra sem nenhum. Cabe ao professor configurar uma quantidade que comporte todas as turmas.
- **Numeração**: um grupo novo recebe o menor número livre na Física (com os grupos 1, 3 e 4, o próximo é o 2).
- Curso e matrícula dos colegas aparecem para o aluno (como no Figma). Isso amplia o risco descrito em [autenticacao.md](autenticacao.md#risco-aceito).

## Rotas

| Método | Rota                                     | Acesso | Resposta                                              |
| ------ | ---------------------------------------- | ------ | ----------------------------------------------------- |
| GET    | `/fisicas/minhas`                        | ALUNO  | `200` Físicas do aluno na edição ativa                |
| GET    | `/fisicas/:fisicaId/grupos`              | ALUNO  | `200` grupos em que o aluno pode entrar; `404`; `409` |
| GET    | `/fisicas/:fisicaId/colegas-disponiveis` | ALUNO  | `200` colegas que ele pode incluir; `404`             |
| POST   | `/fisicas/:fisicaId/grupos`              | ALUNO  | `201` grupo criado; `400`; `404`; `409`               |

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

Aba "Criar um grupo". Corpo: `{ "colegas": [7, 8] }`, com os **ids de aluno** que vêm de `colegas-disponiveis`. Vazio ou `{}` = criar sozinho. Responde `201` com o grupo criado (mesmo formato de **Grupo**).

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
| 404    | `NAO_ENCONTRADO`   | Um colega não está inscrito nesta Física                                                                      |
| 409    | `JA_EM_GRUPO`      | Um colega já tem grupo (a mensagem traz o nome dele)                                                          |
| 409    | `TURMA_DIFERENTE`  | Sem multiturma, um colega é de outra turma (a mensagem traz o nome dele)                                      |
| 409    | `LIMITE_DE_GRUPOS` | A Física já tem `quantidade_grupos` grupos                                                                    |

Em qualquer erro, nada é gravado.

## Concorrência

Toda ação que altera grupos roda numa transação que começa travando a linha da Física (`SELECT ... FOR UPDATE`, em `travarFisica`). Assim, as ações de uma mesma Física rodam uma de cada vez, e as contagens (integrantes, grupos, número livre) não ficam desatualizadas entre a checagem e a gravação. Ações em Físicas diferentes não se bloqueiam.

Os testes de concorrência (`routes.test.ts`) disparam requisições simultâneas: dois alunos criando o último grupo, dois alunos incluindo o mesmo colega e o clique duplo. Em todos, uma é aceita e a outra recebe `409`. Sem o lock, os três falham.

## Dados de demonstração

Enquanto o upload da planilha não existe, `npm run db:seed:demo` (em `back/`) cria a edição ativa `DEMO` com duas Físicas (F01 sem multiturma e com 4 grupos; F02 com multiturma e 3 grupos; as duas com 2 a 3 integrantes), turmas A e B, 12 alunos e um grupo já formado na F01 (Ana e Bruno, com 1 vaga). Os logins e senhas aparecem no terminal. Só roda fora de produção e recusa rodar se outra edição estiver ativa. Rodar de novo recria a edição `DEMO`.
