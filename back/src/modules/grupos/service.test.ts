import { describe, expect, it, vi } from 'vitest';
import { JaEmGrupo, NaoEncontrado } from '../../shared/errors/app-error.js';
import {
  listarColegasDisponiveis,
  listarGruposParaEntrar,
  listarMinhasFisicas,
} from './service.js';

type InscricaoMock = {
  turmaId: number;
  grupoId: number | null;
  fisica: { multiturma: boolean; maximoIntegrantes: number };
};

function inscricao(dados: Partial<InscricaoMock> = {}): InscricaoMock {
  return {
    turmaId: 1,
    grupoId: null,
    fisica: { multiturma: false, maximoIntegrantes: 3 },
    ...dados,
  };
}

/** Grupo como o Prisma devolve com `selectGrupo`. */
function grupoDoBanco(id: number, turmasDosIntegrantes: number[]) {
  return {
    id,
    numero: id,
    fisicaId: 10,
    fisica: { minimoIntegrantes: 2 },
    integrantes: turmasDosIntegrantes.map((turmaId, indice) => ({
      turmaId,
      aluno: { id: 100 + indice, nome: `Aluno ${indice}`, curso: 'GES', matricula: `${indice}` },
      turma: { codigo: turmaId === 1 ? 'A' : 'B' },
    })),
  };
}

type Cenario = {
  edicao?: { id: number; semestre: string; dataLimite: Date } | null;
  inscricaoDoAluno?: InscricaoMock | null;
  grupos?: ReturnType<typeof grupoDoBanco>[];
};

function prismaCom({ edicao = null, inscricaoDoAluno = inscricao(), grupos = [] }: Cenario = {}) {
  const prisma = {
    edicao: { findFirst: vi.fn().mockResolvedValue(edicao) },
    inscricao: {
      findFirst: vi.fn().mockResolvedValue(inscricaoDoAluno),
      findMany: vi.fn().mockResolvedValue([]),
    },
    grupo: { findMany: vi.fn().mockResolvedValue(grupos) },
    $queryRaw: vi.fn().mockResolvedValue([{ aluno_id: 7 }, { aluno_id: 8 }]),
  };
  return { prisma, deps: { prisma: prisma as never } };
}

describe('listarMinhasFisicas', () => {
  it('sem edição ativa, devolve vazio sem buscar inscrições', async () => {
    const { prisma, deps } = prismaCom();

    await expect(listarMinhasFisicas(deps, 1)).resolves.toEqual({ edicao: null, fisicas: [] });
    expect(prisma.inscricao.findMany).not.toHaveBeenCalled();
  });

  it('busca só as inscrições do aluno na edição ativa', async () => {
    const { prisma, deps } = prismaCom({
      edicao: { id: 7, semestre: '2026/1', dataLimite: new Date('2026-06-16T23:59:00Z') },
    });

    await expect(listarMinhasFisicas(deps, 1)).resolves.toEqual({
      edicao: { semestre: '2026/1', dataLimite: '2026-06-16T23:59:00.000Z' },
      fisicas: [],
    });
    expect(prisma.inscricao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { alunoId: 1, fisica: { edicaoId: 7 } } }),
    );
  });
});

describe('listarGruposParaEntrar', () => {
  it('lança NaoEncontrado se o aluno não está inscrito na Física da edição ativa', async () => {
    const { prisma, deps } = prismaCom({ inscricaoDoAluno: null });

    await expect(listarGruposParaEntrar(deps, 1, 10)).rejects.toEqual(
      new NaoEncontrado('Física não encontrada.'),
    );
    expect(prisma.inscricao.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { alunoId: 1, fisicaId: 10, fisica: { edicao: { ativa: true } } },
      }),
    );
  });

  it('lança JaEmGrupo sem buscar grupos se o aluno já tem grupo', async () => {
    const { prisma, deps } = prismaCom({ inscricaoDoAluno: inscricao({ grupoId: 5 }) });

    await expect(listarGruposParaEntrar(deps, 1, 10)).rejects.toBeInstanceOf(JaEmGrupo);
    expect(prisma.grupo.findMany).not.toHaveBeenCalled();
  });

  it('tira os grupos cheios e os de outra turma (sem multiturma)', async () => {
    const { deps } = prismaCom({
      grupos: [grupoDoBanco(1, [1]), grupoDoBanco(2, [1, 1, 1]), grupoDoBanco(3, [2])],
    });

    const grupos = await listarGruposParaEntrar(deps, 1, 10);

    expect(grupos.map((grupo) => grupo.id)).toEqual([1]);
    expect(grupos[0]).toEqual({
      id: 1,
      numero: 1,
      fisicaId: 10,
      formado: false,
      integrantes: [{ id: 100, nome: 'Aluno 0', curso: 'GES', matricula: '0', turma: 'A' }],
    });
  });

  it('com multiturma, mantém grupos de outra turma', async () => {
    const { deps } = prismaCom({
      inscricaoDoAluno: inscricao({ fisica: { multiturma: true, maximoIntegrantes: 3 } }),
      grupos: [grupoDoBanco(3, [2])],
    });

    const grupos = await listarGruposParaEntrar(deps, 1, 10);

    expect(grupos.map((grupo) => grupo.id)).toEqual([3]);
  });
});

describe('listarColegasDisponiveis', () => {
  function filtroUsado(prisma: ReturnType<typeof prismaCom>['prisma']) {
    const [argumentos] = prisma.inscricao.findMany.mock.calls[0] as [{ where: unknown }];
    return argumentos.where;
  }

  it('sem multiturma, filtra pela turma do aluno; sem busca, não consulta o SQL', async () => {
    const { prisma, deps } = prismaCom();

    await listarColegasDisponiveis(deps, 1, 10);

    expect(filtroUsado(prisma)).toEqual({
      fisicaId: 10,
      grupoId: null,
      alunoId: { not: 1, in: undefined },
      turmaId: 1,
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('com multiturma, não filtra a turma; a busca restringe aos alunos encontrados', async () => {
    const { prisma, deps } = prismaCom({
      inscricaoDoAluno: inscricao({ fisica: { multiturma: true, maximoIntegrantes: 3 } }),
    });

    await listarColegasDisponiveis(deps, 1, 10, 'silva');

    expect(filtroUsado(prisma)).toMatchObject({
      turmaId: undefined,
      alunoId: { not: 1, in: [7, 8] },
    });
  });

  it('a busca vai como parâmetro do SQL, com os curingas do LIKE escapados', async () => {
    const { prisma, deps } = prismaCom();

    await listarColegasDisponiveis(deps, 1, 10, '50%');

    const [, ...parametros] = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(parametros).toEqual([10, '%50\\%%', '%50\\%%']);
  });

  it('lista colegas mesmo se o aluno já tem grupo (para adicioná-los a ele)', async () => {
    const { prisma, deps } = prismaCom({ inscricaoDoAluno: inscricao({ grupoId: 5 }) });

    await listarColegasDisponiveis(deps, 1, 10);

    expect(prisma.inscricao.findMany).toHaveBeenCalledOnce();
  });
});
