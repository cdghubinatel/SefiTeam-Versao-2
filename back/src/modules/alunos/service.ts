import type { PrismaClient } from '../../generated/prisma/client.js';
import { escaparLike } from '../../lib/prisma.js';
import { NaoEncontrado } from '../../shared/errors/app-error.js';
import { statusDoAluno } from './regras.js';
import type { AlunosDaEdicao, AlunosDaEdicaoQuery } from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'edicao' | 'fisica' | 'inscricao' | '$queryRaw'> };

/**
 * Ids dos alunos inscritos em alguma Física da edição cujo nome ou matrícula contém `busca`, sem
 * diferenciar maiúsculas nem acentos. SQL à mão porque o Prisma não aplica `unaccent` no `where`
 * (a mesma busca de `grupos/service.ts`, aqui na edição inteira).
 */
async function alunosDaBusca({ prisma }: Deps, edicaoId: number, busca: string) {
  const padrao = `%${escaparLike(busca)}%`;
  const linhas = await prisma.$queryRaw<{ aluno_id: number }[]>`
    SELECT DISTINCT i.aluno_id
    FROM inscricao i
    JOIN fisica f ON f.id = i.fisica_id
    JOIN usuario u ON u.id = i.aluno_id
    WHERE f.edicao_id = ${edicaoId}
      AND (unaccent(u.nome) ILIKE unaccent(${padrao}::text) OR u.matricula ILIKE ${padrao}::text)
  `;
  return linhas.map((linha) => linha.aluno_id);
}

/**
 * Lista de alunos do admin (tela `Admin/ListaAlunos`): uma linha por aluno em cada Física da
 * última edição criada (ativa ou não), com turma, grupo e status. Filtra por nome ou matrícula,
 * Física e status; sem paginação (o front também usa a lista para exportar a planilha de grupos).
 * Sem nenhuma edição, `edicao` vem `null`.
 */
export async function listarAlunosDaEdicao(
  deps: Deps,
  { busca, fisicaId, status }: AlunosDaEdicaoQuery,
): Promise<AlunosDaEdicao> {
  const { prisma } = deps;
  const edicao = await prisma.edicao.findFirst({
    select: { id: true, semestre: true, dataLimite: true, ativa: true },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
  });
  if (!edicao) {
    return { edicao: null, fisicas: [], alunos: [] };
  }

  const fisicas = await prisma.fisica.findMany({
    where: { edicaoId: edicao.id },
    select: {
      id: true,
      codigo: true,
      nome: true,
      turmas: { select: { codigo: true }, orderBy: { codigo: 'asc' } },
    },
    orderBy: { codigo: 'asc' },
  });
  if (fisicaId !== undefined && !fisicas.some((fisica) => fisica.id === fisicaId)) {
    throw new NaoEncontrado('Física não encontrada.');
  }

  const alunoIds = busca ? await alunosDaBusca(deps, edicao.id, busca) : undefined;
  const inscricoes = await prisma.inscricao.findMany({
    where: {
      fisica: { edicaoId: edicao.id },
      fisicaId,
      alunoId: alunoIds && { in: alunoIds },
    },
    select: {
      aluno: { select: { id: true, nome: true, curso: true, matricula: true } },
      fisica: { select: { id: true, codigo: true, minimoIntegrantes: true } },
      turma: { select: { codigo: true } },
      grupo: { select: { id: true, numero: true, _count: { select: { integrantes: true } } } },
    },
    orderBy: [{ aluno: { nome: 'asc' } }, { aluno: { id: 'asc' } }, { fisica: { codigo: 'asc' } }],
  });

  const alunos = inscricoes.map(({ aluno, fisica, turma, grupo }) => ({
    ...aluno,
    fisica: { id: fisica.id, codigo: fisica.codigo },
    turma: turma.codigo,
    grupo: grupo && { id: grupo.id, numero: grupo.numero },
    status: statusDoAluno(grupo?._count.integrantes ?? null, fisica.minimoIntegrantes),
  }));

  return {
    edicao: { ...edicao, dataLimite: edicao.dataLimite.toISOString() },
    fisicas: fisicas.map(({ turmas, ...fisica }) => ({
      ...fisica,
      turmas: turmas.map((turma) => turma.codigo),
    })),
    alunos: status === undefined ? alunos : alunos.filter((aluno) => aluno.status === status),
  };
}
