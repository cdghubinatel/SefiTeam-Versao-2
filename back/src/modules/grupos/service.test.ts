import { describe, expect, it, vi } from 'vitest';
import {
  GrupoCheio,
  JaEmGrupo,
  LimiteDeGrupos,
  NaoEncontrado,
  PrazoEncerrado,
  TurmaDiferente,
} from '../../shared/errors/app-error.js';
import {
  criarGrupo,
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

describe('criarGrupo', () => {
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);

  type Opcoes = {
    multiturma?: boolean;
    maximoIntegrantes?: number;
    quantidadeGrupos?: number;
    dataLimite?: Date;
    meuGrupoId?: number | null;
    colegasNoBanco?: readonly {
      turmaId: number;
      grupoId: number | null;
      aluno: { nome: string };
    }[];
    numerosExistentes?: readonly number[];
  };

  /** Prisma cujo `$transaction` executa o callback com um `tx` mockado. */
  function transacao({
    multiturma = false,
    maximoIntegrantes = 3,
    quantidadeGrupos = 5,
    dataLimite = amanha,
    meuGrupoId = null,
    colegasNoBanco = [],
    numerosExistentes = [],
  }: Opcoes = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      inscricao: {
        findFirst: vi.fn().mockResolvedValue({
          turmaId: 1,
          grupoId: meuGrupoId,
          fisica: { multiturma, maximoIntegrantes, quantidadeGrupos, edicao: { dataLimite } },
        }),
        findMany: vi.fn().mockResolvedValue(colegasNoBanco),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      grupo: {
        findMany: vi.fn().mockResolvedValue(numerosExistentes.map((numero) => ({ numero }))),
        create: vi.fn().mockResolvedValue({ id: 50 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(grupoDoBanco(50, [1])),
      },
    };
    const $transaction = vi.fn((callback: (cliente: typeof tx) => unknown) => callback(tx));
    return { tx, $transaction, deps: { prisma: { $transaction } as never } };
  }

  function colega(nome: string, dados: { turmaId?: number; grupoId?: number | null } = {}) {
    return { turmaId: dados.turmaId ?? 1, grupoId: dados.grupoId ?? null, aluno: { nome } };
  }

  it('recusa o próprio aluno na lista de colegas, sem abrir transação', async () => {
    const { $transaction, deps } = transacao();

    await expect(criarGrupo(deps, 1, 10, { colegas: [7, 1] })).rejects.toMatchObject({
      statusCode: 400,
      codigo: 'VALIDACAO',
      detalhes: [{ campo: 'colegas', mensagem: expect.any(String) as string }],
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('trava a Física antes de ler qualquer coisa', async () => {
    const { tx, deps } = transacao();

    await criarGrupo(deps, 1, 10, { colegas: [] });

    const [primeiraLeitura] = tx.inscricao.findFirst.mock.invocationCallOrder;
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(primeiraLeitura!);
    const [sql, fisicaId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, number];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(fisicaId).toBe(10);
  });

  it('cria com o menor número livre, autor = quem cria, e põe todos no grupo', async () => {
    const { tx, deps } = transacao({
      numerosExistentes: [1, 3],
      colegasNoBanco: [colega('Ana'), colega('Bia')],
    });

    await expect(criarGrupo(deps, 1, 10, { colegas: [7, 8] })).resolves.toMatchObject({
      id: 50,
    });

    expect(tx.grupo.create).toHaveBeenCalledWith({
      data: { fisicaId: 10, numero: 2, criadoPorId: 1 },
      select: { id: true },
    });
    expect(tx.inscricao.updateMany).toHaveBeenCalledWith({
      where: { fisicaId: 10, alunoId: { in: [1, 7, 8] } },
      data: { grupoId: 50, entrouNoGrupoEm: expect.any(Date) as Date },
    });
  });

  it('sozinho, não consulta colegas', async () => {
    const { tx, deps } = transacao();

    await criarGrupo(deps, 1, 10, { colegas: [] });

    expect(tx.inscricao.findMany).not.toHaveBeenCalled();
  });

  it('com multiturma, aceita colega de outra turma', async () => {
    const { tx, deps } = transacao({
      multiturma: true,
      colegasNoBanco: [colega('Daniel', { turmaId: 2 })],
    });

    await criarGrupo(deps, 1, 10, { colegas: [7] });

    expect(tx.grupo.create).toHaveBeenCalled();
  });

  it.each([
    ['prazo encerrado', { dataLimite: new Date(Date.now() - 1000) }, [], PrazoEncerrado],
    ['quem cria já tem grupo', { meuGrupoId: 9 }, [], JaEmGrupo],
    ['colegas além do máximo', { maximoIntegrantes: 2 }, [7, 8], GrupoCheio],
    [
      'a Física já tem todos os grupos',
      { quantidadeGrupos: 2, numerosExistentes: [1, 2] },
      [],
      LimiteDeGrupos,
    ],
    ['colega não inscrito', { colegasNoBanco: [colega('Ana')] }, [7, 8], NaoEncontrado],
    ['colega já tem grupo', { colegasNoBanco: [colega('Ana', { grupoId: 4 })] }, [7], JaEmGrupo],
    [
      'colega de outra turma',
      { colegasNoBanco: [colega('Daniel', { turmaId: 2 })] },
      [7],
      TurmaDiferente,
    ],
  ] as const)('lança erro quando %s, sem criar nada', async (_caso, opcoes, colegas, Erro) => {
    const { tx, deps } = transacao(opcoes);

    await expect(criarGrupo(deps, 1, 10, { colegas: [...colegas] })).rejects.toBeInstanceOf(Erro);
    expect(tx.grupo.create).not.toHaveBeenCalled();
    expect(tx.inscricao.updateMany).not.toHaveBeenCalled();
  });

  it('a mensagem de colega com grupo traz o nome dele', async () => {
    const { deps } = transacao({ colegasNoBanco: [colega('Ana', { grupoId: 4 })] });

    await expect(criarGrupo(deps, 1, 10, { colegas: [7] })).rejects.toThrow(
      'Ana já está em um grupo nesta Física.',
    );
  });
});
