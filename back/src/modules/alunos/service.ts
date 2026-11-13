import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { ehValorRepetido, escaparLike } from '../../lib/prisma.js';
import {
  AlunoEmGrupo,
  DadosInvalidos,
  FisicaLotada,
  JaInscrito,
  LoginExistente,
  NaoEncontrado,
} from '../../shared/errors/app-error.js';
import { hashDaSenhaDoAluno, loginDoAluno, senhaDoAluno } from '../auth/service.js';
import { travarFisica } from '../grupos/service.js';
import { statusDoAluno } from './regras.js';
import type { AlunoBody, AlunoDaEdicao, AlunosDaEdicao, AlunosDaEdicaoQuery } from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'edicao' | 'fisica' | 'inscricao' | '$queryRaw'> };
type DepsComTransacao = { prisma: Pick<PrismaClient, '$transaction' | 'inscricao'> };
type Transacao = Prisma.TransactionClient;

/** Inscrição → linha da lista (o aluno numa Física). */
const selectLinha = {
  aluno: { select: { id: true, nome: true, curso: true, matricula: true } },
  fisica: { select: { id: true, codigo: true, minimoIntegrantes: true } },
  turma: { select: { codigo: true } },
  grupo: { select: { id: true, numero: true, _count: { select: { integrantes: true } } } },
} satisfies Prisma.InscricaoSelect;

function paraLinha({
  aluno,
  fisica,
  turma,
  grupo,
}: Prisma.InscricaoGetPayload<{ select: typeof selectLinha }>): AlunoDaEdicao {
  return {
    ...aluno,
    fisica: { id: fisica.id, codigo: fisica.codigo },
    turma: turma.codigo,
    grupo: grupo && { id: grupo.id, numero: grupo.numero },
    status: statusDoAluno(grupo?._count.integrantes ?? null, fisica.minimoIntegrantes),
  };
}

/** A edição atual das telas do admin: a última criada, ativa ou não. */
function ultimaEdicao(prisma: Pick<PrismaClient, 'edicao'>) {
  return prisma.edicao.findFirst({
    select: { id: true, semestre: true, dataLimite: true, ativa: true },
    orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
  });
}

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
  const edicao = await ultimaEdicao(prisma);
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
  const alunos = (
    await prisma.inscricao.findMany({
      where: {
        fisica: { edicaoId: edicao.id },
        fisicaId,
        alunoId: alunoIds && { in: alunoIds },
      },
      select: selectLinha,
      orderBy: [
        { aluno: { nome: 'asc' } },
        { aluno: { id: 'asc' } },
        { fisica: { codigo: 'asc' } },
      ],
    })
  ).map(paraLinha);

  return {
    edicao: { ...edicao, dataLimite: edicao.dataLimite.toISOString() },
    fisicas: fisicas.map(({ turmas, ...fisica }) => ({
      ...fisica,
      turmas: turmas.map((turma) => turma.codigo),
    })),
    alunos: status === undefined ? alunos : alunos.filter((aluno) => aluno.status === status),
  };
}

/**
 * Física da edição atual (a última criada), com as turmas. Física inexistente ou de outra
 * edição dão 404: adicionar e editar só valem na edição que a tela mostra.
 */
async function fisicaDaEdicaoAtual(tx: Transacao, fisicaId: number) {
  const edicao = await ultimaEdicao(tx);
  const fisica =
    edicao &&
    (await tx.fisica.findFirst({
      where: { id: fisicaId, edicaoId: edicao.id },
      select: {
        codigo: true,
        quantidadeGrupos: true,
        maximoIntegrantes: true,
        turmas: { select: { id: true, codigo: true }, orderBy: { codigo: 'asc' } },
      },
    }));
  if (!fisica) {
    throw new NaoEncontrado('Física não encontrada.');
  }
  return fisica;
}

/** Id da turma da Física com esse código; turma que não existe é erro de validação. */
function turmaDaFisica(
  fisica: Awaited<ReturnType<typeof fisicaDaEdicaoAtual>>,
  codigo: string,
): number {
  const turma = fisica.turmas.find((t) => t.codigo === codigo);
  if (!turma) {
    const validas = fisica.turmas.map((t) => t.codigo).join(', ');
    throw new DadosInvalidos(
      'turma',
      `A Física ${fisica.codigo} não tem a turma ${codigo}. Turmas: ${validas}.`,
    );
  }
  return turma.id;
}

/**
 * Linha do aluno na Física, lida depois do commit (fora da transação): dentro dela, o Prisma
 * carrega as várias relações da linha em paralelo na mesma conexão, o que o driver `pg` avisa
 * que deixa de aceitar na versão 9.
 */
async function linhaDoAluno(
  prisma: Pick<PrismaClient, 'inscricao'>,
  alunoId: number,
  fisicaId: number,
) {
  return paraLinha(
    await prisma.inscricao.findUniqueOrThrow({
      where: { alunoId_fisicaId: { alunoId, fisicaId } },
      select: selectLinha,
    }),
  );
}

/**
 * O admin adiciona um aluno a uma Física da edição atual, fora da planilha. Mesmas regras da
 * planilha: o aluno é identificado por curso + matrícula, e um cadastro existente (de outra
 * Física ou edição) é reaproveitado, com o nome e a senha atualizados, sem deslogar. A turma
 * precisa existir na Física, e o aluno precisa caber (grupos × máximo). Física travada, para a
 * contagem de inscritos não ficar desatualizada. Ver docs/alunos.md.
 */
