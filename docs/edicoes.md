# Edições

O admin cria uma edição por semestre a partir da planilha de alunos: uma aba por Física. A edição nova já nasce ativa, e a anterior vira histórico.

Código em `back/src/modules/edicoes/`. Tabelas `edicao`, `fisica`, `turma`, `usuario` e `inscricao` ([modelo-banco.md](modelo-banco.md)).

> Pronto no back-end: criar a edição (`POST /admin/edicoes`). Faltam as leituras do admin, lista de edições e dashboard ([roadmap](roadmap.md#próximos-passos-back-end)). O que falta no Figma está em [pendencias-design.md](pendencias-design.md#edições-admin).

## Como funciona o assistente

A tela `Admin/CriarEdição` tem quatro passos: **Upload → Prazo → Físicas → Revisão**.

- O **front lê a planilha** (`.xlsx`) e guarda os passos. Nada é gravado até "Criar edição".
- "Criar edição" envia tudo de uma vez numa **rota única**, em JSON: o prazo e, para cada aba, o código, a configuração e os alunos.
- O back **valida tudo de novo** (a API não confia no front) e grava numa transação.

Decisão do grupo (2026-10-29): sem upload de arquivo no back (sem multipart nem lib de `.xlsx` na API) e sem edição em rascunho no banco.

## Planilha (lida pelo front)

- Só `.xlsx`. Cada aba é uma Física, e o nome da aba é o código (`Fis1`, `Fis2`...).
- Colunas na linha 1, em qualquer ordem e sem diferenciar maiúsculas nem acentos: **Curso** (sigla, ex.: `GES`), **Matricula**, **Aluno** (nome completo) e **Turma**. Não há e-mail nem a configuração das Físicas.
- Aba sem essas colunas (ex.: instruções) é ignorada. Aba com alguma coluna faltando é erro.
- O front acusa no Upload o que dá para ver no arquivo (coluna faltando, célula vazia, nenhuma aba de Física). As regras abaixo, que só o back confere, aparecem no "Criar edição".

## Regras

- **Prazo**: o front envia só a data (`AAAA-MM-DD`), e o prazo vale até **23:59:59 desse dia, horário de Brasília** (fuso fixo `-03:00`, já que o Brasil não tem horário de verão desde 2019). Precisa ser hoje ou depois.
- **Semestre**: calculado pela data limite. Até junho, `AAAA/1`; de julho em diante, `AAAA/2` (16/06/2026 → `2026/1`). O semestre é único: repetido → `409 SEMESTRE_EXISTENTE`.
- **Ativação**: a edição nova já nasce **ativa**, e a que estava ativa é **finalizada** na mesma transação (só uma ativa por vez). Não existe ação separada de finalizar.
- **Nome da Física**: derivado do código, `Fis1` → "Física 1" (sem diferenciar maiúsculas, com espaço ou zeros à esquerda: `FIS 03` → "Física 3"). Fora desse padrão, o nome é o próprio código.
- **Configuração de cada Física**: quantidade de grupos, mínimo e máximo de integrantes e multiturma, todos obrigatórios (sem valores padrão). Mínimo ≥ 1, máximo ≥ mínimo, grupos ≥ 1, e **todos os alunos precisam caber**: grupos × máximo ≥ alunos da Física (nem o admin passa do máximo nem da quantidade de grupos).
- **Turmas**: criadas a partir dos códigos que aparecem na coluna Turma de cada aba.
- **Alunos**: identificados por **curso + matrícula** (o login, ex.: `GES589`). Curso, matrícula e turma são gravados sem espaços nas pontas e em maiúsculas (curso e matrícula também sem espaços no meio); o nome, sem espaços repetidos.
  - O mesmo aluno pode estar em várias Físicas, em turmas diferentes.
  - Repetido na mesma Física e na mesma turma: conta uma vez.
  - Na mesma Física em turmas diferentes: erro.
  - Com nomes diferentes (em Físicas diferentes ou na mesma): erro. Diferença só de maiúsculas, acentos ou espaços não conta.
  - Física sem alunos: erro.
- **Alunos de edições anteriores** (mesmo curso + matrícula) são reaproveitados: o nome é atualizado e, com ele, a senha (a primeira palavra do nome). A sessão aberta continua valendo. Com o nome igual, o cadastro não muda.
- Login de aluno igual ao de um admin: erro (atualizar o "aluno" trocaria a senha do admin).
- **Depois de criada, a edição não é editável** nesta etapa (nem prazo, nem configuração, nem planilha).

## Rotas

| Método | Rota             | Acesso | Resposta                                 |
| ------ | ---------------- | ------ | ---------------------------------------- |
| POST   | `/admin/edicoes` | ADMIN  | `201` edição criada; `400`; `409`; `413` |

### `POST /admin/edicoes`

Corpo (até 5 MB; o padrão do Fastify é 1 MB):

```json
{
  "dataLimite": "2026-06-16",
  "fisicas": [
    {
      "codigo": "Fis1",
      "quantidadeGrupos": 5,
      "minimoIntegrantes": 2,
      "maximoIntegrantes": 4,
      "multiturma": false,
      "alunos": [
        {
          "curso": "GES",
          "matricula": "589",
          "nome": "Maria Souza",
          "turma": "A"
        }
      ]
    }
  ]
}
```

Limites do schema: de 1 a 30 Físicas, até 3000 alunos por Física, quantidade de grupos de 1 a 1000, mínimo e máximo de 1 a 100.

Resposta `201`:

```json
{
  "edicao": {
    "id": 3,
    "semestre": "2026/1",
    "dataLimite": "2026-06-17T02:59:59.999Z",
    "ativa": true
  },
  "fisicas": [
    {
      "id": 7,
      "codigo": "Fis1",
      "nome": "Física 1",
      "quantidadeGrupos": 5,
      "minimoIntegrantes": 2,
      "maximoIntegrantes": 4,
      "multiturma": false,
      "alunos": 1,
      "turmas": [{ "codigo": "A", "alunos": 1 }]
    }
  ],
  "alunos": { "novos": 0, "reaproveitados": 1 },
  "edicaoFinalizada": { "id": 2, "semestre": "2025/2" }
}
```

`alunos` (no topo) conta pessoas: o mesmo aluno em duas Físicas conta uma vez. `edicaoFinalizada` é `null` quando não havia edição ativa.

### Erros

Na ordem em que são checados:

1. `400 VALIDACAO` do schema (tipo ou formato errado, campo vazio, fora dos limites), com o caminho do campo em `detalhes` (ex.: `fisicas.0.alunos.4.matricula`).
2. `400 VALIDACAO` no campo `dataLimite`: "A data limite precisa ser hoje ou uma data futura."
3. `400 VALIDACAO` com **todos os problemas da planilha de uma vez** (até 50), identificados pela Física (`campo` = código da aba) e pelo aluno:

   | Problema                       | Mensagem                                                            |
   | ------------------------------ | ------------------------------------------------------------------- |
   | Código de aba repetido         | "A Física FIS1 aparece mais de uma vez."                            |
   | Mínimo maior que o máximo      | "O mínimo de integrantes (5) é maior que o máximo (3)."             |
   | Aluno em duas turmas da Física | "GES589 (Maria Souza) aparece nas turmas A e B."                    |
   | Aluno com nomes diferentes     | "GES589 aparece como "Mariana Souza" e como "Maria Souza" na Fis1." |
   | Física sem alunos              | "A Física não tem alunos."                                          |
   | Alunos não cabem               | "São 40 alunos, mas 5 grupos de até 6 integrantes cabem 30."        |

4. `409 SEMESTRE_EXISTENTE`: "Já existe a edição 2026/1."
5. `400 VALIDACAO`: "GES589 é o login de um administrador."
6. `413 REQUISICAO_INVALIDA`: corpo acima de 5 MB.

Em qualquer erro, nada é gravado.

## Desempenho

O que pesa é o hash da senha de cada aluno novo ou com nome trocado. Ele é calculado **fora da transação**, **uma vez por senha** (alunos com o mesmo primeiro nome têm a mesma senha) e com o **custo baixo do argon2** da senha do aluno ([autenticacao.md](autenticacao.md#aluno)). Medido na API compilada: 600 alunos e 1100 inscrições em ~0,7 s. A transação tem limite de 60 s (o padrão do Prisma, 5 s, é curto para planilhas grandes).

## Concorrência

A transação começa com um lock de transação do Postgres (`pg_advisory_xact_lock`), que põe as criações de edição em fila. Sem ele, duas criações ao mesmo tempo (clique duplo, ou duas abas) leriam a mesma edição ativa, e as duas tentariam ficar ativas: o índice único de edição ativa recusaria uma delas com erro `500`. Com o lock, a segunda espera a primeira terminar e:

- no mesmo semestre, recebe `409 SEMESTRE_EXISTENTE`;
- em outro semestre, é criada e finaliza a primeira.

Os dois casos têm teste com `Promise.all`, e os dois falham (com `500`) quando o lock é desligado.
