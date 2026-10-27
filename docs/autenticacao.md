# Autenticação e autorização

Login por token (JWT) e controle de acesso por papel (`ADMIN` | `ALUNO`).

## Fluxo

```mermaid
sequenceDiagram
    participant F as Front-end
    participant H as Hook de auth (onRequest)
    participant R as Rota
    participant DB as PostgreSQL

    F->>R: POST /auth/login { login, senha }
    R->>DB: busca usuário pelo login
    R-->>F: 200 { token, usuario } ou 401 CREDENCIAIS_INVALIDAS
    Note over F: guarda o token no localStorage

    F->>H: GET /rota-protegida<br/>Authorization: Bearer <token>
    alt rota pública
        H->>R: segue
    else sem token / token inválido ou expirado
        H-->>F: 401
        Note over F: apaga o token e vai para /login
    else token válido
        H->>DB: busca usuário pelo id (sub)
        alt usuário não existe ou token revogado (versao ≠ token_versao)
            H-->>F: 401
        else papel não permitido na rota
            H-->>F: 403
            Note over F: mostra "sem acesso" (não desloga)
        else ok
            H->>R: segue (request.usuario preenchido)
            R-->>F: 200
        end
    end
```

## Token

- JWT assinado com `JWT_SECRET` (HS256), via `@fastify/jwt`.
- Payload: `{ sub: <id do usuário>, papel: "ADMIN" | "ALUNO", versao: <usuario.token_versao> }`.
- Validade: `JWT_EXPIRES_IN` (padrão `8h`). Não existe refresh token: quando o token expira, o usuário faz login de novo.

### Revogação (`token_versao`)

O token guarda a `versao` do usuário no momento do login. Quando `usuario.token_versao` é incrementado, todos os tokens emitidos antes deixam de valer, em **todos os dispositivos**.

Hoje isso acontece no **logout**. Se a troca ou a recuperação de senha entrar no futuro, a nova senha também deve incrementar a versão, derrubando as sessões antigas.

Isso não tem custo extra: o hook já consulta o usuário no banco a cada requisição, e só passa a comparar mais uma coluna.

### Armazenamento no front

O front guarda o token no `localStorage` e o envia em **toda** requisição:

```
Authorization: Bearer <token>
```

> Tradeoff aceito: um token no `localStorage` pode ser lido por um script injetado (XSS). Para reduzir o risco, o front não pode renderizar HTML vindo do usuário (`dangerouslySetInnerHTML`), e a API usa `@fastify/helmet`.

## Hook de autorização

Plugin `src/plugins/auth.ts`, registrado como hook `onRequest` global.

**Fechado por padrão:** toda rota exige token válido, a não ser que seja marcada como pública. Se alguém esquecer de configurar uma rota nova, ela fica protegida, e não aberta.

```ts
// pública
app.post("/auth/login", { config: { publica: true } }, handler);

// qualquer usuário autenticado
app.get("/auth/me", handler);

// só admin
app.get("/admin/alunos", { config: { papeis: ["ADMIN"] } }, handler);
```

A cada requisição, o hook:

1. Ignora rotas com `config.publica`.
2. Lê o header `Authorization`. Se estiver ausente → `401 TOKEN_AUSENTE`.
3. Valida a assinatura e a expiração. Se falhar → `401 TOKEN_INVALIDO`.
4. Busca o usuário no banco pelo `sub`. Se não existir, ou se a `versao` do token for diferente de `token_versao` (token revogado) → `401 TOKEN_INVALIDO`. Isso garante que o usuário ainda existe, que o token não foi revogado e que o papel usado é o atual do banco, e não o que estava no token.
5. Se a rota define `config.papeis` e o papel do usuário não está na lista → `403 SEM_PERMISSAO`.
6. Preenche `request.usuario` para a rota usar.

## Respostas de erro

Todos os erros da API seguem o mesmo formato:

```json
{
  "erro": {
    "codigo": "TOKEN_INVALIDO",
    "mensagem": "Sessão inválida ou expirada. Faça login novamente."
  }
}
```

`codigo` é estável e serve para o front decidir o que fazer. `mensagem` pode ser exibida ao usuário.

