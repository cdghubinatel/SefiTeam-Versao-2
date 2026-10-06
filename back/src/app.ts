import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from './config/env.js';
import { authRoutes } from './modules/auth/routes.js';
import { duvidasRoutes } from './modules/duvidas/routes.js';
import auth from './plugins/auth.js';
import prisma from './plugins/prisma.js';
import swagger from './plugins/swagger.js';
import { MuitasTentativas } from './shared/errors/app-error.js';
import { registrarErrorHandler } from './shared/errors/error-handler.js';

export async function buildApp(opcoes: FastifyServerOptions = {}) {
  const app = fastify(opcoes).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarErrorHandler(app);

  // Aceita Content-Type JSON com corpo vazio (o Swagger UI e alguns clientes enviam assim em POST sem corpo).
  const parserJsonPadrao = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, corpo, done) => {
    if (corpo.length === 0) {
      return done(null, undefined);
    }
    // O parser padrão responde pelo `done`; o tipo também admite uma versão async, daí o `void`.
    void parserJsonPadrao(request, corpo.toString(), done);
  });

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN });
  // Desligado por padrão; cada rota ativa com `config.rateLimit`.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => new MuitasTentativas(),
  });
  await app.register(prisma);
  await app.register(auth);

  if (env.SWAGGER_ENABLED) {
    await app.register(swagger);
  }

  app.get(
    '/health',
    {
      config: { publica: true },
      schema: {
        tags: ['infra'],
        summary: 'Verifica se a API está no ar',
        security: [],
        response: { 200: z.object({ status: z.literal('ok') }) },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(duvidasRoutes, { prefix: '/duvidas' });

  return app;
}
