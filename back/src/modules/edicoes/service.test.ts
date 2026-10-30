import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { DadosInvalidos } from '../../shared/errors/app-error.js';
import type { CriarEdicaoBody } from './schemas.js';
import { criarEdicao } from './service.js';

/** Prisma que só registra se a transação foi aberta (as regras abaixo vêm antes dela). */
function prismaFalso() {
  const $transaction = vi.fn().mockResolvedValue('criada');
  return { prisma: { $transaction } as unknown as PrismaClient, $transaction };
}

function corpo(dados: Partial<CriarEdicaoBody> = {}): CriarEdicaoBody {
  return {
    dataLimite: '2026-06-16',
    fisicas: [
      {
        codigo: 'Fis1',
        quantidadeGrupos: 5,
        minimoIntegrantes: 2,
        maximoIntegrantes: 4,
        multiturma: false,
        alunos: [{ curso: 'GES', matricula: '1', nome: 'Ana Lima', turma: 'A' }],
      },
    ],
    ...dados,
  };
}

/** 16/06/2026 às 23:00 em Brasília: ainda dentro do prazo de 16/06. */
const NA_NOITE_DO_PRAZO = new Date('2026-06-16T23:00:00-03:00');

describe('criarEdicao', () => {
  it('data limite já passada: 400 no campo dataLimite, sem abrir a transação', async () => {
    const { prisma, $transaction } = prismaFalso();

    const erro = await criarEdicao(
      { prisma },
      corpo(),
      new Date('2026-06-17T00:00:00-03:00'),
    ).catch((motivo: unknown) => motivo);

    expect(erro).toBeInstanceOf(DadosInvalidos);
    expect((erro as DadosInvalidos).detalhes).toEqual([
      { campo: 'dataLimite', mensagem: 'A data limite precisa ser hoje ou uma data futura.' },
    ]);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('o próprio dia do prazo ainda é aceito até 23:59', async () => {
    const { prisma, $transaction } = prismaFalso();

    await expect(criarEdicao({ prisma }, corpo(), NA_NOITE_DO_PRAZO)).resolves.toBe('criada');
    expect($transaction).toHaveBeenCalledOnce();
  });

  it('problemas da planilha: todos de uma vez, sem abrir a transação', async () => {
    const { prisma, $transaction } = prismaFalso();
    const [fisica] = corpo().fisicas;

    const erro = await criarEdicao(
      { prisma },
      corpo({
        fisicas: [
          { ...fisica!, minimoIntegrantes: 5, maximoIntegrantes: 4 },
          { ...fisica!, codigo: 'Fis2', alunos: [] },
        ],
      }),
      NA_NOITE_DO_PRAZO,
    ).catch((motivo: unknown) => motivo);

    expect(erro).toBeInstanceOf(DadosInvalidos);
    expect((erro as DadosInvalidos).detalhes).toEqual([
      { campo: 'Fis1', mensagem: 'O mínimo de integrantes (5) é maior que o máximo (4).' },
      { campo: 'Fis2', mensagem: 'A Física não tem alunos.' },
    ]);
    expect($transaction).not.toHaveBeenCalled();
  });
});
