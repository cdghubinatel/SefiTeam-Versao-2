import { execSync } from 'node:child_process';

// Roda uma vez antes de todos os testes: aplica as migrations no banco de teste.
export default function setup() {
  const banco = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!banco.endsWith('_test')) {
    // Os testes apagam dados: nunca rodar contra o banco de desenvolvimento.
    throw new Error(
      `DATABASE_URL de teste precisa apontar para um banco *_test (atual: ${banco}).`,
    );
  }

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
