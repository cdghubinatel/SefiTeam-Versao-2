# Dúvidas frequentes

Perguntas e respostas exibidas aos alunos. São **globais**: não pertencem a uma edição e continuam valendo de um semestre para o outro. Só o admin cadastra, edita, apaga e reordena.

Código em `back/src/modules/duvidas/`. Tabela `duvida_frequente` ([modelo-banco.md](modelo-banco.md)).

## Rotas

| Método | Rota             | Acesso      | Corpo                     | Resposta                                    |
| ------ | ---------------- | ----------- | ------------------------- | ------------------------------------------- |
| GET    | `/duvidas`       | Autenticado | —                         | `200` lista na ordem de exibição            |
| POST   | `/duvidas`       | ADMIN       | `{ pergunta, resposta }`  | `201` dúvida criada (entra no fim da lista) |
| PUT    | `/duvidas/:id`   | ADMIN       | `{ pergunta, resposta }`  | `200` dúvida editada; `404` se não existir  |
| DELETE | `/duvidas/:id`   | ADMIN       | —                         | `204`; `404` se não existir                 |
| PUT    | `/duvidas/ordem` | ADMIN       | `{ ids: [3, 1, 2] }`      | `200` lista na nova ordem; `409` (abaixo)   |

Cada dúvida sai como `{ id, pergunta, resposta, ordem }`. A lista não é paginada (são poucas dezenas de itens).

## Regras

- **Texto puro**, sem HTML nem Markdown. Espaços nas pontas são removidos; quebras de linha são mantidas (o front exibe com `white-space: pre-line`).
- Pergunta: 1 a 300 caracteres. Resposta: 1 a 5000.
- `:id` precisa ser inteiro positivo; senão, `400 VALIDACAO`.
- Dúvida inexistente: `404 NAO_ENCONTRADO` ("Dúvida não encontrada.").
- Ordem de exibição: `ordem` crescente; se duas dúvidas tiverem a mesma `ordem`, desempata pelo `id`. Por isso `ordem` não é única no banco.
- Uma dúvida nova recebe `maior ordem + 1`. Apagar uma dúvida deixa um buraco na sequência, sem problema.

## Reordenação

O front manda **todos os ids na nova ordem**; o back grava `ordem = posição + 1` numa transação.

- Ids repetidos ou que não sejam inteiros positivos: `400 VALIDACAO`. Máximo de 100 ids (cada id vira um `UPDATE` dentro da transação, que o Prisma cancela após 5s).
- Se a lista não tiver **exatamente** as dúvidas cadastradas (alguém criou ou apagou uma em outra aba enquanto o admin reordenava): `409 ORDEM_DESATUALIZADA`, e nada é alterado. O front avisa e recarrega a lista.
- Com nenhuma dúvida cadastrada, `{ "ids": [] }` é aceito.

A rota não depende de como o front reordena (setinhas hoje, arrastar e soltar no futuro).

### Como o front usa (combinado)

1. O admin clica em **"Reordenar"**: cada dúvida ganha setinhas ↑ e ↓ (↑ desabilitada na primeira, ↓ na última). Nesse modo, as respostas ficam recolhidas.
2. As setinhas só mudam o estado local. Nenhuma requisição é feita a cada clique.
3. **"Salvar ordem"** envia `PUT /duvidas/ordem` com a lista de ids e substitui a lista pela resposta. Fica desabilitado enquanto a ordem não mudar.
4. **"Cancelar"** volta à ordem anterior.
5. Em `409`, mostra "A lista mudou, recarregue" e busca `GET /duvidas` de novo.

## Pendências de design (Figma)

A tela **Admin/DuvidasFrequentes** hoje só tem "Adicionar" e o lápis de editar. Faltam:

- **Excluir**: ação para apagar uma dúvida (ex.: botão no modal de edição), com confirmação.
- **Reordenar**: botão "Reordenar" e o modo com setinhas ↑/↓, "Salvar ordem" e "Cancelar", em desktop e mobile.
- **Modal de adicionar/editar**: o formulário de pergunta e resposta não está desenhado.

As telas mostram "Edição 2026/1" no subtítulo, mas as dúvidas são globais. Se o subtítulo ficar, ele vem da edição ativa, não das dúvidas.