| Status | `codigo`                | Quando                                                                                | Front-end                              |
| ------ | ----------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| 401    | `CREDENCIAIS_INVALIDAS` | Login ou senha errados                                                                | Mostra o erro na tela de login         |
| 401    | `TOKEN_AUSENTE`         | Rota protegida sem header `Authorization`                                             | Apaga o token e redireciona a `/login` |
| 401    | `TOKEN_INVALIDO`        | Token adulterado, expirado, revogado (logout) ou usuário inexistente                  | Apaga o token e redireciona a `/login` |
| 403    | `SEM_PERMISSAO`         | Usuário autenticado sem o papel exigido pela rota                                     | Tela "sem acesso" (**não** desloga)    |
| 429    | `MUITAS_TENTATIVAS`     | Rate limit do login excedido                                                          | Pede para aguardar e tentar de novo    |
| 400    | `VALIDACAO`             | Corpo/parâmetros inválidos (lista em `detalhes`), pelo schema ou por regra do service | Mostra o erro no campo indicado        |
| 4xx    | `REQUISICAO_INVALIDA`   | Requisição malformada (ex.: JSON quebrado)                                            | Mensagem genérica de erro              |
| 404    | `NAO_ENCONTRADO`        | Rota inexistente, ou recurso inexistente (ex.: dúvida apagada)                        | Mostra a mensagem e recarrega a lista  |
| 409    | `ORDEM_DESATUALIZADA`   | Reordenar dúvidas com uma lista que não bate com a do banco                           | Avisa e recarrega a lista              |
| 409    | `JA_EM_GRUPO`           | O aluno (ou um colega escolhido) já tem grupo nesta Física ([grupos.md](grupos.md))   | Mostra a mensagem / o grupo dele       |
| 409    | `PRAZO_ENCERRADO`       | Ação do aluno em grupos depois da data limite da edição                               | Mostra a mensagem; bloqueia as ações   |
| 409    | `GRUPO_CHEIO`           | O grupo passaria do máximo de integrantes                                             | Mostra a mensagem                      |
| 409    | `GRUPO_INCOMPLETO`      | Criar grupo abaixo do mínimo de integrantes (todo grupo nasce formado)                | Pede para selecionar mais colegas      |
| 409    | `LIMITE_DE_GRUPOS`      | A Física já tem a quantidade máxima de grupos                                         | Mostra a mensagem                      |
| 409    | `TURMA_DIFERENTE`       | Sem multiturma, aluno de outra turma no grupo                                         | Mostra a mensagem                      |
| 500    | `ERRO_INTERNO`          | Erro inesperado (detalhes só no log do servidor)                                      | Mensagem genérica de erro              |

Em `VALIDACAO`, `detalhes` traz `[{ "campo": "login", "mensagem": "..." }]`. As mensagens de `detalhes` saem em **português** (tradução pt-BR do próprio Zod, configurada em `back/src/config/zod.ts` com `z.config(z.locales.ptBR())`), por exemplo "Pequeno demais: esperava que o texto tivesse >= 1 caracteres". O front pode mostrá-las direto no campo; os códigos (`codigo`) não mudam.

A mensagem de `CREDENCIAIS_INVALIDAS` é sempre genérica ("Login ou senha inválidos."). Ela não revela se o login está cadastrado.

## Rotas

