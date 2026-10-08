import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import {
  alunoResumoSchema,
  colegasQuerySchema,
  criarGrupoBodySchema,
  fisicaParamsSchema,
  grupoSchema,
  minhasFisicasSchema,
} from './schemas.js';
import {
  criarGrupo,
  listarColegasDisponiveis,
  listarGruposParaEntrar,
  listarMinhasFisicas,
} from './service.js';

const somenteAluno = { papeis: ['ALUNO' as const] };

/** Registrado sem prefixo: as rotas ficam em `/fisicas/...` e `/grupos/...`. */
export const gruposRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.get(
    '/fisicas/minhas',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Físicas do aluno na edição ativa',
        description:
          'Dashboard do aluno: cada Física em que ele está inscrito, com a turma e o grupo (ou `null`). Sem edição ativa, `edicao` é `null` e a lista vem vazia.',
        response: { 200: minhasFisicasSchema, 401: erroSchema, 403: erroSchema },
      },
    },
    async (request) => listarMinhasFisicas(deps, request.usuario.id),
  );

  app.get(
    '/fisicas/:fisicaId/grupos',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Grupos em que o aluno pode entrar',
        description:
          'Só os grupos com vaga e, sem multiturma, da turma do aluno. `409 JA_EM_GRUPO` se ele já tem grupo nesta Física. `404` se a Física não é da edição ativa ou o aluno não está inscrito nela.',
        params: fisicaParamsSchema,
        response: {
          200: z.array(grupoSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request) => listarGruposParaEntrar(deps, request.usuario.id, request.params.fisicaId),
  );

  app.get(
    '/fisicas/:fisicaId/colegas-disponiveis',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Colegas que o aluno pode incluir num grupo',
        description:
          'Inscritos na Física, sem grupo e, sem multiturma, da mesma turma; em ordem de nome. Serve para criar um grupo e para adicionar colegas ao grupo do aluno. `busca` filtra por parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos.',
        params: fisicaParamsSchema,
        querystring: colegasQuerySchema,
        response: {
          200: z.array(alunoResumoSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) =>
      listarColegasDisponiveis(
        deps,
        request.usuario.id,
        request.params.fisicaId,
        request.query.busca,
      ),
  );

  app.post(
    '/fisicas/:fisicaId/grupos',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Cria um grupo',
        description:
          'Quem cria entra no grupo, junto com os `colegas` escolhidos (ids de aluno; vazio = sozinho), que entram sem precisar aceitar. Recebe o menor número livre na Física. Erros `409`: `PRAZO_ENCERRADO`, `JA_EM_GRUPO` (o aluno ou um colega), `GRUPO_CHEIO`, `TURMA_DIFERENTE`, `LIMITE_DE_GRUPOS`. `404` se a Física não é da edição ativa, se o aluno não está inscrito nela ou se um colega não está.',
        params: fisicaParamsSchema,
        body: criarGrupoBodySchema,
        response: {
          201: grupoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      const grupo = await criarGrupo(
        deps,
        request.usuario.id,
        request.params.fisicaId,
        request.body,
      );
      return reply.status(201).send(grupo);
    },
  );
};
