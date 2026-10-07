## Por quê?

<!-- Contexto: qual problema este PR resolve e quais decisões foram tomadas com o grupo. -->

## O que foi feito?

### Principais alterações:

- [x] **Tarefa 1:**

### Decisões técnicas de destaque:

-

## Pendências registradas (fora deste PR)

<!-- Itens que ficaram para depois (ex.: "Figma: ..."), com o link do doc onde foram registrados. -->

-

## Pontos de atenção

<!-- O que o revisor precisa saber: mudanças de contrato da API, migrations, variáveis de ambiente novas, riscos. -->

-

## Como testar?

```bash
# na raiz
docker compose up -d

cd back
npm ci
npm run db:migrate
npm run dev
```

1. Abra o Swagger em `http://127.0.0.1:3333/docs`.
2.

### Testes realizados:

- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test:coverage` e `npm run build`.
- [ ] Teste de ponta a ponta (API rodando / Swagger).
- [ ] CI verde no GitHub Actions.

---

## Checklist do PR

### Reconhecimento de uso de IA:

<!-- Diga se alguma ferramenta de IA foi usada, para quê, e que as decisões de produto foram do grupo. Se não foi usada, escreva "Não foi usada IA neste PR." -->

### Documentação e Padrões:

- [ ] Documentação atualizada (`docs/`, READMEs, `.claude/CLAUDE.md`, `docs/roadmap.md`).
- [ ] Commits no padrão Conventional Commits.
- [ ] Código segue os padrões do projeto (`schemas` → `routes` → `service`, erros via `AppError`).

### Testes e Qualidade:

- [ ] Testes unitários das regras do service.
- [ ] Testes de integração das rotas, incluindo casos de erro e de borda.
- [ ] Lint, tipos, formatação, cobertura mínima e build passando.

### Evidências:

- [ ] Prints anexados (ver seção Evidências).

---

## Comentários

<!-- Observações extras para o revisor. -->

## Evidências

<!-- Prints do Swagger, do terminal com os testes passando etc. -->
