import fp from 'fastify-plugin';
import { env } from '../config/env';
import type { PrismaClient } from '../generated/prisma/client';
import { criarPrismaClient } from '../lib/prisma';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(
  async (app) => {
    const prisma = criarPrismaClient(env.DATABASE_URL);

    app.decorate('prisma', prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);
