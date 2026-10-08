# SefiTeam

Sistema de formação de grupos da **SEFITEL** (Seminário de Física do Inatel).

O professor (admin) cria uma **edição** da feira e faz upload de uma planilha com os alunos de cada **Física**. Os alunos recebem acesso ao sistema e, até a data limite, precisam **criar ou entrar em um grupo** em cada Física em que estão inscritos.

> Versão 2: reescrita do zero em TypeScript.

## Regras de negócio

- Apenas **uma edição ativa** por vez; as anteriores ficam como histórico.
- Uma edição tem várias **Físicas** (F01, F02, F03...), definidas pela planilha (uma aba por Física).
- Cada Física tem sua configuração: quantidade de grupos, mínimo e máximo de integrantes e **multiturma**.
- O **prazo** para formar grupos é único por edição e vale para todas as Físicas.
- Um aluno pode estar em várias Físicas, mas em **uma única turma** por Física.
- Um aluno pode estar em **um único grupo** por Física.
- Multiturma desligado: o grupo só aceita alunos da mesma turma (ex.: só F01-A). Ligado: aceita turmas diferentes da mesma Física (F01-A com F01-B).
- Um grupo está **formado** quando atinge o mínimo de integrantes. Ele continua aceitando alunos até o máximo.
- Quem cria um grupo pode incluir colegas sem grupo naquela Física, e qualquer integrante pode adicionar colegas depois (até o máximo). O aluno **não sai** do grupo: só o admin remove integrantes.
- Após o prazo, o aluno não altera mais o grupo; o admin pode adicionar/remover alunos e apagar grupos.
- **Dúvidas Frequentes** são globais e editadas pelo admin.
- Login do aluno: o **e-mail** (vem da planilha). Senha: **curso + matrícula** (ex.: `GES589`), sem diferenciar maiúsculas. O aluno não troca a senha. Nesta versão o sistema não envia e-mails. Detalhes e riscos em [docs/autenticacao.md](docs/autenticacao.md).

## Stack

| Parte                | Tecnologias                                    |
| -------------------- | ---------------------------------------------- |
| Back-end (`back/`)   | Node.js, TypeScript, Fastify, Prisma           |
| Front-end (`front/`) | React, TypeScript, Vite, React Router          |
| Banco de dados       | PostgreSQL (Docker Compose em desenvolvimento) |

## Estrutura

```
.
├── back/                # API (Fastify + Prisma)
├── front/               # SPA (Vite + React)
├── docs/
│   ├── modelo-banco.md  # Modelo de dados e regras
│   ├── autenticacao.md  # Login, token e permissões
│   ├── duvidas-frequentes.md  # Rotas e regras das dúvidas frequentes
│   ├── grupos.md        # Rotas e regras dos grupos
│   ├── pendencias-design.md  # O que falta desenhar no Figma
│   └── roadmap.md       # O que está pronto e próximos passos
└── docker-compose.yml   # PostgreSQL para desenvolvimento
```

`back/` e `front/` são projetos independentes, cada um com seu próprio `package.json`.

## Rodando localmente

Pré-requisitos: Node.js 24 (LTS; a versão fica no `.nvmrc`, use `nvm use`) e Docker.

```bash
# 1. Subir o banco
docker compose up -d

# 2. Back-end
cd back
cp .env.example .env
# instruções completas em back/README.md

# 3. Front-end
cd front
# instruções completas em front/README.md
```

## Documentação

- [Modelo do banco de dados](docs/modelo-banco.md)
- [Autenticação e autorização](docs/autenticacao.md)
- [Dúvidas frequentes](docs/duvidas-frequentes.md)
- [Grupos](docs/grupos.md)
- [Pendências de design](docs/pendencias-design.md)
- [Roadmap](docs/roadmap.md)
- [Back-end](back/README.md)
- [Front-end](front/README.md)
- [Design no Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam)
