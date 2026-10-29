import { describe, expect, it, vi } from 'vitest';
import {
  GrupoCheio,
  GrupoIncompleto,
  JaEmGrupo,
  LimiteDeGrupos,
  NaoEncontrado,
  PrazoEncerrado,
  TurmaDiferente,
} from '../../shared/errors/app-error.js';
import {
  adicionarIntegrantesComoAdmin,
  adicionarIntegrantesComoAluno,
  criarGrupo,
  criarGrupoComoAdmin,
  entrarNoGrupo,
  listarAlunosSemGrupo,
  listarColegasDisponiveis,
  listarGruposDaEdicao,
  listarGruposParaEntrar,
  listarMinhasFisicas,
  removerIntegrante,
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
function grupoDoBanco(id: number, turmasDosIntegrantes: readonly number[]) {
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
    minimoIntegrantes?: number;
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
    minimoIntegrantes = 1,
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
          fisica: {
            multiturma,
            minimoIntegrantes,
            maximoIntegrantes,
            quantidadeGrupos,
            edicao: { dataLimite },
          },
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
    ['sozinho abaixo do mínimo', { minimoIntegrantes: 2 }, [], GrupoIncompleto],
    [
      'com colegas, ainda abaixo do mínimo',
      { minimoIntegrantes: 3, colegasNoBanco: [colega('Ana')] },
      [7],
      GrupoIncompleto,
    ],
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

describe('entrarNoGrupo', () => {
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);

  type Opcoes = {
    existeAntes?: boolean;
    existeDepoisDoLock?: boolean;
    turmasDosIntegrantes?: readonly number[];
    inscricaoDoAluno?: object | null;
  };

  function inscricaoNaFisica(
    dados: {
      grupoId?: number | null;
      multiturma?: boolean;
      maximo?: number;
      dataLimite?: Date;
    } = {},
  ) {
    return {
      turmaId: 1,
      grupoId: dados.grupoId ?? null,
      fisica: {
        multiturma: dados.multiturma ?? false,
        maximoIntegrantes: dados.maximo ?? 3,
        quantidadeGrupos: 5,
        edicao: { dataLimite: dados.dataLimite ?? amanha },
      },
    };
  }

  /** Prisma com a leitura fora da transação e um `tx` mockado dentro dela. */
  function prismaDoGrupo({
    existeAntes = true,
    existeDepoisDoLock = true,
    turmasDosIntegrantes = [1],
    inscricaoDoAluno = inscricaoNaFisica(),
  }: Opcoes = {}) {
    const grupoAtual = grupoDoBanco(20, turmasDosIntegrantes);
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      grupo: {
        findUnique: vi.fn().mockResolvedValue(existeDepoisDoLock ? grupoAtual : null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(grupoAtual),
      },
      inscricao: {
        findFirst: vi.fn().mockResolvedValue(inscricaoDoAluno),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const $transaction = vi.fn((callback: (cliente: typeof tx) => unknown) => callback(tx));
    const prisma = {
      grupo: { findUnique: vi.fn().mockResolvedValue(existeAntes ? { fisicaId: 10 } : null) },
      $transaction,
    };
    return { tx, $transaction, deps: { prisma: prisma as never } };
  }

  it('trava a Física do grupo antes de reler o grupo e a inscrição', async () => {
    const { tx, deps } = prismaDoGrupo();

    await entrarNoGrupo(deps, 1, 20);

    const [, fisicaId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, number];
    expect(fisicaId).toBe(10);
    const ordemDoLock = tx.$queryRaw.mock.invocationCallOrder[0]!;
    expect(ordemDoLock).toBeLessThan(tx.grupo.findUnique.mock.invocationCallOrder[0]!);
    expect(ordemDoLock).toBeLessThan(tx.inscricao.findFirst.mock.invocationCallOrder[0]!);
  });

  it('grava o grupo e a data de entrada na inscrição do aluno', async () => {
    const { tx, deps } = prismaDoGrupo();

    await expect(entrarNoGrupo(deps, 1, 20)).resolves.toMatchObject({ id: 20 });

    expect(tx.inscricao.update).toHaveBeenCalledWith({
      where: { alunoId_fisicaId: { alunoId: 1, fisicaId: 10 } },
      data: { grupoId: 20, entrouNoGrupoEm: expect.any(Date) as Date },
    });
  });

  it('lança NaoEncontrado sem abrir transação se o grupo não existe', async () => {
    const { $transaction, deps } = prismaDoGrupo({ existeAntes: false });

    await expect(entrarNoGrupo(deps, 1, 20)).rejects.toEqual(
      new NaoEncontrado('Grupo não encontrado.'),
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it('lança NaoEncontrado se o grupo some enquanto espera o lock', async () => {
    const { tx, deps } = prismaDoGrupo({ existeDepoisDoLock: false });

    await expect(entrarNoGrupo(deps, 1, 20)).rejects.toBeInstanceOf(NaoEncontrado);
    expect(tx.inscricao.update).not.toHaveBeenCalled();
  });

  it('com multiturma, entra num grupo de outra turma', async () => {
    const { tx, deps } = prismaDoGrupo({
      turmasDosIntegrantes: [2],
      inscricaoDoAluno: inscricaoNaFisica({ multiturma: true }),
    });

    await entrarNoGrupo(deps, 1, 20);

    expect(tx.inscricao.update).toHaveBeenCalled();
  });

  it.each([
    ['aluno não inscrito ou edição inativa', { inscricaoDoAluno: null }, NaoEncontrado],
    [
      'prazo encerrado',
      { inscricaoDoAluno: inscricaoNaFisica({ dataLimite: new Date(Date.now() - 1000) }) },
      PrazoEncerrado,
    ],
    ['aluno já tem grupo', { inscricaoDoAluno: inscricaoNaFisica({ grupoId: 7 }) }, JaEmGrupo],
    ['grupo cheio', { turmasDosIntegrantes: [1, 1, 1] }, GrupoCheio],
    ['grupo de outra turma', { turmasDosIntegrantes: [2] }, TurmaDiferente],
  ] as const)('lança erro quando %s, sem gravar nada', async (_caso, opcoes, Erro) => {
    const { tx, deps } = prismaDoGrupo(opcoes);

    await expect(entrarNoGrupo(deps, 1, 20)).rejects.toBeInstanceOf(Erro);
    expect(tx.inscricao.update).not.toHaveBeenCalled();
  });

  it('o 404 de inscrição usa a mensagem de grupo, não a de Física', async () => {
    const { deps } = prismaDoGrupo({ inscricaoDoAluno: null });

    await expect(entrarNoGrupo(deps, 1, 20)).rejects.toThrow('Grupo não encontrado.');
  });
});

describe('adicionarIntegrantes', () => {
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);

  type NovoNoBanco = { turmaId: number; grupoId: number | null; aluno: { nome: string } };

  type Opcoes = {
    existeAntes?: boolean;
    existeDepoisDoLock?: boolean;
    turmasDosIntegrantes?: readonly number[];
    multiturma?: boolean;
    maximoIntegrantes?: number;
    /** Inscrição de quem adiciona (aluno) na edição ativa; `null` = não inscrito / edição inativa. */
    minhaInscricao?: { grupoId: number | null; dataLimite?: Date } | null;
    novosNoBanco?: readonly NovoNoBanco[];
  };

  function novo(nome: string, dados: { turmaId?: number; grupoId?: number | null } = {}) {
    return { turmaId: dados.turmaId ?? 1, grupoId: dados.grupoId ?? null, aluno: { nome } };
  }

  /** Prisma com a leitura fora da transação e um `tx` mockado dentro dela; o grupo é o 20. */
  function prismaDoGrupo({
    existeAntes = true,
    existeDepoisDoLock = true,
    turmasDosIntegrantes = [1],
    multiturma = false,
    maximoIntegrantes = 3,
    minhaInscricao = { grupoId: 20 },
    novosNoBanco = [novo('Ana')],
  }: Opcoes = {}) {
    const grupoAtual = {
      ...grupoDoBanco(20, turmasDosIntegrantes),
      fisica: { minimoIntegrantes: 2, maximoIntegrantes, multiturma },
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      grupo: {
        findUnique: vi.fn().mockResolvedValue(existeDepoisDoLock ? grupoAtual : null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(grupoAtual),
      },
      inscricao: {
        findFirst: vi.fn().mockResolvedValue(
          minhaInscricao && {
            turmaId: 1,
            grupoId: minhaInscricao.grupoId,
            fisica: { edicao: { dataLimite: minhaInscricao.dataLimite ?? amanha } },
          },
        ),
        findMany: vi.fn().mockResolvedValue(novosNoBanco),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const $transaction = vi.fn((callback: (cliente: typeof tx) => unknown) => callback(tx));
    const prisma = {
      grupo: { findUnique: vi.fn().mockResolvedValue(existeAntes ? { fisicaId: 10 } : null) },
      $transaction,
    };
    return { tx, $transaction, deps: { prisma: prisma as never } };
  }

  describe('como aluno', () => {
    it('recusa o próprio id na lista, sem abrir transação', async () => {
      const { $transaction, deps } = prismaDoGrupo();

      await expect(
        adicionarIntegrantesComoAluno(deps, 1, 20, { alunos: [7, 1] }),
      ).rejects.toMatchObject({
        statusCode: 400,
        codigo: 'VALIDACAO',
        detalhes: [{ campo: 'alunos', mensagem: expect.any(String) as string }],
      });
      expect($transaction).not.toHaveBeenCalled();
    });

    it('trava a Física do grupo antes de reler o grupo e a inscrição', async () => {
      const { tx, deps } = prismaDoGrupo();

      await adicionarIntegrantesComoAluno(deps, 1, 20, { alunos: [7] });

      const [, fisicaId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, number];
      expect(fisicaId).toBe(10);
      const ordemDoLock = tx.$queryRaw.mock.invocationCallOrder[0]!;
      expect(ordemDoLock).toBeLessThan(tx.grupo.findUnique.mock.invocationCallOrder[0]!);
      expect(ordemDoLock).toBeLessThan(tx.inscricao.findFirst.mock.invocationCallOrder[0]!);
    });

    it('só procura a inscrição de quem adiciona na edição ativa', async () => {
      const { tx, deps } = prismaDoGrupo();

      await adicionarIntegrantesComoAluno(deps, 1, 20, { alunos: [7] });

      expect(tx.inscricao.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { alunoId: 1, fisicaId: 10, fisica: { edicao: { ativa: true } } },
        }),
      );
    });

    it('põe os novos no grupo, todos com a mesma data de entrada', async () => {
      const { tx, deps } = prismaDoGrupo({ novosNoBanco: [novo('Ana'), novo('Bia')] });

      await expect(
        adicionarIntegrantesComoAluno(deps, 1, 20, { alunos: [7, 8] }),
      ).resolves.toMatchObject({ id: 20 });

      expect(tx.inscricao.updateMany).toHaveBeenCalledWith({
        where: { fisicaId: 10, alunoId: { in: [7, 8] } },
        data: { grupoId: 20, entrouNoGrupoEm: expect.any(Date) as Date },
      });
    });

    it.each([
      ['o grupo some enquanto espera o lock', { existeDepoisDoLock: false }, NaoEncontrado],
      ['o aluno não está inscrito ou a edição é inativa', { minhaInscricao: null }, NaoEncontrado],
      ['o aluno não tem grupo', { minhaInscricao: { grupoId: null } }, NaoEncontrado],
      ['o aluno é de outro grupo', { minhaInscricao: { grupoId: 21 } }, NaoEncontrado],
      [
        'o prazo terminou',
        { minhaInscricao: { grupoId: 20, dataLimite: new Date(Date.now() - 1000) } },
        PrazoEncerrado,
      ],
    ] as const)('lança erro quando %s, sem gravar nada', async (_caso, opcoes, Erro) => {
      const { tx, deps } = prismaDoGrupo(opcoes);

      await expect(
        adicionarIntegrantesComoAluno(deps, 1, 20, { alunos: [7] }),
      ).rejects.toBeInstanceOf(Erro);
      expect(tx.inscricao.updateMany).not.toHaveBeenCalled();
    });

    it('quem não é integrante recebe a mesma mensagem de grupo inexistente', async () => {
      const { deps } = prismaDoGrupo({ minhaInscricao: { grupoId: 21 } });

      await expect(adicionarIntegrantesComoAluno(deps, 1, 20, { alunos: [7] })).rejects.toEqual(
        new NaoEncontrado('Grupo não encontrado.'),
      );
    });
  });

  describe('como admin', () => {
    it('não exige inscrição, edição ativa nem prazo', async () => {
      const { tx, deps } = prismaDoGrupo({ minhaInscricao: null });

      await adicionarIntegrantesComoAdmin(deps, 20, { alunos: [7] });

      expect(tx.inscricao.findFirst).not.toHaveBeenCalled();
      expect(tx.inscricao.updateMany).toHaveBeenCalled();
    });

    it('trava a Física antes de reler o grupo', async () => {
      const { tx, deps } = prismaDoGrupo();

      await adicionarIntegrantesComoAdmin(deps, 20, { alunos: [7] });

      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.grupo.findUnique.mock.invocationCallOrder[0]!,
      );
    });

    it('lança NaoEncontrado sem abrir transação se o grupo não existe', async () => {
      const { $transaction, deps } = prismaDoGrupo({ existeAntes: false });

      await expect(adicionarIntegrantesComoAdmin(deps, 20, { alunos: [7] })).rejects.toEqual(
        new NaoEncontrado('Grupo não encontrado.'),
      );
      expect($transaction).not.toHaveBeenCalled();
    });
  });

  describe('regras comuns (aluno e admin)', () => {
    type DepsDoGrupo = Parameters<typeof adicionarIntegrantesComoAdmin>[0];
    const papeis = [
      [
        'aluno',
        (deps: DepsDoGrupo, alunos: number[]) =>
          adicionarIntegrantesComoAluno(deps, 1, 20, { alunos }),
      ],
      [
        'admin',
        (deps: DepsDoGrupo, alunos: number[]) =>
          adicionarIntegrantesComoAdmin(deps, 20, { alunos }),
      ],
    ] as const;

    describe.each(papeis)('como %s', (_papel, adicionar) => {
      it.each([
        ['os novos passam do máximo', { turmasDosIntegrantes: [1, 1] }, [7, 8], GrupoCheio],
        [
          'um novo não está inscrito na Física',
          { novosNoBanco: [novo('Ana')] },
          [7, 8],
          NaoEncontrado,
        ],
        ['um novo já tem grupo', { novosNoBanco: [novo('Ana', { grupoId: 4 })] }, [7], JaEmGrupo],
        [
          'um novo é de outra turma (sem multiturma)',
          { novosNoBanco: [novo('Daniel', { turmaId: 2 })] },
          [7],
          TurmaDiferente,
        ],
      ] as const)('lança erro quando %s, sem gravar nada', async (_caso, opcoes, alunos, Erro) => {
        const { tx, deps } = prismaDoGrupo(opcoes);

        await expect(adicionar(deps, [...alunos])).rejects.toBeInstanceOf(Erro);
        expect(tx.inscricao.updateMany).not.toHaveBeenCalled();
      });

      it('enche até exatamente o máximo', async () => {
        const { tx, deps } = prismaDoGrupo({ turmasDosIntegrantes: [1, 1] });

        await adicionar(deps, [7]);

        expect(tx.inscricao.updateMany).toHaveBeenCalled();
      });

      it('com multiturma, aceita aluno de outra turma', async () => {
        const { tx, deps } = prismaDoGrupo({
          multiturma: true,
          novosNoBanco: [novo('Daniel', { turmaId: 2 })],
        });

        await adicionar(deps, [7]);

        expect(tx.inscricao.updateMany).toHaveBeenCalled();
      });
    });

    it('compara a turma do novo com as turmas do grupo', async () => {
      const { tx, deps } = prismaDoGrupo({
        turmasDosIntegrantes: [2],
        novosNoBanco: [novo('Daniel', { turmaId: 2 })],
      });

      await adicionarIntegrantesComoAdmin(deps, 20, { alunos: [7] });

      expect(tx.inscricao.updateMany).toHaveBeenCalled();
    });
  });
});

describe('removerIntegrante', () => {
  type Opcoes = {
    existeAntes?: boolean;
    existeDepoisDoLock?: boolean;
    /** Turmas dos integrantes; os ids de aluno são 100, 101, ... (ver `grupoDoBanco`). */
    turmasDosIntegrantes?: readonly number[];
  };

  /** Prisma com a leitura fora da transação e um `tx` mockado dentro dela; o grupo é o 20. */
  function prismaDoGrupo({
    existeAntes = true,
    existeDepoisDoLock = true,
    turmasDosIntegrantes = [1, 1],
  }: Opcoes = {}) {
    const grupoAtual = {
      ...grupoDoBanco(20, turmasDosIntegrantes),
      fisica: { minimoIntegrantes: 2, maximoIntegrantes: 3, multiturma: false },
    };
    const depoisDaRemocao = grupoDoBanco(20, turmasDosIntegrantes.slice(1));
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      grupo: {
        findUnique: vi.fn().mockResolvedValue(existeDepoisDoLock ? grupoAtual : null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(depoisDaRemocao),
        delete: vi.fn().mockResolvedValue({}),
      },
      inscricao: { update: vi.fn().mockResolvedValue({}) },
    };
    const $transaction = vi.fn((callback: (cliente: typeof tx) => unknown) => callback(tx));
    const prisma = {
      grupo: { findUnique: vi.fn().mockResolvedValue(existeAntes ? { fisicaId: 10 } : null) },
      $transaction,
    };
    return { tx, $transaction, deps: { prisma: prisma as never } };
  }

  it('trava a Física do grupo antes de reler o grupo', async () => {
    const { tx, deps } = prismaDoGrupo();

    await removerIntegrante(deps, 20, 100);

    const [, fisicaId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, number];
    expect(fisicaId).toBe(10);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.grupo.findUnique.mock.invocationCallOrder[0]!,
    );
  });

  it('tira o aluno do grupo e devolve o grupo sem ele', async () => {
    const { tx, deps } = prismaDoGrupo();

    const { grupo } = await removerIntegrante(deps, 20, 100);

    expect(tx.inscricao.update).toHaveBeenCalledWith({
      where: { alunoId_fisicaId: { alunoId: 100, fisicaId: 10 } },
      data: { grupoId: null, entrouNoGrupoEm: null },
    });
    expect(tx.grupo.delete).not.toHaveBeenCalled();
    expect(grupo).toMatchObject({ id: 20, formado: false, integrantes: [{ id: 100 }] });
  });

  it('o último integrante: apaga o grupo depois de desvinculá-lo e devolve grupo null', async () => {
    const { tx, deps } = prismaDoGrupo({ turmasDosIntegrantes: [1] });

    await expect(removerIntegrante(deps, 20, 100)).resolves.toEqual({ grupo: null });

    expect(tx.grupo.delete).toHaveBeenCalledWith({ where: { id: 20 } });
    expect(tx.inscricao.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.grupo.delete.mock.invocationCallOrder[0]!,
    );
  });

  it('lança NaoEncontrado sem abrir transação se o grupo não existe', async () => {
    const { $transaction, deps } = prismaDoGrupo({ existeAntes: false });

    await expect(removerIntegrante(deps, 20, 100)).rejects.toEqual(
      new NaoEncontrado('Grupo não encontrado.'),
    );
    expect($transaction).not.toHaveBeenCalled();
  });

  it('lança NaoEncontrado se o grupo some enquanto espera o lock', async () => {
    const { tx, deps } = prismaDoGrupo({ existeDepoisDoLock: false });

    await expect(removerIntegrante(deps, 20, 100)).rejects.toEqual(
      new NaoEncontrado('Grupo não encontrado.'),
    );
    expect(tx.inscricao.update).not.toHaveBeenCalled();
  });

  it('lança NaoEncontrado se o aluno não é integrante, sem gravar nada', async () => {
    const { tx, deps } = prismaDoGrupo();

    await expect(removerIntegrante(deps, 20, 999)).rejects.toEqual(
      new NaoEncontrado('Aluno não encontrado neste grupo.'),
    );
    expect(tx.inscricao.update).not.toHaveBeenCalled();
    expect(tx.grupo.delete).not.toHaveBeenCalled();
  });
});

describe('listarGruposDaEdicao', () => {
  const edicao = {
    id: 3,
    semestre: '2026/1',
    dataLimite: new Date('2026-06-16T23:59:00Z'),
    ativa: true,
  };
  const fisicaDoBanco = (id: number, codigo: string) => ({
    id,
    codigo,
    nome: `Física ${codigo}`,
    quantidadeGrupos: 4,
    minimoIntegrantes: 2,
    maximoIntegrantes: 3,
    multiturma: false,
    turmas: [{ codigo: 'A' }, { codigo: 'B' }],
  });

  function prismaDaEdicao({
    edicaoNoBanco = edicao,
    grupos = [grupoDoBanco(1, [1, 1]), grupoDoBanco(2, [1])],
  }: { edicaoNoBanco?: typeof edicao | null; grupos?: ReturnType<typeof grupoDoBanco>[] } = {}) {
    const prisma = {
      edicao: { findFirst: vi.fn().mockResolvedValue(edicaoNoBanco) },
      fisica: {
        findMany: vi.fn().mockResolvedValue([fisicaDoBanco(10, 'F01'), fisicaDoBanco(11, 'F02')]),
      },
      grupo: { findMany: vi.fn().mockResolvedValue(grupos) },
    };
    return { prisma, deps: { prisma: prisma as never } };
  }

  it('sem edicaoId, usa a última edição criada, ativa ou não', async () => {
    const { prisma, deps } = prismaDaEdicao();

    await listarGruposDaEdicao(deps, {});

    expect(prisma.edicao.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }] }),
    );
  });

  it('com edicaoId, usa aquela edição (mesmo inativa)', async () => {
    const { prisma, deps } = prismaDaEdicao();

    await listarGruposDaEdicao(deps, { edicaoId: 3 });

    expect(prisma.edicao.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3 } }),
    );
  });

  it('sem nenhuma edição, devolve vazio sem consultar Físicas nem grupos', async () => {
    const { prisma, deps } = prismaDaEdicao({ edicaoNoBanco: null });

    await expect(listarGruposDaEdicao(deps, {})).resolves.toEqual({
      edicao: null,
      fisicas: [],
      grupos: [],
    });
    expect(prisma.fisica.findMany).not.toHaveBeenCalled();
    expect(prisma.grupo.findMany).not.toHaveBeenCalled();
  });

  it('edicaoId inexistente: NaoEncontrado', async () => {
    const { deps } = prismaDaEdicao({ edicaoNoBanco: null });

    await expect(listarGruposDaEdicao(deps, { edicaoId: 99 })).rejects.toEqual(
      new NaoEncontrado('Edição não encontrada.'),
    );
  });

  it('Física fora da edição: NaoEncontrado, sem consultar grupos', async () => {
    const { prisma, deps } = prismaDaEdicao();

    await expect(listarGruposDaEdicao(deps, { fisicaId: 99 })).rejects.toEqual(
      new NaoEncontrado('Física não encontrada.'),
    );
    expect(prisma.grupo.findMany).not.toHaveBeenCalled();
  });

  it('monta a edição, as Físicas com as turmas e filtra os grupos pela Física no banco', async () => {
    const { prisma, deps } = prismaDaEdicao();

    const resposta = await listarGruposDaEdicao(deps, { fisicaId: 10 });

    expect(resposta.edicao).toEqual({
      id: 3,
      semestre: '2026/1',
      dataLimite: '2026-06-16T23:59:00.000Z',
      ativa: true,
    });
    expect(resposta.fisicas.map((fisica) => [fisica.codigo, fisica.turmas])).toEqual([
      ['F01', ['A', 'B']],
      ['F02', ['A', 'B']],
    ]);
    expect(prisma.grupo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fisica: { edicaoId: 3 }, fisicaId: 10 } }),
    );
  });

  it.each([
    [undefined, [1, 2]],
    ['formado', [1]],
    ['nao-formado', [2]],
  ] as const)('status %s devolve os grupos %j', async (status, ids) => {
    const { deps } = prismaDaEdicao();

    const { grupos } = await listarGruposDaEdicao(deps, { status });

    expect(grupos.map((grupo) => grupo.id)).toEqual(ids);
  });
});

