import argon2 from 'argon2';
import type { Papel, PrismaClient } from '../generated/prisma/client.js';

/** Apaga todos os dados do banco de teste (mantém a estrutura). */
export async function limparBanco(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE inscricao, grupo, turma, fisica, edicao, usuario, duvida_frequente RESTART IDENTITY CASCADE',
  );
}

type NovoUsuario = { login: string; senha: string; papel?: Papel; nome?: string };

export async function criarUsuario(prisma: PrismaClient, dados: NovoUsuario) {
  return prisma.usuario.create({
    data: {
      login: dados.login,
      senhaHash: await argon2.hash(dados.senha),
      nome: dados.nome ?? dados.login,
      papel: dados.papel ?? 'ALUNO',
    },
  });
}
