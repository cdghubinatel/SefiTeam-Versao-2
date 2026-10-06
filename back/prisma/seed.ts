import argon2 from 'argon2';
import { z } from 'zod';
import { criarPrismaClient } from '../src/lib/prisma.js';

const seedEnvSchema = z.object({
  DATABASE_URL: z.url(),
  ADMIN_LOGIN: z.string().trim().min(1),
  ADMIN_SENHA: z.string().min(8, 'ADMIN_SENHA deve ter pelo menos 8 caracteres'),
});

async function main() {
  const env = seedEnvSchema.parse(process.env);
  const prisma = criarPrismaClient(env.DATABASE_URL);

  try {
    const login = env.ADMIN_LOGIN.toUpperCase();
    const senhaHash = await argon2.hash(env.ADMIN_SENHA);

    // Idempotente: cria o admin ou atualiza a senha se ele já existir.
    await prisma.usuario.upsert({
      where: { login },
      create: { login, senhaHash, nome: 'Administrador', papel: 'ADMIN' },
      update: { senhaHash },
    });

    console.log(`Admin "${login}" pronto.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
