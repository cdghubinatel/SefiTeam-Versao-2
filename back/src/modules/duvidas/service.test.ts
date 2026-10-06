import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { NaoEncontrado, OrdemDesatualizada } from '../../shared/errors/app-error.js';
import {
  apagarDuvida,
  atualizarDuvida,
  criarDuvida,
  listarDuvidas,
  reordenarDuvidas,
} from './service.js';

const campos = { id: true, pergunta: true, resposta: true, ordem: true };
const dados = { pergunta: 'Pergunta?', resposta: 'Resposta.' };

function erroPrisma(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erro', { code, clientVersion: 'teste' });
}

describe('listarDuvidas', () => {
  it('ordena por ordem e desempata pelo id', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { duvidaFrequente: { findMany } } as never;

    await listarDuvidas({ prisma });

    expect(findMany).toHaveBeenCalledWith({
      select: campos,
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    });
  });
});

describe('criarDuvida', () => {
  function prismaComMaiorOrdem(ordem: number | null) {
    const aggregate = vi.fn().mockResolvedValue({ _max: { ordem } });
    const create = vi.fn().mockResolvedValue({});
    return { prisma: { duvidaFrequente: { aggregate, create } } as never, create };
  }

  it('coloca a nova dúvida no fim da lista', async () => {
    const { prisma, create } = prismaComMaiorOrdem(4);

    await criarDuvida({ prisma }, dados);

    expect(create).toHaveBeenCalledWith({ data: { ...dados, ordem: 5 }, select: campos });
  });

  it('começa em 1 quando ainda não há dúvidas', async () => {
    const { prisma, create } = prismaComMaiorOrdem(null);

    await criarDuvida({ prisma }, dados);

    expect(create).toHaveBeenCalledWith({ data: { ...dados, ordem: 1 }, select: campos });
  });
});

describe('atualizarDuvida', () => {
  it('atualiza pergunta e resposta', async () => {
    const update = vi.fn().mockResolvedValue({ id: 3, ...dados, ordem: 1 });
    const prisma = { duvidaFrequente: { update } } as never;

    await expect(atualizarDuvida({ prisma }, 3, dados)).resolves.toEqual({
      id: 3,
      ...dados,
      ordem: 1,
    });
    expect(update).toHaveBeenCalledWith({ where: { id: 3 }, data: dados, select: campos });
  });

  it('lança NaoEncontrado quando a dúvida não existe', async () => {
    const update = vi.fn().mockRejectedValue(erroPrisma('P2025'));
    const prisma = { duvidaFrequente: { update } } as never;

    await expect(atualizarDuvida({ prisma }, 99, dados)).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('repassa outros erros do Prisma', async () => {
    const erro = erroPrisma('P1001');
    const update = vi.fn().mockRejectedValue(erro);
    const prisma = { duvidaFrequente: { update } } as never;

    await expect(atualizarDuvida({ prisma }, 3, dados)).rejects.toBe(erro);
  });
});

describe('apagarDuvida', () => {
  it('apaga pelo id', async () => {
    const del = vi.fn().mockResolvedValue({});
    const prisma = { duvidaFrequente: { delete: del } } as never;

    await apagarDuvida({ prisma }, 3);

    expect(del).toHaveBeenCalledWith({ where: { id: 3 } });
  });

  it('lança NaoEncontrado quando a dúvida não existe', async () => {
    const del = vi.fn().mockRejectedValue(erroPrisma('P2025'));
    const prisma = { duvidaFrequente: { delete: del } } as never;

    await expect(apagarDuvida({ prisma }, 99)).rejects.toBeInstanceOf(NaoEncontrado);
  });

  it('repassa outros erros do Prisma', async () => {
    const erro = new Error('conexão caiu');
    const del = vi.fn().mockRejectedValue(erro);
    const prisma = { duvidaFrequente: { delete: del } } as never;

    await expect(apagarDuvida({ prisma }, 3)).rejects.toBe(erro);
  });
});

describe('reordenarDuvidas', () => {
  /** Prisma cujo `$transaction` executa o callback com um `tx` mockado. */
  function prismaComDuvidas(idsNoBanco: number[]) {
    const listaFinal = [{ id: 1, pergunta: 'P', resposta: 'R', ordem: 1 }];
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(idsNoBanco.map((id) => ({ id })))
      .mockResolvedValueOnce(listaFinal);
    const update = vi.fn().mockResolvedValue({});
    const tx = { duvidaFrequente: { findMany, update } };
    const $transaction = vi.fn((callback: (cliente: typeof tx) => unknown) => callback(tx));
    return { prisma: { $transaction } as never, update, $transaction, listaFinal };
  }

  it('grava a posição de cada id como ordem e devolve a lista atualizada', async () => {
    const { prisma, update, listaFinal } = prismaComDuvidas([1, 2, 3]);

    await expect(reordenarDuvidas({ prisma }, [3, 1, 2])).resolves.toBe(listaFinal);

    expect(update.mock.calls).toEqual([
      [{ where: { id: 3 }, data: { ordem: 1 } }],
      [{ where: { id: 1 }, data: { ordem: 2 } }],
      [{ where: { id: 2 }, data: { ordem: 3 } }],
    ]);
  });

  it('roda dentro de uma transação', async () => {
    const { prisma, $transaction } = prismaComDuvidas([1]);

    await reordenarDuvidas({ prisma }, [1]);

    expect($transaction).toHaveBeenCalledOnce();
  });

  it('aceita lista vazia quando não há dúvidas', async () => {
    const { prisma, update } = prismaComDuvidas([]);

    await reordenarDuvidas({ prisma }, []);

    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['falta uma dúvida (outra aba criou)', [1, 2]],
    ['sobra uma dúvida (outra aba apagou)', [1, 2, 3, 4]],
    ['troca um id por outro inexistente', [1, 2, 99]],
    ['repete um id', [1, 2, 2]],
  ])('lança OrdemDesatualizada quando a lista %s, sem alterar nada', async (_caso, ids) => {
    const { prisma, update } = prismaComDuvidas([1, 2, 3]);

    await expect(reordenarDuvidas({ prisma }, ids)).rejects.toBeInstanceOf(OrdemDesatualizada);
    expect(update).not.toHaveBeenCalled();
  });
});
