/**
 * Dados de demonstração para testar as telas do aluno e do admin no Swagger sem montar uma
 * planilha (`POST /admin/edicoes`): a edição ativa "DEMO" e duas edições finalizadas
 * ("DEMO 2025/1" e "DEMO 2025/2"), com alunos reaproveitados entre elas e grupos formados,
 * abaixo do mínimo e alunos sem grupo.
 * Só para desenvolvimento: recria as edições DEMO e cadastra (ou atualiza) os alunos de exemplo.
 * Uso: npm run db:seed:demo
 */
import '../src/config/zod.js';
import { z } from 'zod';
import type { Prisma } from '../src/generated/prisma/client.js';
import { criarPrismaClient } from '../src/lib/prisma.js';
import { hashDaSenhaDoAluno, loginDoAluno, senhaDoAluno } from '../src/modules/auth/service.js';

const PREFIXO = 'DEMO';
const UM_DIA = 24 * 60 * 60 * 1000;

const envSchema = z.object({
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** Os 12 primeiros são os do seed antigo (mesmos logins, GES9001 a GEC9012). */
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
  'Marina Teixeira',
  'Nícolas Barros',
  'Olívia Cardoso',
  'Pedro Gomes',
  'Rafaela Moura',
  'Samuel Freitas',
  'Tatiane Lopes',
  'Úrsula Batista',
  'Vinícius Ramos',
  'Wesley Castro',
  'Yasmin Farias',
  'Arthur Mendes',
  'Beatriz Vieira',
  'César Monteiro',
  'Débora Pinto',
  'Eduardo Campos',
  'Fernanda Ribeiro',
  'Gustavo Araújo',
  'Helena Correia',
  'Igor Santana',
  'Júlia Fernandes',
  'Kevin Moreira',
  'Larissa Duarte',
  'Mateus Cavalcanti',
  'Natália Rezende',
  'Otávio Machado',
  'Priscila Nogueira',
  'Renato Siqueira',
].map((nome, indice) => {
  const curso = indice % 2 === 0 ? 'GES' : 'GEC';
  const matricula = String(9001 + indice);
  return { nome, curso, matricula, login: loginDoAluno({ curso, matricula }) };
});

/** Índices de `alunos` de `inicio` a `fim`, inclusive. */
function faixa(inicio: number, fim: number) {
  return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i);
}

type FisicaDemo = {
  codigo: string;
  nome: string;
  quantidadeGrupos: number;
  minimoIntegrantes: number;
  maximoIntegrantes: number;
  multiturma: boolean;
  /** Código da turma → índices dos alunos inscritos nela. */
  turmas: Record<string, number[]>;
  /** Grupos na ordem do número (Grupo 1, 2...). `peloAdmin`: o admin é o autor. */
  grupos: { alunos: number[]; peloAdmin?: boolean }[];
};

type EdicaoDemo = {
  semestre: string;
  ativa: boolean;
  dataLimite: Date;
  /** A ativa é a última criada (as telas do admin mostram a última por padrão). */
  criadoEm: Date;
  fisicas: FisicaDemo[];
};

const agora = Date.now();

