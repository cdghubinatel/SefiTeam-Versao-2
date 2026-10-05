import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from './config/env';
import swagger from './plugins/swagger';

export async function buildApp(opcoes: FastifyServerOptions = {}) {
  const app = fastify(opcoes).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet);
  await app.register(cors, { origin: env.CORS_ORIGIN });

  if (env.SWAGGER_ENABLED) {
    await app.register(swagger);
  }

  app.get(
    '/health',
    {
      schema: {
        tags: ['infra'],
        summary: 'Verifica se a API está no ar',
        security: [],
        response: { 200: z.object({ status: z.literal('ok') }) },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  return app;
}