| Método | Rota           | Acesso      | Descrição                                                                                                       |
| ------ | -------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/login`  | Pública     | Recebe `{ login, senha }`, devolve `{ token, usuario }`                                                         |
| GET    | `/auth/me`     | Autenticado | Dados do usuário logado (o front usa ao recarregar a página)                                                    |
| POST   | `/auth/logout` | Autenticado | Incrementa `token_versao`: derruba as sessões do usuário em todos os dispositivos. O front também apaga o token |

`usuario` (também em `GET /auth/me`) é `{ id, login, nome, papel }`.

`POST /auth/login` tem rate limit (`@fastify/rate-limit`): **10 tentativas por minuto por IP + login** (normalizado). A chave inclui o login porque os alunos do Inatel acessam pela mesma rede, ou seja, pelo mesmo IP. Um limite só por IP bloquearia a turma inteira por causa das tentativas de um aluno.

Para o tempo de resposta não revelar se um login está cadastrado, o login inexistente também passa por uma verificação argon2, contra um hash falso.

## Login e senha

- O login de todos os usuários fica em `usuario.login` (único). Ele é normalizado (**sem espaços** e em **maiúsculas**) antes de gravar e antes de comparar: `ges 589` = `GES589`.
- O corpo do login é validado como texto de 1 a 100 caracteres (espaços nas pontas não contam); fora disso, `400 VALIDACAO`.
- As senhas são guardadas com hash **argon2** (`argon2id`), nunca em texto.
- **Não existe troca nem recuperação de senha** nesta versão, e o sistema não envia e-mails (a planilha não traz e-mail).

### Aluno

- Login: **curso + matrícula** (ex.: `GES589`), as colunas Curso e Matricula da planilha. Gerado por `loginDoAluno({ curso, matricula })` (`back/src/modules/auth/service.ts`). Como `(curso, matricula)` é único, o login também é.
- Senha: a **primeira palavra do nome** (coluna Aluno), separada por espaço: "Maria Clara Souza" → `maria`. Gerada por `senhaDoAluno({ nome })` quando o aluno é cadastrado.
- A senha do aluno **não diferencia maiúsculas nem acentos**: `joao` = `João` = `JOAO`. O hash é gravado sem acentos e em maiúsculas e, no login de um aluno, o que foi digitado é convertido do mesmo jeito antes de comparar. Isso evita erros de teclado no celular. Digitar o nome completo não funciona: a senha é só a primeira palavra.
- Como o aluno é reaproveitado entre edições, o login continua o mesmo de um semestre para o outro. Se o nome mudar na planilha de uma edição nova, a senha muda junto.

#### Sem segurança de propósito

O login e a senha do aluno **não são secretos**: curso, matrícula e nome são de livre acesso na instituição, e as telas de grupo mostram o nome, o curso e a matrícula dos colegas (como no Figma, ver [grupos.md](grupos.md)). Qualquer pessoa consegue entrar como qualquer aluno e criar ou entrar em grupos em seu nome, e o sistema registra como se tivesse sido ele. O rate limit do login também não protege contra isso, porque não há o que adivinhar.

Decisão do grupo: a API é interna, só ajuda os alunos a montarem os grupos e não guarda nenhuma informação sigilosa. O login existe para identificar quem está usando, não para proteger dados. O que continua protegido é o **admin** (senha forte, abaixo), porque ele altera grupos de todos e configura a edição.

### Admin

- Existe **um único** admin, criado pelo seed do Prisma a partir de `ADMIN_LOGIN` (ex.: `admin`, gravado como `ADMIN`) e `ADMIN_SENHA` (`.env`). Rodar o seed de novo atualiza o login e a senha desse admin.
- A senha do admin **diferencia maiúsculas** (não passa pela normalização da senha do aluno).
- `ADMIN_SENHA` precisa ter **pelo menos 16 caracteres** (o seed recusa senhas menores). O admin é o alvo mais valioso: a senha dele é escolhida por uma pessoa, e o rate limit do login é por IP + login, então não impede tentativas vindas de muitos IPs.
- O seed é idempotente: rodar de novo não duplica o admin.
- **O admin não troca a senha pelo sistema** (decisão desta primeira versão). A única forma é mudar `ADMIN_SENHA` no `.env` e rodar `npm run db:seed` de novo, o que atualiza o hash.
- Limitação conhecida: o seed **não** incrementa `token_versao`, então tokens do admin emitidos antes da troca continuam válidos até expirar (`JWT_EXPIRES_IN`). Se a troca de senha do admin entrar no sistema, ela deve incrementar `token_versao`.

## Swagger

- A documentação interativa da API fica em `/docs` (`@fastify/swagger` + `@fastify/swagger-ui`). Os schemas vêm dos mesmos schemas Zod que validam as rotas.
- Para testar rotas protegidas: chame `POST /auth/login`, copie o `token`, clique em **Authorize** e cole o token (sem o prefixo `Bearer`).
- Só fica ativa quando `SWAGGER_ENABLED=true`. Em produção, deixe `false`.

## Variáveis de ambiente

| Variável          | Descrição                                      |
| ----------------- | ---------------------------------------------- |
| `JWT_SECRET`      | Segredo de assinatura do token (mín. 32 chars) |
| `JWT_EXPIRES_IN`  | Validade do token (ex.: `8h`)                  |
| `ADMIN_LOGIN`     | Login do admin criado pelo seed (ex.: `admin`) |
| `ADMIN_SENHA`     | Senha do admin criado pelo seed (mín. 16)      |
| `SWAGGER_ENABLED` | Expõe `/docs` (`true` em dev, `false` em prod) |