const edicoes: EdicaoDemo[] = [
  {
    // Finalizada, como depois do prazo: quase todos em grupo, um grupo abaixo do mínimo.
    semestre: `${PREFIXO} 2025/1`,
    ativa: false,
    dataLimite: new Date('2025-05-20T23:59:59.999-03:00'),
    criadoEm: new Date('2025-02-15T12:00:00-03:00'),
    fisicas: [
      {
        codigo: 'Fis1',
        nome: 'Física 1',
        quantidadeGrupos: 4,
        minimoIntegrantes: 2,
        maximoIntegrantes: 3,
        multiturma: false,
        turmas: { A: faixa(15, 24) },
        grupos: [
          { alunos: [15, 16, 17] },
          { alunos: [18, 19, 20] },
          { alunos: [21, 22] },
          { alunos: [23], peloAdmin: true },
        ],
      },
      {
        codigo: 'Fis2',
        nome: 'Física 2',
        quantidadeGrupos: 3,
        minimoIntegrantes: 3,
        maximoIntegrantes: 4,
        multiturma: false,
        turmas: { A: faixa(25, 30), B: faixa(31, 34) },
        grupos: [{ alunos: [25, 26, 27, 28] }, { alunos: [31, 32, 33] }],
      },
    ],
  },
  {
    semestre: `${PREFIXO} 2025/2`,
    ativa: false,
    dataLimite: new Date('2025-11-20T23:59:59.999-03:00'),
    criadoEm: new Date('2025-08-01T12:00:00-03:00'),
    fisicas: [
      {
        codigo: 'Fis1',
        nome: 'Física 1',
        quantidadeGrupos: 7,
        minimoIntegrantes: 2,
        maximoIntegrantes: 3,
        multiturma: false,
        turmas: { A: faixa(0, 9), B: faixa(10, 19) },
        grupos: [
          { alunos: [0, 1, 2] },
          { alunos: [3, 4, 5] },
          { alunos: [6, 7] },
          { alunos: [8, 9] },
          { alunos: [10, 11, 12] },
          { alunos: [13, 14, 15] },
          { alunos: [16], peloAdmin: true },
        ],
      },
      {
        codigo: 'Fis2',
        nome: 'Física 2',
        quantidadeGrupos: 3,
        minimoIntegrantes: 3,
        maximoIntegrantes: 4,
        multiturma: true,
        turmas: { A: faixa(20, 25), B: faixa(26, 29) },
        grupos: [{ alunos: [20, 21, 26, 27] }, { alunos: [22, 23, 28] }, { alunos: [24, 25, 29] }],
      },
    ],
  },
  {
    // Ativa, no meio do prazo: grupos formados, abaixo do mínimo e muitos alunos sem grupo.
    semestre: PREFIXO,
    ativa: true,
    dataLimite: new Date(agora + 30 * UM_DIA),
    criadoEm: new Date(agora),
    fisicas: [
      {
        codigo: 'F01',
        nome: 'Física 1',
        quantidadeGrupos: 9,
        minimoIntegrantes: 2,
        maximoIntegrantes: 3,
        multiturma: false,
        turmas: { A: faixa(0, 11), B: faixa(12, 23) },
        grupos: [
          // Ana e Bruno: formado, com 1 vaga (a aba "Entrar em um grupo" não vem vazia).
          { alunos: [0, 1] },
          { alunos: [2, 3, 4] },
          { alunos: [12, 13] },
          { alunos: [14], peloAdmin: true },
        ],
      },
      {
        // Perto do limite: 4 de 5 grupos; mais um e a Física responde LIMITE_DE_GRUPOS.
        codigo: 'F02',
        nome: 'Física 2',
        quantidadeGrupos: 5,
        minimoIntegrantes: 3,
        maximoIntegrantes: 4,
        multiturma: true,
        turmas: { A: faixa(0, 7), B: faixa(24, 31) },
        grupos: [
          { alunos: [0, 24, 25] },
          { alunos: [1, 2, 3, 26] },
          { alunos: [27, 28, 29] },
          { alunos: [4, 5, 6] },
        ],
      },
      {
        codigo: 'F03',
        nome: 'Física 3',
        quantidadeGrupos: 4,
        minimoIntegrantes: 2,
        maximoIntegrantes: 4,
        multiturma: false,
        turmas: { A: faixa(32, 35), B: faixa(36, 39), C: faixa(8, 11) },
        grupos: [{ alunos: [36, 37, 38] }],
      },
    ],
  },
];

/**
 * Confere que os dados acima respeitam as regras da API (inscrição única por Física, grupo de
 * inscritos, máximo, quantidade de grupos e turma), para o seed não gravar um estado que a API
 * nunca produziria.
 */
function conferir(edicao: EdicaoDemo) {
  for (const fisica of edicao.fisicas) {
    const onde = `${edicao.semestre} ${fisica.codigo}`;
    const turmaDe = new Map<number, string>();
    for (const [turma, indices] of Object.entries(fisica.turmas)) {
      for (const indice of indices) {
        if (turmaDe.has(indice)) throw new Error(`${onde}: aluno ${indice} em duas turmas.`);
        turmaDe.set(indice, turma);
      }
    }
    if (fisica.grupos.length > fisica.quantidadeGrupos) {
      throw new Error(`${onde}: grupos demais.`);
    }
    if (turmaDe.size > fisica.quantidadeGrupos * fisica.maximoIntegrantes) {
      throw new Error(`${onde}: os alunos não cabem nos grupos.`);
    }
    const emGrupo = new Set<number>();
    for (const grupo of fisica.grupos) {
      if (grupo.alunos.length > fisica.maximoIntegrantes) {
        throw new Error(`${onde}: grupo acima do máximo.`);
      }
      for (const indice of grupo.alunos) {
        if (!turmaDe.has(indice)) throw new Error(`${onde}: aluno ${indice} não inscrito.`);
        if (emGrupo.has(indice)) throw new Error(`${onde}: aluno ${indice} em dois grupos.`);
        emGrupo.add(indice);
      }
      const turmas = new Set(grupo.alunos.map((indice) => turmaDe.get(indice)));
      if (!fisica.multiturma && turmas.size > 1) {
        throw new Error(`${onde}: grupo com turmas diferentes sem multiturma.`);
      }
    }
  }
}