export async function adicionarAluno(
  { prisma }: DepsComTransacao,
  fisicaId: number,
  dados: AlunoBody,
): Promise<AlunoDaEdicao> {
  const login = loginDoAluno(dados);
  // Fora da transação: é a parte lenta, e não depende do banco.
  const senhaHash = await hashDaSenhaDoAluno(senhaDoAluno(dados));

  const adicionar = () =>
    prisma.$transaction(async (tx) => {
      await travarFisica(tx, fisicaId);
      const fisica = await fisicaDaEdicaoAtual(tx, fisicaId);
      const turmaId = turmaDaFisica(fisica, dados.turma);

      const existente = await tx.usuario.findUnique({
        where: { login },
        select: { id: true, nome: true, papel: true },
      });
      if (existente?.papel === 'ADMIN') {
        throw new DadosInvalidos('matricula', `${login} é o login de um administrador.`);
      }
      if (existente) {
        const inscricao = await tx.inscricao.findUnique({
          where: { alunoId_fisicaId: { alunoId: existente.id, fisicaId } },
          select: { id: true },
        });
        if (inscricao) {
          throw new JaInscrito();
        }
      }

      const inscritos = await tx.inscricao.count({ where: { fisicaId } });
      if (inscritos >= fisica.quantidadeGrupos * fisica.maximoIntegrantes) {
        throw new FisicaLotada(fisica.quantidadeGrupos, fisica.maximoIntegrantes);
      }

      const alunoId = existente
        ? existente.id
        : (
            await tx.usuario.create({
              data: { ...cadastro(dados), login, senhaHash, papel: 'ALUNO' },
              select: { id: true },
            })
          ).id;
      if (existente && existente.nome !== dados.nome) {
        await tx.usuario.update({ where: { id: alunoId }, data: { nome: dados.nome, senhaHash } });
      }
      await tx.inscricao.create({ data: { alunoId, fisicaId, turmaId } });
      return alunoId;
    });

  let alunoId: number;
  try {
    alunoId = await adicionar();
  } catch (erro) {
    // O mesmo aluno novo adicionado em outra Física ao mesmo tempo: as duas transações viram
    // que o cadastro não existia (cada uma trava só a própria Física), e a segunda bateu no
    // login repetido. Repetir uma vez basta: agora o cadastro existe e é reaproveitado.
    if (!ehValorRepetido(erro)) {
      throw erro;
    }
    alunoId = await adicionar();
  }
  return linhaDoAluno(prisma, alunoId, fisicaId);
}

function cadastro({ nome, curso, matricula }: AlunoBody) {
  return { nome, curso, matricula };
}

/**
 * O admin edita o aluno numa Física da edição atual. Nome, curso e matrícula são do cadastro
 * (valem em todas as Físicas e edições): o nome define a senha, e curso + matrícula, o login; o
 * aluno não é deslogado. A turma é só desta Física e não muda enquanto ele estiver num grupo
 * (sem multiturma, o grupo ficaria com turmas misturadas). Ver docs/alunos.md.
 */
export async function editarAluno(
  { prisma }: DepsComTransacao,
  fisicaId: number,
  alunoId: number,
  dados: AlunoBody,
): Promise<AlunoDaEdicao> {
  const login = loginDoAluno(dados);
  const senhaHash = await hashDaSenhaDoAluno(senhaDoAluno(dados));

  try {
    await prisma.$transaction(async (tx) => {
      await travarFisica(tx, fisicaId);
      const fisica = await fisicaDaEdicaoAtual(tx, fisicaId);
      const inscricao = await tx.inscricao.findUnique({
        where: { alunoId_fisicaId: { alunoId, fisicaId } },
        select: {
          turmaId: true,
          grupoId: true,
          aluno: { select: { login: true, nome: true, curso: true, matricula: true } },
        },
      });
      if (!inscricao) {
        throw new NaoEncontrado('Aluno não encontrado nesta Física.');
      }
      const turmaId = turmaDaFisica(fisica, dados.turma);
      if (turmaId !== inscricao.turmaId && inscricao.grupoId !== null) {
        throw new AlunoEmGrupo();
      }

      const { aluno } = inscricao;
      if (login !== aluno.login) {
        const outro = await tx.usuario.findUnique({ where: { login }, select: { id: true } });
        if (outro) {
          throw new LoginExistente(login);
        }
      }

      const nomeMudou = dados.nome !== aluno.nome;
      if (
        nomeMudou ||
        login !== aluno.login ||
        dados.curso !== aluno.curso ||
        dados.matricula !== aluno.matricula
      ) {
        await tx.usuario.update({
          where: { id: alunoId },
          data: { ...cadastro(dados), login, ...(nomeMudou && { senhaHash }) },
        });
      }
      if (turmaId !== inscricao.turmaId) {
        await tx.inscricao.update({
          where: { alunoId_fisicaId: { alunoId, fisicaId } },
          data: { turmaId },
        });
      }
    });
  } catch (erro) {
    // Outro cadastro gravou o mesmo login depois da checagem acima (ex.: duas edições ao mesmo
    // tempo em Físicas diferentes, que não compartilham o lock).
    if (ehValorRepetido(erro)) {
      throw new LoginExistente(login);
    }
    throw erro;
  }
  return linhaDoAluno(prisma, alunoId, fisicaId);
}
