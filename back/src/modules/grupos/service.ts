import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { escaparLike } from '../../lib/prisma.js';
import {
  DadosInvalidos,
  GrupoCheio,
  GrupoIncompleto,
  JaEmGrupo,
  LimiteDeGrupos,
  NaoEncontrado,
  PrazoEncerrado,
  TurmaDiferente,
} from '../../shared/errors/app-error.js';
import { estaFormado, menorNumeroLivre, prazoEncerrado, turmaCompativel } from './regras.js';
import type {
  AdicionarIntegrantesBody,
  AlunoResumo,
  CriarGrupoBody,
  Grupo,
  MinhasFisicas,
  RemocaoDeIntegrante,
} from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'edicao' | 'inscricao' | 'grupo' | '$queryRaw'> };
type DepsComTransacao = { prisma: Pick<PrismaClient, '$transaction'> };
type Transacao = Prisma.TransactionClient;

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
 * ou em que o aluno não está inscrito dão o mesmo 404 (`mensagem404` muda só o texto:
 * nas rotas por grupo, o aluno também não deve distinguir os casos).
 */
async function inscricaoNaEdicaoAtiva(
  { prisma }: { prisma: Pick<PrismaClient, 'inscricao'> },
  alunoId: number,
  fisicaId: number,
  mensagem404 = 'Física não encontrada.',
) {
  const inscricao = await prisma.inscricao.findFirst({
    where: { alunoId, fisicaId, fisica: { edicao: { ativa: true } } },
    select: {
      turmaId: true,
      grupoId: true,
      fisica: {
        select: {
          multiturma: true,
          minimoIntegrantes: true,
          maximoIntegrantes: true,
          quantidadeGrupos: true,
          edicao: { select: { dataLimite: true } },
        },
      },
    },
  });
  if (!inscricao) {
    throw new NaoEncontrado(mensagem404);
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

/**
 * Trava a linha da Física até o fim da transação. Toda ação que altera grupos chama isto
 * primeiro, então as ações de uma mesma Física rodam uma de cada vez e as contagens
 * (integrantes, grupos, número livre) não ficam desatualizadas (ver docs/grupos.md).
 */
async function travarFisica(tx: Transacao, fisicaId: number) {
  await tx.$queryRaw`SELECT id FROM fisica WHERE id = ${fisicaId} FOR UPDATE`;
}

/**
 * Quem vai entrar no grupo (colegas de quem cria, ou alunos adicionados depois) precisa estar
 * inscrito na Física, sem grupo e, sem multiturma, na turma dos integrantes do grupo.
 */
async function validarNovosIntegrantes(
  tx: Transacao,
  fisicaId: number,
  alunoIds: number[],
  { turmasDoGrupo, multiturma }: { turmasDoGrupo: readonly number[]; multiturma: boolean },
) {
  if (alunoIds.length === 0) {
    return;
  }

  const inscricoes = await tx.inscricao.findMany({
    where: { fisicaId, alunoId: { in: alunoIds } },
    select: { turmaId: true, grupoId: true, aluno: { select: { nome: true } } },
  });
  if (inscricoes.length !== alunoIds.length) {
    throw new NaoEncontrado('Um dos alunos selecionados não está inscrito nesta Física.');
  }

  for (const novo of inscricoes) {
    if (novo.grupoId !== null) {
      throw new JaEmGrupo(`${novo.aluno.nome} já está em um grupo nesta Física.`);
    }
    if (!turmaCompativel({ multiturma, turmasDoGrupo, turmaDoAluno: novo.turmaId })) {
      throw new TurmaDiferente(
        `${novo.aluno.nome} é de outra turma, e esta Física não aceita turmas diferentes no mesmo grupo.`,
      );
    }
  }
}

/**
 * O aluno cria um grupo na Física e entra nele, junto com os colegas escolhidos (que entram
 * sem precisar aceitar). O grupo já nasce com o mínimo de integrantes (formado).
 * Tudo numa transação, com a Física travada.
 */
export async function criarGrupo(
  { prisma }: DepsComTransacao,
  alunoId: number,
  fisicaId: number,
  { colegas }: CriarGrupoBody,
): Promise<Grupo> {
  if (colegas.includes(alunoId)) {
    throw new DadosInvalidos('colegas', 'Não inclua você mesmo: quem cria o grupo já entra nele.');
  }

  return prisma.$transaction(async (tx) => {
    await travarFisica(tx, fisicaId);

    const { turmaId, grupoId, fisica } = await inscricaoNaEdicaoAtiva(
      { prisma: tx },
      alunoId,
      fisicaId,
    );
    if (prazoEncerrado(fisica.edicao.dataLimite)) {
      throw new PrazoEncerrado();
    }
    if (grupoId !== null) {
      throw new JaEmGrupo();
    }
    if (1 + colegas.length > fisica.maximoIntegrantes) {
      throw new GrupoCheio(fisica.maximoIntegrantes);
    }
    // Todo grupo nasce formado: quem cria escolhe colegas até atingir o mínimo da Física.
    if (1 + colegas.length < fisica.minimoIntegrantes) {
      throw new GrupoIncompleto(fisica.minimoIntegrantes);
    }
    await validarNovosIntegrantes(tx, fisicaId, colegas, {
      turmasDoGrupo: [turmaId],
      multiturma: fisica.multiturma,
    });

    const existentes = await tx.grupo.findMany({ where: { fisicaId }, select: { numero: true } });
    if (existentes.length >= fisica.quantidadeGrupos) {
      throw new LimiteDeGrupos();
    }

    const { id } = await tx.grupo.create({
      data: {
        fisicaId,
        numero: menorNumeroLivre(existentes.map((grupo) => grupo.numero)),
        criadoPorId: alunoId,
      },
      select: { id: true },
    });
    await tx.inscricao.updateMany({
      where: { fisicaId, alunoId: { in: [alunoId, ...colegas] } },
      data: { grupoId: id, entrouNoGrupoEm: new Date() },
    });

    return paraGrupo(await tx.grupo.findUniqueOrThrow({ where: { id }, select: selectGrupo }));
  });
}

/** Mesmo texto para grupo inexistente, de edição inativa ou de Física sem inscrição. */
const GRUPO_NAO_ENCONTRADO = 'Grupo não encontrado.';

function grupoNaoEncontrado() {
  return new NaoEncontrado(GRUPO_NAO_ENCONTRADO);
}

type DepsDoGrupo = { prisma: Pick<PrismaClient, 'grupo' | '$transaction'> };

/**
 * Id da Física do grupo, lido antes da transação porque é necessário para travá-la. Depois do
 * lock, o grupo precisa ser relido: ele pode ter mudado (ou sido apagado) enquanto esperava.
 */
async function fisicaDoGrupo({ prisma }: DepsDoGrupo, grupoId: number) {
  const grupo = await prisma.grupo.findUnique({
    where: { id: grupoId },
    select: { fisicaId: true },
  });
  if (!grupo) {
    throw grupoNaoEncontrado();
  }
  return grupo.fisicaId;
}

/**
 * O aluno entra num grupo existente da Física. Grupo inexistente, de edição inativa ou de
 * Física em que o aluno não está inscrito dão o mesmo 404. Tudo numa transação, com a
 * Física travada: dois alunos disputando a última vaga não passam os dois.
 */
export async function entrarNoGrupo(
  deps: DepsDoGrupo,
  alunoId: number,
  grupoId: number,
): Promise<Grupo> {
  const fisicaId = await fisicaDoGrupo(deps, grupoId);

  return deps.prisma.$transaction(async (tx) => {
    await travarFisica(tx, fisicaId);

    const atual = await tx.grupo.findUnique({ where: { id: grupoId }, select: selectGrupo });
    if (!atual) {
      throw grupoNaoEncontrado();
    }
    const {
      turmaId,
      grupoId: grupoDoAluno,
      fisica,
    } = await inscricaoNaEdicaoAtiva({ prisma: tx }, alunoId, fisicaId, GRUPO_NAO_ENCONTRADO);
    if (prazoEncerrado(fisica.edicao.dataLimite)) {
      throw new PrazoEncerrado();
    }
    if (grupoDoAluno !== null) {
      throw new JaEmGrupo();
    }
    if (atual.integrantes.length >= fisica.maximoIntegrantes) {
      throw new GrupoCheio(fisica.maximoIntegrantes);
    }
    const turmasDoGrupo = atual.integrantes.map((integrante) => integrante.turmaId);
    if (!turmaCompativel({ multiturma: fisica.multiturma, turmasDoGrupo, turmaDoAluno: turmaId })) {
      throw new TurmaDiferente();
    }

    await tx.inscricao.update({
      where: { alunoId_fisicaId: { alunoId, fisicaId } },
      data: { grupoId, entrouNoGrupoEm: new Date() },
    });

    return paraGrupo(
      await tx.grupo.findUniqueOrThrow({ where: { id: grupoId }, select: selectGrupo }),
    );
  });
}

/** Grupo relido depois do lock, com a configuração da Física que as regras usam. */
const selectGrupoComRegras = {
  ...selectGrupo,
  fisica: {
    select: { minimoIntegrantes: true, maximoIntegrantes: true, multiturma: true },
  },
} satisfies Prisma.GrupoSelect;

type GrupoComRegras = Prisma.GrupoGetPayload<{ select: typeof selectGrupoComRegras }>;

async function grupoDepoisDoLock(tx: Transacao, grupoId: number) {
  const grupo = await tx.grupo.findUnique({
    where: { id: grupoId },
    select: selectGrupoComRegras,
  });
  if (!grupo) {
    throw grupoNaoEncontrado();
  }
  return grupo;
}

/**
 * Núcleo comum de adicionar integrantes (aluno e admin): respeita o máximo de integrantes e,
 * sem multiturma, a turma do grupo. Os novos entram juntos, depois dos atuais.
 * Precisa rodar com a Física já travada.
 */
async function incluirNoGrupo(tx: Transacao, grupo: GrupoComRegras, alunoIds: number[]) {
  const { id: grupoId, fisicaId, fisica, integrantes } = grupo;
  if (integrantes.length + alunoIds.length > fisica.maximoIntegrantes) {
    throw new GrupoCheio(fisica.maximoIntegrantes);
  }
  await validarNovosIntegrantes(tx, fisicaId, alunoIds, {
    turmasDoGrupo: integrantes.map((integrante) => integrante.turmaId),
    multiturma: fisica.multiturma,
  });

  await tx.inscricao.updateMany({
    where: { fisicaId, alunoId: { in: alunoIds } },
    data: { grupoId, entrouNoGrupoEm: new Date() },
  });

  return paraGrupo(
    await tx.grupo.findUniqueOrThrow({ where: { id: grupoId }, select: selectGrupo }),
  );
}

/**
 * Um integrante adiciona colegas ao próprio grupo, até o prazo. Grupo inexistente, de edição
 * inativa, de Física em que ele não está inscrito ou de que ele não é integrante dão o mesmo 404.
 */
export async function adicionarIntegrantesComoAluno(
  deps: DepsDoGrupo,
  alunoId: number,
  grupoId: number,
  { alunos }: AdicionarIntegrantesBody,
): Promise<Grupo> {
  if (alunos.includes(alunoId)) {
    throw new DadosInvalidos(
      'alunos',
      'Não inclua você mesmo: informe só os colegas que vão entrar no grupo.',
    );
  }
  const fisicaId = await fisicaDoGrupo(deps, grupoId);

  return deps.prisma.$transaction(async (tx) => {
    await travarFisica(tx, fisicaId);

    const grupo = await grupoDepoisDoLock(tx, grupoId);
    const inscricao = await inscricaoNaEdicaoAtiva(
      { prisma: tx },
      alunoId,
      fisicaId,
      GRUPO_NAO_ENCONTRADO,
    );
    if (inscricao.grupoId !== grupoId) {
      throw grupoNaoEncontrado();
    }
    if (prazoEncerrado(inscricao.fisica.edicao.dataLimite)) {
      throw new PrazoEncerrado();
    }

    return incluirNoGrupo(tx, grupo, alunos);
  });
}

/**
 * O admin adiciona alunos a qualquer grupo, de qualquer edição e sem prazo (o professor ajusta
 * os grupos depois da data limite). Respeita o máximo de integrantes e a turma, como o aluno.
 */
export async function adicionarIntegrantesComoAdmin(
  deps: DepsDoGrupo,
  grupoId: number,
  { alunos }: AdicionarIntegrantesBody,
): Promise<Grupo> {
  const fisicaId = await fisicaDoGrupo(deps, grupoId);

  return deps.prisma.$transaction(async (tx) => {
    await travarFisica(tx, fisicaId);
    return incluirNoGrupo(tx, await grupoDepoisDoLock(tx, grupoId), alunos);
  });
}

/**
 * O admin tira um aluno do grupo, em qualquer edição e sem prazo. O grupo pode ficar abaixo do
 * mínimo (`formado: false`). Se era o último integrante, o grupo é apagado junto (não existe
 * grupo vazio) e a resposta traz `grupo: null`; o número dele fica livre para o próximo grupo.
 */
export async function removerIntegrante(
  deps: DepsDoGrupo,
  grupoId: number,
  alunoId: number,
): Promise<RemocaoDeIntegrante> {
  const fisicaId = await fisicaDoGrupo(deps, grupoId);

  return deps.prisma.$transaction(async (tx) => {
    await travarFisica(tx, fisicaId);

    const grupo = await grupoDepoisDoLock(tx, grupoId);
    if (!grupo.integrantes.some((integrante) => integrante.aluno.id === alunoId)) {
      throw new NaoEncontrado('Aluno não encontrado neste grupo.');
    }

    // Desvincular antes de apagar: a FK (grupo_id, fisica_id) é ON DELETE RESTRICT.
    await tx.inscricao.update({
      where: { alunoId_fisicaId: { alunoId, fisicaId } },
      data: { grupoId: null, entrouNoGrupoEm: null },
    });
    if (grupo.integrantes.length === 1) {
      await tx.grupo.delete({ where: { id: grupoId } });
      return { grupo: null };
    }

    return {
      grupo: paraGrupo(
        await tx.grupo.findUniqueOrThrow({ where: { id: grupoId }, select: selectGrupo }),
      ),
    };
  });
}
