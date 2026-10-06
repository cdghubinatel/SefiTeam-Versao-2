import type { PrismaClient } from '../../generated/prisma/client.js';
import { ehRegistroInexistente } from '../../lib/prisma.js';
import { NaoEncontrado, OrdemDesatualizada } from '../../shared/errors/app-error.js';
import type { DuvidaBody } from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'duvidaFrequente'> };
type DepsComTransacao = { prisma: Pick<PrismaClient, 'duvidaFrequente' | '$transaction'> };

const campos = { id: true, pergunta: true, resposta: true, ordem: true } as const;

function duvidaNaoEncontrada() {
  return new NaoEncontrado('Dúvida não encontrada.');
}

/** Ordem de exibição; `id` desempata quando duas dúvidas têm a mesma `ordem`. */
export function listarDuvidas({ prisma }: Deps) {
  return prisma.duvidaFrequente.findMany({
    select: campos,
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  });
}

/** A nova dúvida entra no fim da lista. */
export async function criarDuvida({ prisma }: Deps, dados: DuvidaBody) {
  const { _max } = await prisma.duvidaFrequente.aggregate({ _max: { ordem: true } });

  return prisma.duvidaFrequente.create({
    data: { ...dados, ordem: (_max.ordem ?? 0) + 1 },
    select: campos,
  });
}

export async function atualizarDuvida({ prisma }: Deps, id: number, dados: DuvidaBody) {
  try {
    return await prisma.duvidaFrequente.update({ where: { id }, data: dados, select: campos });
  } catch (erro) {
    throw ehRegistroInexistente(erro) ? duvidaNaoEncontrada() : erro;
  }
}

/**
 * Recebe todos os ids na nova ordem e grava `ordem = posição + 1`.
 * Se a lista não tiver exatamente as dúvidas do banco (alguém criou ou apagou uma
 * enquanto o admin reordenava), nada é alterado.
 */
export function reordenarDuvidas({ prisma }: DepsComTransacao, ids: number[]) {
  return prisma.$transaction(async (tx) => {
    const existentes = await tx.duvidaFrequente.findMany({ select: { id: true } });

    const mesmaLista =
      existentes.length === ids.length && existentes.every(({ id }) => ids.includes(id));
    if (!mesmaLista) {
      throw new OrdemDesatualizada();
    }

    for (const [posicao, id] of ids.entries()) {
      await tx.duvidaFrequente.update({ where: { id }, data: { ordem: posicao + 1 } });
    }

    return listarDuvidas({ prisma: tx });
  });
}

export async function apagarDuvida({ prisma }: Deps, id: number) {
  try {
    await prisma.duvidaFrequente.delete({ where: { id } });
  } catch (erro) {
    throw ehRegistroInexistente(erro) ? duvidaNaoEncontrada() : erro;
  }
}
