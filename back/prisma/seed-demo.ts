/**
 * Dados de demonstração para testar os grupos no Swagger enquanto o upload da planilha não existe.
 * Só para desenvolvimento: recria a edição "DEMO" (ativa) e cadastra alunos de exemplo.
 * Uso: npm run db:seed:demo
 */
import argon2 from 'argon2';
import { z } from 'zod';
import { criarPrismaClient } from '../src/lib/prisma.js';
import { normalizarEmail, senhaDoAluno } from '../src/modules/auth/service.js';

const SEMESTRE = 'DEMO';
const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

const envSchema = z.object({
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const alunos = [
  'Ana Souza',
  'Bruno Lima',
  'Carla Dias',
  'Diego Rocha',
  'Elisa Prado',
  'Fábio Nunes',
  'Gabriela Reis',
  'Henrique Alves',
  'Isabela Costa',
  'João Pereira',
  'Karina Melo',
  'Lucas Martins',
].map((nome, indice) => {
  const matricula = String(9001 + indice);
  return {
    nome,
    curso: indice % 2 === 0 ? 'GES' : 'GEC',
    matricula,
    email: normalizarEmail(`demo${matricula}@sefiteam.local`),
  };
});

async function main() {
  const env = envSchema.parse(process.env);
  if (env.NODE_ENV === 'production') {
    throw new Error('O seed de demonstração não roda em produção.');
  }

  const prisma = criarPrismaClient(env.DATABASE_URL);
  try {
    const hashes = await Promise.all(alunos.map((aluno) => argon2.hash(senhaDoAluno(aluno))));

    await prisma.$transaction(async (tx) => {
      const outraAtiva = await tx.edicao.findFirst({
        where: { ativa: true, semestre: { not: SEMESTRE } },
        select: { semestre: true },
      });
      if (outraAtiva) {
        throw new Error(
          `A edição ${outraAtiva.semestre} está ativa. O seed de demonstração não mexe em dados reais.`,
        );
      }

      // Recria a edição DEMO. Os integrantes saem do grupo antes (a FK do grupo é RESTRICT).
      await tx.inscricao.updateMany({
        where: { fisica: { edicao: { semestre: SEMESTRE } } },
        data: { grupoId: null, entrouNoGrupoEm: null },
      });
      await tx.edicao.deleteMany({ where: { semestre: SEMESTRE } });

      const edicao = await tx.edicao.create({
        data: { semestre: SEMESTRE, ativa: true, dataLimite: new Date(Date.now() + TRINTA_DIAS) },
      });
      const fisicaComTurmas = (dados: {
        codigo: string;
        nome: string;
        quantidadeGrupos: number;
        minimoIntegrantes: number;
        maximoIntegrantes: number;
        multiturma: boolean;
      }) =>
        tx.fisica.create({
          data: {
            ...dados,
            edicaoId: edicao.id,
            turmas: { create: [{ codigo: 'A' }, { codigo: 'B' }] },
          },
          include: { turmas: { orderBy: { codigo: 'asc' } } },
        });
      const f01 = await fisicaComTurmas({
        codigo: 'F01',
        nome: 'Física 1',
        quantidadeGrupos: 4,
        minimoIntegrantes: 2,
        maximoIntegrantes: 3,
        multiturma: false,
      });
      const f02 = await fisicaComTurmas({
        codigo: 'F02',
        nome: 'Física 2',
        quantidadeGrupos: 3,
        minimoIntegrantes: 2,
        maximoIntegrantes: 3,
        multiturma: true,
      });

      const ids: number[] = [];
      for (const [indice, aluno] of alunos.entries()) {
        const dados = { ...aluno, senhaHash: hashes[indice]!, papel: 'ALUNO' as const };
        const { id } = await tx.usuario.upsert({
          where: { email: aluno.email },
          create: dados,
          update: dados,
        });
        ids.push(id);
      }

      // F01 (sem multiturma): 6 alunos na turma A e 6 na B. F02 (multiturma): os 8 primeiros.
      const [f01A, f01B] = f01.turmas;
      const [f02A, f02B] = f02.turmas;
      await tx.inscricao.createMany({
        data: [
          ...ids.map((alunoId, indice) => ({
            alunoId,
            fisicaId: f01.id,
            turmaId: indice < 6 ? f01A!.id : f01B!.id,
          })),
          ...ids.slice(0, 8).map((alunoId, indice) => ({
            alunoId,
            fisicaId: f02.id,
            turmaId: indice % 2 === 0 ? f02A!.id : f02B!.id,
          })),
        ],
      });

      // Limites pequenos (2 a 3 integrantes; na F01, 4 grupos x 3 = os 12 alunos) para testar os limites.
      // Um grupo já formado na F01 (turma A), com 1 vaga, para a aba "Entrar em um grupo" não vir vazia.
      const grupo = await tx.grupo.create({
        data: { fisicaId: f01.id, numero: 1, criadoPorId: ids[0]! },
      });
      await tx.inscricao.updateMany({
        where: { fisicaId: f01.id, alunoId: { in: ids.slice(0, 2) } },
        data: { grupoId: grupo.id, entrouNoGrupoEm: new Date() },
      });
    });

    console.log(`Edição ${SEMESTRE} criada (ativa, prazo em 30 dias). Logins dos alunos:`);
    console.table(
      alunos.map((aluno, indice) => ({
        email: aluno.email,
        senha: senhaDoAluno(aluno),
        nome: aluno.nome,
        F01: indice < 6 ? 'A' : 'B',
        F02: indice < 8 ? (indice % 2 === 0 ? 'A' : 'B') : '-',
      })),
    );
    console.log(
      'F01: sem multiturma, 4 grupos, 2 a 3 integrantes. F02: multiturma, 3 grupos, 2 a 3.',
    );
    console.log('Na F01, Ana e Bruno já estão no Grupo 1 (formado, 1 vaga).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