describe('listarAlunosSemGrupo', () => {
  function prismaDaFisica({ existe = true } = {}) {
    const prisma = {
      fisica: { findUnique: vi.fn().mockResolvedValue(existe ? { id: 10 } : null) },
      inscricao: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRaw: vi.fn().mockResolvedValue([{ aluno_id: 7 }]),
    };
    return { prisma, deps: { prisma: prisma as never } };
  }

  it('Física inexistente: NaoEncontrado', async () => {
    const { prisma, deps } = prismaDaFisica({ existe: false });

    await expect(listarAlunosSemGrupo(deps, 10, {})).rejects.toEqual(
      new NaoEncontrado('Física não encontrada.'),
    );
    expect(prisma.inscricao.findMany).not.toHaveBeenCalled();
  });

  it('sem filtros: todos os sem grupo da Física, sem consultar o SQL da busca', async () => {
    const { prisma, deps } = prismaDaFisica();

    await listarAlunosSemGrupo(deps, 10, {});

    expect(prisma.inscricao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fisicaId: 10, grupoId: null, alunoId: { in: undefined }, turma: undefined },
      }),
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('com busca e turma: restringe aos encontrados e ao código da turma', async () => {
    const { prisma, deps } = prismaDaFisica();

    await listarAlunosSemGrupo(deps, 10, { busca: 'silva', turma: 'A' });

    expect(prisma.inscricao.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fisicaId: 10, grupoId: null, alunoId: { in: [7] }, turma: { codigo: 'A' } },
      }),
    );
  });
});

