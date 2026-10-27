import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import { loginBodySchema, loginRespostaSchema, usuarioSchema } from './schemas.js';
import { autenticar, encerrarSessoes, normalizarLogin } from './service.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/login',
    {
      config: {
        publica: true,
        // Por IP + login: alunos na mesma rede (mesmo IP) não bloqueiam uns aos outros.
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request) => {
            const { login } = (request.body ?? {}) as { login?: unknown };
            return `${request.ip}:${typeof login === 'string' ? normalizarLogin(login) : ''}`;
          },
        },
      },
      schema: {
        tags: ['auth'],
        summary: 'Login',
        description: 'Devolve o token JWT. Envie-o em `Authorization: Bearer <token>`.',
        security: [],
        body: loginBodySchema,
        response: { 200: loginRespostaSchema, 400: erroSchema, 401: erroSchema, 429: erroSchema },
      },
    },
    async (request) => {
      const { usuario, tokenVersao } = await autenticar({ prisma: app.prisma }, request.body);
      const token = app.jwt.sign({
        sub: String(usuario.id),
        papel: usuario.papel,
        versao: tokenVersao,
      });
      return { token, usuario };
    },
  );

  app.get(
    '/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'Usuário logado',
        response: { 200: usuarioSchema, 401: erroSchema },
      },
    },
    async (request) => request.usuario,
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Logout',
        description:
          'Invalida todos os tokens do usuário, em todos os dispositivos. O front-end também descarta o token.',
        response: { 204: z.null(), 401: erroSchema },
      },
    },
    async (request, reply) => {
      await encerrarSessoes({ prisma: app.prisma }, request.usuario.id);
      return reply.status(204).send(null);
    },
  );
};
