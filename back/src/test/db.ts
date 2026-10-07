import argon2 from 'argon2';
import type { Papel, PrismaClient } from '../generated/prisma/client.js';

/** Apaga todos os dados do banco de teste (mantém a estrutura). */
export async function limparBanco(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE inscricao, grupo, turma, fisica, edicao, usuario, duvida_frequente RESTART IDENTITY CASCADE',
  );
}

type NovoUsuario = {
  /** Já normalizado (minúsculas), como o cadastro grava. */
  email: string;
  /** Gravada como hash, do jeito que veio (para aluno, use `senhaDoAluno`). */
  senha: string;
  papel?: Papel;
  nome?: string;
  curso?: string;
  matricula?: string;
};

export async function criarUsuario(prisma: PrismaClient, dados: NovoUsuario) {
  return prisma.usuario.create({
    data: {
      email: dados.email,
      senhaHash: await argon2.hash(dados.senha),
      nome: dados.nome ?? dados.email,
      papel: dados.papel ?? 'ALUNO',
      curso: dados.curso ?? null,
      matricula: dados.matricula ?? null,
    },
  });
}
