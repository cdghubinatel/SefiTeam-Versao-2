import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export const SWAGGER_PREFIXO = '/docs';

export default fp(
  async (app) => {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'SefiTeam API',
          description: 'API de formação de grupos da SEFITEL.',
          version: '0.1.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      transform: jsonSchemaTransform,
    });

    await app.register(fastifySwaggerUi, { routePrefix: SWAGGER_PREFIXO });
  },
  { name: 'swagger' },
);