async function criarEdicaoDemo(
  tx: Prisma.TransactionClient,
  edicao: EdicaoDemo,
  ids: number[],
  adminId: number | null,
) {
  const { id: edicaoId } = await tx.edicao.create({
    data: {
      semestre: edicao.semestre,
      ativa: edicao.ativa,
      dataLimite: edicao.dataLimite,
      criadoEm: edicao.criadoEm,
    },
  });
  // Quem entrou num grupo de edição finalizada entrou antes do prazo.
  const entrouNoGrupoEm = new Date(Math.min(agora, edicao.dataLimite.getTime() - 7 * UM_DIA));

  for (const { turmas, grupos, ...configuracao } of edicao.fisicas) {
    const fisica = await tx.fisica.create({
      data: {
        ...configuracao,
        edicaoId,
        turmas: { create: Object.keys(turmas).map((codigo) => ({ codigo })) },
      },
      include: { turmas: true },
    });
    const turmaId = new Map(fisica.turmas.map((turma) => [turma.codigo, turma.id]));

    await tx.inscricao.createMany({
      data: Object.entries(turmas).flatMap(([codigo, indices]) =>
        indices.map((indice) => ({
          alunoId: ids[indice]!,
          fisicaId: fisica.id,
          turmaId: turmaId.get(codigo)!,
        })),
      ),
    });

    for (const [posicao, grupo] of grupos.entries()) {
      const { id: grupoId } = await tx.grupo.create({
        data: {
          fisicaId: fisica.id,
          numero: posicao + 1,
          criadoPorId: grupo.peloAdmin ? adminId : ids[grupo.alunos[0]!]!,
          criadoEm: entrouNoGrupoEm,
        },
      });
      await tx.inscricao.updateMany({
        where: { fisicaId: fisica.id, alunoId: { in: grupo.alunos.map((indice) => ids[indice]!) } },
        data: { grupoId, entrouNoGrupoEm },
      });
    }
  }
}

/** "A · G1" (turma e grupo) ou "-" se o aluno não está na Física. */
function situacaoNaFisica(fisica: FisicaDemo, indice: number) {
  const turma = Object.entries(fisica.turmas).find(([, indices]) => indices.includes(indice));
  if (!turma) return '-';
  const grupo = fisica.grupos.findIndex((g) => g.alunos.includes(indice));
  return grupo === -1 ? turma[0] : `${turma[0]} · G${grupo + 1}`;
}

async function main() {
  const env = envSchema.parse(process.env);
  if (env.NODE_ENV === 'production') {
    throw new Error('O seed de demonstração não roda em produção.');
  }
  edicoes.forEach(conferir);

  const prisma = criarPrismaClient(env.DATABASE_URL);
  try {
    // Uma vez por senha (alunos com o mesmo primeiro nome têm a mesma).
    const senhas = [...new Set(alunos.map(senhaDoAluno))];
    const hashes = new Map(
      await Promise.all(
        senhas.map(async (senha) => [senha, await hashDaSenhaDoAluno(senha)] as const),
      ),
    );
    const daDemo = { OR: [{ semestre: PREFIXO }, { semestre: { startsWith: `${PREFIXO} ` } }] };

    await prisma.$transaction(
      async (tx) => {
        const outraAtiva = await tx.edicao.findFirst({
          where: { ativa: true, NOT: daDemo },
          select: { semestre: true },
        });
        if (outraAtiva) {
          throw new Error(
            `A edição ${outraAtiva.semestre} está ativa. O seed de demonstração não mexe em dados reais.`,
          );
        }

        // Recria as edições DEMO. Os integrantes saem dos grupos antes (a FK do grupo é RESTRICT).
        await tx.inscricao.updateMany({
          where: { fisica: { edicao: daDemo } },
          data: { grupoId: null, entrouNoGrupoEm: null },
        });
        await tx.edicao.deleteMany({ where: daDemo });

        const ids: number[] = [];
        for (const aluno of alunos) {
          const dados = {
            ...aluno,
            senhaHash: hashes.get(senhaDoAluno(aluno))!,
            papel: 'ALUNO' as const,
          };
          const { id } = await tx.usuario.upsert({
            where: { login: aluno.login },
            create: dados,
            update: dados,
          });
          ids.push(id);
        }

        const admin = await tx.usuario.findFirst({
          where: { papel: 'ADMIN' },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const edicao of edicoes) {
          await criarEdicaoDemo(tx, edicao, ids, admin?.id ?? null);
        }
      },
      { timeout: 60_000 },
    );

    const ativa = edicoes.find((edicao) => edicao.ativa)!;
    console.log(
      `Edições criadas: ${edicoes.map((edicao) => edicao.semestre).join(', ')}. ` +
        `A ${ativa.semestre} está ativa (prazo em 30 dias). Alunos (turma · grupo na edição ativa):`,
    );
    console.table(
      alunos.map((aluno, indice) => ({
        login: aluno.login,
        senha: senhaDoAluno(aluno),
        nome: aluno.nome,
        ...Object.fromEntries(
          ativa.fisicas.map((fisica) => [fisica.codigo, situacaoNaFisica(fisica, indice)]),
        ),
      })),
    );
    for (const fisica of ativa.fisicas) {
      console.log(
        `${fisica.codigo}: ${fisica.multiturma ? 'multiturma' : 'sem multiturma'}, ` +
          `${fisica.quantidadeGrupos} grupos, ${fisica.minimoIntegrantes} a ${fisica.maximoIntegrantes} integrantes.`,
      );
    }
    console.log('Na F01, Ana e Bruno estão no Grupo 1 (formado, 1 vaga).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
