import '../src/config/zod.js';
import argon2 from 'argon2';
import { z } from 'zod';
import { criarPrismaClient } from '../src/lib/prisma.js';
import { normalizarLogin } from '../src/modules/auth/service.js';

const seedEnvSchema = z.object({
  DATABASE_URL: z.url(),
  ADMIN_LOGIN: z.string().trim().min(1, 'ADMIN_LOGIN é obrigatório'),
  // O admin é o alvo mais valioso de força bruta: a senha dele é escolhida por uma pessoa
  // (ver docs/autenticacao.md).
  ADMIN_SENHA: z.string().min(16, 'ADMIN_SENHA deve ter pelo menos 16 caracteres'),
});

async function main() {
  const env = seedEnvSchema.parse(process.env);
  const prisma = criarPrismaClient(env.DATABASE_URL);

  try {
    const login = normalizarLogin(env.ADMIN_LOGIN);
    const senhaHash = await argon2.hash(env.ADMIN_SENHA);

    // Idempotente: existe um único admin. Se já existir, atualiza o login e a senha.
    const admin = await prisma.usuario.findFirst({
      where: { papel: 'ADMIN' },
      select: { id: true },
    });
    if (admin) {
      await prisma.usuario.update({ where: { id: admin.id }, data: { login, senhaHash } });
    } else {
      await prisma.usuario.create({
        data: { login, senhaHash, nome: 'Administrador', papel: 'ADMIN' },
      });
    }

    console.log(`Admin "${login}" pronto.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
