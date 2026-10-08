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

const UM_DIA = 24 * 60 * 60 * 1000;

/** Edição ativa com prazo daqui a 1 dia, salvo se indicado. */
export function criarEdicao(
  prisma: PrismaClient,
  dados: { semestre?: string; ativa?: boolean; dataLimite?: Date } = {},
) {
  return prisma.edicao.create({
    data: {
      semestre: dados.semestre ?? '2026/1',
      ativa: dados.ativa ?? true,
      dataLimite: dados.dataLimite ?? new Date(Date.now() + UM_DIA),
    },
  });
}

type NovaFisica = {
  codigo?: string;
  quantidadeGrupos?: number;
  minimoIntegrantes?: number;
  maximoIntegrantes?: number;
  multiturma?: boolean;
  /** Códigos das turmas (padrão: A e B). */
  turmas?: string[];
};

/** Física com suas turmas. `turmas` mapeia o código da turma para o id (ex.: `turmas.A`). */
export async function criarFisica(prisma: PrismaClient, edicaoId: number, dados: NovaFisica = {}) {
  const codigo = dados.codigo ?? 'F01';
  const fisica = await prisma.fisica.create({
    data: {
      edicaoId,
      codigo,
      nome: `Física ${codigo}`,
      quantidadeGrupos: dados.quantidadeGrupos ?? 5,
      minimoIntegrantes: dados.minimoIntegrantes ?? 2,
      maximoIntegrantes: dados.maximoIntegrantes ?? 4,
      multiturma: dados.multiturma ?? false,
      turmas: { create: (dados.turmas ?? ['A', 'B']).map((turma) => ({ codigo: turma })) },
    },
    include: { turmas: true },
  });

  const turmas: Record<string, number> = {};
  for (const turma of fisica.turmas) {
    turmas[turma.codigo] = turma.id;
  }
  return { ...fisica, turmas };
}

/** Aluno com curso GES; e-mail e nome derivados da matrícula, salvo se indicado. */
export function criarAluno(prisma: PrismaClient, matricula: string, nome?: string) {
  return criarUsuario(prisma, {
    email: `aluno${matricula}@teste.local`,
    senha: `GES${matricula}`,
    nome: nome ?? `Aluno ${matricula}`,
    curso: 'GES',
    matricula,
  });
}

export function inscrever(
  prisma: PrismaClient,
  dados: { alunoId: number; fisicaId: number; turmaId: number },
) {
  return prisma.inscricao.create({ data: dados });
}

/** Grupo com os alunos indicados (já inscritos na Física), na ordem de entrada. */
export async function criarGrupo(
  prisma: PrismaClient,
  dados: { fisicaId: number; numero: number; alunoIds: number[] },
) {
  const grupo = await prisma.grupo.create({
    data: { fisicaId: dados.fisicaId, numero: dados.numero },
  });
  for (const [posicao, alunoId] of dados.alunoIds.entries()) {
    await prisma.inscricao.update({
      where: { alunoId_fisicaId: { alunoId, fisicaId: dados.fisicaId } },
      data: { grupoId: grupo.id, entrouNoGrupoEm: new Date(Date.now() + posicao) },
    });
  }
  return grupo;
}
