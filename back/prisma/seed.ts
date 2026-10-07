import argon2 from 'argon2';
import { z } from 'zod';
import { criarPrismaClient } from '../src/lib/prisma.js';
import { normalizarEmail } from '../src/modules/auth/service.js';

const seedEnvSchema = z.object({
  DATABASE_URL: z.url(),
  ADMIN_EMAIL: z.email('ADMIN_EMAIL deve ser um e-mail válido'),
  // O admin é o alvo mais valioso de força bruta (a senha dos alunos é aleatória).
  ADMIN_SENHA: z.string().min(16, 'ADMIN_SENHA deve ter pelo menos 16 caracteres'),
});

async function main() {
  const env = seedEnvSchema.parse(process.env);
  const prisma = criarPrismaClient(env.DATABASE_URL);

  try {
    const email = normalizarEmail(env.ADMIN_EMAIL);
    const senhaHash = await argon2.hash(env.ADMIN_SENHA);

    // Idempotente: cria o admin ou atualiza a senha se ele já existir.
    await prisma.usuario.upsert({
      where: { email },
      create: { email, senhaHash, nome: 'Administrador', papel: 'ADMIN' },
      update: { senhaHash },
    });

    console.log(`Admin "${email}" pronto.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
