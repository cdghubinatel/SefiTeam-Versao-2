import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { escaparLike } from '../../lib/prisma.js';
import { JaEmGrupo, NaoEncontrado } from '../../shared/errors/app-error.js';
import { estaFormado, turmaCompativel } from './regras.js';
import type { AlunoResumo, Grupo, MinhasFisicas } from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'edicao' | 'inscricao' | 'grupo' | '$queryRaw'> };

/** Inscrição → aluno como aparece nas listas (`turmaId` serve para a regra de multiturma). */
const selectAlunoResumo = {
  turmaId: true,
  aluno: { select: { id: true, nome: true, curso: true, matricula: true } },
  turma: { select: { codigo: true } },
} satisfies Prisma.InscricaoSelect;

const selectGrupo = {
  id: true,
  numero: true,
  fisicaId: true,
  fisica: { select: { minimoIntegrantes: true } },
  integrantes: {
    select: selectAlunoResumo,
    orderBy: [{ entrouNoGrupoEm: 'asc' }, { aluno: { nome: 'asc' } }],
  },
} satisfies Prisma.GrupoSelect;

type InscricaoResumo = Prisma.InscricaoGetPayload<{ select: typeof selectAlunoResumo }>;
type GrupoComIntegrantes = Prisma.GrupoGetPayload<{ select: typeof selectGrupo }>;

function paraAlunoResumo({ aluno, turma }: InscricaoResumo): AlunoResumo {
  return { ...aluno, turma: turma.codigo };
}

function paraGrupo(grupo: GrupoComIntegrantes): Grupo {
  return {
    id: grupo.id,
    numero: grupo.numero,
    fisicaId: grupo.fisicaId,
    formado: estaFormado(grupo.integrantes.length, grupo.fisica.minimoIntegrantes),
    integrantes: grupo.integrantes.map(paraAlunoResumo),
  };
}

/**
 * Inscrição do aluno numa Física da edição ativa. Física inexistente, de outra edição
 * ou em que o aluno não está inscrito dão o mesmo 404.
 */
async function inscricaoNaEdicaoAtiva({ prisma }: Deps, alunoId: number, fisicaId: number) {
  const inscricao = await prisma.inscricao.findFirst({
    where: { alunoId, fisicaId, fisica: { edicao: { ativa: true } } },
    select: {
      turmaId: true,
      grupoId: true,
      fisica: { select: { multiturma: true, maximoIntegrantes: true } },
    },
  });
  if (!inscricao) {
    throw new NaoEncontrado('Física não encontrada.');
  }
  return inscricao;
}

/** Dashboard do aluno: as Físicas dele na edição ativa, com a turma e o grupo de cada uma. */
export async function listarMinhasFisicas(
  { prisma }: Deps,
  alunoId: number,
): Promise<MinhasFisicas> {
  const edicao = await prisma.edicao.findFirst({
    where: { ativa: true },
    select: { id: true, semestre: true, dataLimite: true },
  });
  if (!edicao) {
    return { edicao: null, fisicas: [] };
  }

  const inscricoes = await prisma.inscricao.findMany({
    where: { alunoId, fisica: { edicaoId: edicao.id } },
    select: {
      turma: { select: { codigo: true } },
      fisica: {
        select: {
          id: true,
          codigo: true,
          nome: true,
          minimoIntegrantes: true,
          maximoIntegrantes: true,
          multiturma: true,
        },
      },
      grupo: { select: selectGrupo },
    },
    orderBy: { fisica: { codigo: 'asc' } },
  });

  return {
    edicao: { semestre: edicao.semestre, dataLimite: edicao.dataLimite.toISOString() },
    fisicas: inscricoes.map(({ turma, fisica, grupo }) => ({
      ...fisica,
      turma: turma.codigo,
      grupo: grupo ? paraGrupo(grupo) : null,
    })),
  };
}

/**
 * Aba "Entrar em um grupo": só os grupos em que o aluno pode entrar agora
 * (com vaga e, sem multiturma, da turma dele).
 */
export async function listarGruposParaEntrar(
  deps: Deps,
  alunoId: number,
  fisicaId: number,
): Promise<Grupo[]> {
  const { turmaId, grupoId, fisica } = await inscricaoNaEdicaoAtiva(deps, alunoId, fisicaId);
  if (grupoId !== null) {
    throw new JaEmGrupo();
  }

  const grupos = await deps.prisma.grupo.findMany({
    where: { fisicaId },
    select: selectGrupo,
    orderBy: { numero: 'asc' },
  });

  return grupos
    .filter(
      ({ integrantes }) =>
        integrantes.length < fisica.maximoIntegrantes &&
        turmaCompativel({
          multiturma: fisica.multiturma,
          turmasDoGrupo: integrantes.map((integrante) => integrante.turmaId),
          turmaDoAluno: turmaId,
        }),
    )
    .map(paraGrupo);
}

/**
 * Ids dos alunos inscritos na Física cujo nome ou matrícula contém `busca`, sem diferenciar
 * maiúsculas nem acentos ("joao" encontra "João"). SQL à mão porque o Prisma não aplica
 * funções (`unaccent`) no `where`; a extensão é criada na migration `busca_sem_acento`.
 */
async function alunosDaBusca({ prisma }: Deps, fisicaId: number, busca: string) {
  const padrao = `%${escaparLike(busca)}%`;
  const linhas = await prisma.$queryRaw<{ aluno_id: number }[]>`
    SELECT i.aluno_id
    FROM inscricao i
    JOIN usuario u ON u.id = i.aluno_id
    WHERE i.fisica_id = ${fisicaId}
      AND (unaccent(u.nome) ILIKE unaccent(${padrao}::text) OR u.matricula ILIKE ${padrao}::text)
  `;
  return linhas.map((linha) => linha.aluno_id);
}

/**
 * Colegas que o aluno pode incluir: inscritos na Física, sem grupo e, sem multiturma, da turma
 * dele. Serve para criar um grupo e para adicionar colegas ao grupo em que ele já está.
 */
export async function listarColegasDisponiveis(
  deps: Deps,
  alunoId: number,
  fisicaId: number,
  busca?: string,
): Promise<AlunoResumo[]> {
  const { turmaId, fisica } = await inscricaoNaEdicaoAtiva(deps, alunoId, fisicaId);
  const encontrados = busca ? await alunosDaBusca(deps, fisicaId, busca) : undefined;

  const colegas = await deps.prisma.inscricao.findMany({
    where: {
      fisicaId,
      grupoId: null,
      alunoId: { not: alunoId, in: encontrados },
      turmaId: fisica.multiturma ? undefined : turmaId,
    },
    select: selectAlunoResumo,
    orderBy: { aluno: { nome: 'asc' } },
  });

  return colegas.map(paraAlunoResumo);
}
