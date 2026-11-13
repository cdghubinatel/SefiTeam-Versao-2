import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import { alunosDaEdicaoQuerySchema, alunosDaEdicaoSchema } from './schemas.js';
import { listarAlunosDaEdicao } from './service.js';

const somenteAdmin = { papeis: ['ADMIN' as const] };

/** Registrado com o prefixo `/admin/alunos` (todas as rotas são só do admin). */
export const alunosRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.get(
    '',
    {
      config: somenteAdmin,
      schema: {
        tags: ['alunos'],
        summary: 'Lista de alunos do admin',
        description:
          'Tela `Admin/ListaAlunos`: uma linha por aluno em cada Física da última edição criada (ativa ou não), em ordem de nome e de Física, com turma, grupo e status (`formado`, `nao-formado` ou `sem-grupo`). Filtros opcionais: `busca` (parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos), `fisicaId` e `status`. `fisicas` traz todas as Físicas da edição, para o dropdown. Sem paginação. Sem nenhuma edição: `edicao: null` e listas vazias. `404` se a Física não é da edição.',
        querystring: alunosDaEdicaoQuerySchema,
        response: {
          200: alunosDaEdicaoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) => listarAlunosDaEdicao(deps, request.query),
  );
};
