# SefiTeam — Front-end

Interface web do SefiTeam. Design: [Figma](https://www.figma.com/design/I1xx6CkhTr5MQHD0WsgLb7/Sefiteam).

## Stack

- React + TypeScript
- [Vite](https://vite.dev/)
- [React Router](https://reactrouter.com/)

> O projeto ainda não foi inicializado (`package.json` e dependências serão criados na próxima etapa).

## Estrutura planejada

```
front/
└── src/
    ├── main.tsx
    ├── routes/        # Definição das rotas e proteção por papel
    ├── pages/         # Uma pasta por tela
    ├── components/    # Componentes reutilizáveis (Botão, Step, Card, Pill...)
    ├── api/           # Chamadas à API do back-end
    └── styles/
```

## Telas e rotas

Todas as telas têm versão desktop e mobile no Figma.

| Rota | Tela (Figma) | Acesso |
|---|---|---|
| `/login` | Login | Público |
| `/aluno` | Dashboard/Aluno | Aluno |
| `/aluno/fisicas/:fisicaId/grupo` | Aluno/EntrarEmUmGrupo e Aluno/CriarUmGrupo (abas) | Aluno |
| `/duvidas` | Aluno/DuvidasFrequentes | Aluno |
| `/admin` | Dashboard/Admin (Vazio / Ativo) | Admin |
| `/admin/edicoes/nova` | Admin/CriarEdição (Upload → Prazo → Físicas → Revisão) | Admin |
| `/admin/alunos` | Admin/ListaAlunos | Admin |
| `/admin/grupos` | Admin/ListaGrupos | Admin |
| `/admin/duvidas` | Admin/DuvidasFrequentes | Admin |

## Scripts previstos

| Script | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run preview` | Serve o build localmente |
