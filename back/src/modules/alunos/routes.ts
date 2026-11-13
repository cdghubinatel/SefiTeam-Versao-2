import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import {
  alunoBodySchema,
  alunoDaEdicaoSchema,
  alunoNaFisicaParamsSchema,
  alunosDaEdicaoQuerySchema,
  alunosDaEdicaoSchema,
  fisicaParamsSchema,
} from './schemas.js';
import { adicionarAluno, editarAluno, listarAlunosDaEdicao } from './service.js';

const somenteAdmin = { papeis: ['ADMIN' as const] };

/**
 * Registrado com o prefixo `/admin`: as rotas ficam em `/admin/alunos` e
 * `/admin/fisicas/:fisicaId/alunos` (todas só do admin, na edição atual).
 */
export const alunosRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.get(
    '/alunos',
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

  app.post(
    '/fisicas/:fisicaId/alunos',
    {
      config: somenteAdmin,
      schema: {
        tags: ['alunos'],
        summary: 'Adiciona um aluno a uma Física',
        description:
          'Modal "Adicionar Aluno", fora da planilha, só na edição atual (a última criada) e sem prazo. O aluno é identificado por curso + matrícula: um cadastro existente (de outra Física ou edição) é reaproveitado, com o nome e a senha atualizados, sem deslogar. Responde a linha da lista. Erros, na ordem: `404` (Física inexistente ou de outra edição), `400 VALIDACAO` (turma que não existe na Física; login de um administrador), `409 JA_INSCRITO`, `409 FISICA_LOTADA` (grupos × máximo já preenchidos).',
        params: fisicaParamsSchema,
        body: alunoBodySchema,
        response: {
          201: alunoDaEdicaoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      const linha = await adicionarAluno(deps, request.params.fisicaId, request.body);
      return reply.status(201).send(linha);
    },
  );

  app.put(
    '/fisicas/:fisicaId/alunos/:alunoId',
    {
      config: somenteAdmin,
      schema: {
        tags: ['alunos'],
        summary: 'Edita um aluno numa Física',
        description:
          'Modal "Editar Aluno", só na edição atual e sem prazo. Nome, curso e matrícula são do cadastro e mudam em todas as Físicas e edições do aluno: o nome define a senha, e curso + matrícula, o login (sem deslogar). A turma é só desta Física. Responde a linha atualizada. Erros, na ordem: `404` (Física inexistente ou de outra edição; aluno não inscrito nela), `400 VALIDACAO` (turma que não existe na Física), `409 ALUNO_EM_GRUPO` (trocar a turma de quem está num grupo), `409 LOGIN_EXISTENTE` (curso + matrícula de outro cadastro).',
        params: alunoNaFisicaParamsSchema,
        body: alunoBodySchema,
        response: {
          200: alunoDaEdicaoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request) =>
      editarAluno(deps, request.params.fisicaId, request.params.alunoId, request.body),
  );
};
