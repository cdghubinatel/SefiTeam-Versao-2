import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import {
  duvidaBodySchema,
  duvidaParamsSchema,
  duvidaSchema,
  reordenarBodySchema,
} from './schemas.js';
import {
  apagarDuvida,
  atualizarDuvida,
  criarDuvida,
  listarDuvidas,
  reordenarDuvidas,
} from './service.js';

const somenteAdmin = { papeis: ['ADMIN' as const] };

export const duvidasRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.get(
    '',
    {
      schema: {
        tags: ['duvidas'],
        summary: 'Lista as dúvidas frequentes',
        description: 'Na ordem de exibição. Qualquer usuário logado.',
        response: { 200: z.array(duvidaSchema), 401: erroSchema },
      },
    },
    async () => listarDuvidas(deps),
  );

  app.post(
    '',
    {
      config: somenteAdmin,
      schema: {
        tags: ['duvidas'],
        summary: 'Cadastra uma dúvida',
        description: 'Texto puro; quebras de linha são mantidas. Entra no fim da lista.',
        body: duvidaBodySchema,
        response: { 201: duvidaSchema, 400: erroSchema, 401: erroSchema, 403: erroSchema },
      },
    },
    async (request, reply) => {
      const duvida = await criarDuvida(deps, request.body);
      return reply.status(201).send(duvida);
    },
  );

  // Rota estática: o Fastify a prioriza sobre `/:id`.
  app.put(
    '/ordem',
    {
      config: somenteAdmin,
      schema: {
        tags: ['duvidas'],
        summary: 'Reordena as dúvidas',
        description:
          'Recebe todos os ids na nova ordem. `409 ORDEM_DESATUALIZADA` se a lista não tiver exatamente as dúvidas cadastradas (recarregue e tente de novo).',
        body: reordenarBodySchema,
        response: {
          200: z.array(duvidaSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request) => reordenarDuvidas(deps, request.body.ids),
  );

  app.put(
    '/:id',
    {
      config: somenteAdmin,
      schema: {
        tags: ['duvidas'],
        summary: 'Edita uma dúvida',
        params: duvidaParamsSchema,
        body: duvidaBodySchema,
        response: {
          200: duvidaSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) => atualizarDuvida(deps, request.params.id, request.body),
  );

  app.delete(
    '/:id',
    {
      config: somenteAdmin,
      schema: {
        tags: ['duvidas'],
        summary: 'Apaga uma dúvida',
        params: duvidaParamsSchema,
        response: {
          204: z.null(),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request, reply) => {
      await apagarDuvida(deps, request.params.id);
      return reply.status(204).send(null);
    },
  );
};