describe('criarGrupoComoAdmin', () => {
  type Opcoes = {
    existe?: boolean;
    multiturma?: boolean;
    maximoIntegrantes?: number;
    quantidadeGrupos?: number;
    novosNoBanco?: readonly {
      alunoId: number;
      turmaId: number;
      grupoId: number | null;
      aluno: { nome: string };
    }[];
    numerosExistentes?: readonly number[];
  };

  function novo(alunoId: number, nome: string, dados: { turmaId?: number; grupoId?: number } = {}) {
    return {
      alunoId,
      turmaId: dados.turmaId ?? 1,
      grupoId: dados.grupoId ?? null,
      aluno: { nome },
    };
  }

  function transacao({
    existe = true,
    multiturma = false,
    maximoIntegrantes = 3,
    quantidadeGrupos = 5,
    novosNoBanco = [novo(7, 'Ana')],
    numerosExistentes = [],
  }: Opcoes = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      fisica: {
        findUnique: vi
          .fn()
          .mockResolvedValue(existe ? { maximoIntegrantes, multiturma, quantidadeGrupos } : null),
      },
      inscricao: {
        findMany: vi.fn().mockResolvedValue(novosNoBanco),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      grupo: {
        findMany: vi.fn().mockResolvedValue(numerosExistentes.map((numero) => ({ numero }))),
        create: vi.fn().mockResolvedValue({ id: 50 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(grupoDoBanco(50, [1])),
      },
    };
    const $transaction = vi.fn((callback: (cliente: typeof tx) => unknown) => callback(tx));
    return { tx, deps: { prisma: { $transaction } as never } };
  }

  it('trava a Física antes de ler a configuração', async () => {
    const { tx, deps } = transacao();

    await criarGrupoComoAdmin(deps, 1, 10, { alunos: [7] });

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.fisica.findUnique.mock.invocationCallOrder[0]!,
    );
  });

  it('cria com 1 aluno (sem exigir o mínimo), o menor número livre e o admin como autor', async () => {
    const { tx, deps } = transacao({ numerosExistentes: [1, 3] });

    await expect(criarGrupoComoAdmin(deps, 1, 10, { alunos: [7] })).resolves.toMatchObject({
      id: 50,
    });

    expect(tx.grupo.create).toHaveBeenCalledWith({
      data: { fisicaId: 10, numero: 2, criadoPorId: 1 },
      select: { id: true },
    });
    expect(tx.inscricao.updateMany).toHaveBeenCalledWith({
      where: { fisicaId: 10, alunoId: { in: [7] } },
      data: { grupoId: 50, entrouNoGrupoEm: expect.any(Date) as Date },
    });
  });

  it('com multiturma, aceita alunos de turmas diferentes', async () => {
    const { tx, deps } = transacao({
      multiturma: true,
      novosNoBanco: [novo(7, 'Ana'), novo(8, 'Daniel', { turmaId: 2 })],
    });

    await criarGrupoComoAdmin(deps, 1, 10, { alunos: [7, 8] });

    expect(tx.grupo.create).toHaveBeenCalled();
  });

  it.each([
    ['a Física não existe', { existe: false }, [7], NaoEncontrado],
    ['os alunos passam do máximo', { maximoIntegrantes: 1 }, [7, 8], GrupoCheio],
    ['um aluno não está inscrito', {}, [7, 8], NaoEncontrado],
    ['um aluno já tem grupo', { novosNoBanco: [novo(7, 'Ana', { grupoId: 4 })] }, [7], JaEmGrupo],
    [
      'os alunos são de turmas diferentes (sem multiturma)',
      { novosNoBanco: [novo(7, 'Ana'), novo(8, 'Daniel', { turmaId: 2 })] },
      [7, 8],
      TurmaDiferente,
    ],
    [
      'a Física já tem todos os grupos',
      { quantidadeGrupos: 2, numerosExistentes: [1, 2] },
      [7],
      LimiteDeGrupos,
    ],
  ] as const)('lança erro quando %s, sem criar nada', async (_caso, opcoes, alunos, Erro) => {
    const { tx, deps } = transacao(opcoes);

    await expect(criarGrupoComoAdmin(deps, 1, 10, { alunos: [...alunos] })).rejects.toBeInstanceOf(
      Erro,
    );
    expect(tx.grupo.create).not.toHaveBeenCalled();
    expect(tx.inscricao.updateMany).not.toHaveBeenCalled();
  });

  it('turmas diferentes: o primeiro da lista define a turma, mesmo se o banco devolver fora de ordem', async () => {
    const { deps } = transacao({
      novosNoBanco: [novo(8, 'Daniel', { turmaId: 2 }), novo(7, 'Ana')],
    });

    await expect(criarGrupoComoAdmin(deps, 1, 10, { alunos: [7, 8] })).rejects.toThrow(
      'Daniel é de outra turma',
    );
  });
});
