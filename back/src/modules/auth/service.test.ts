import { beforeAll, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { CredenciaisInvalidas } from '../../shared/errors/app-error.js';
import { autenticar, encerrarSessoes, normalizarLogin } from './service.js';

describe('normalizarLogin', () => {
  it('remove espaços e converte para maiúsculas', () => {
    expect(normalizarLogin('  ges589 ')).toBe('GES589');
  });
});

describe('autenticar', () => {
  let senhaHash: string;

  beforeAll(async () => {
    senhaHash = await argon2.hash('senha-correta');
  });

  function prismaCom(usuario: object | null) {
    const findUnique = vi.fn().mockResolvedValue(usuario);
    return { prisma: { usuario: { findUnique } } as never, findUnique };
  }

  const aluno = () => ({
    id: 7,
    login: 'GES589',
    nome: 'Aluno',
    papel: 'ALUNO',
    senhaHash,
    tokenVersao: 3,
  });

  it('devolve o usuário e a versão do token quando a senha confere', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(
      autenticar({ prisma }, { login: 'GES589', senha: 'senha-correta' }),
    ).resolves.toEqual({
      usuario: { id: 7, login: 'GES589', nome: 'Aluno', papel: 'ALUNO' },
      tokenVersao: 3,
    });
  });

  it('busca pelo login normalizado', async () => {
    const { prisma, findUnique } = prismaCom(aluno());

    await autenticar({ prisma }, { login: ' ges589 ', senha: 'senha-correta' });

    expect(findUnique).toHaveBeenCalledWith({ where: { login: 'GES589' } });
  });

  it('não devolve o hash da senha', async () => {
    const { prisma } = prismaCom(aluno());

    const { usuario } = await autenticar({ prisma }, { login: 'GES589', senha: 'senha-correta' });

    expect(usuario).not.toHaveProperty('senhaHash');
  });

  it('rejeita senha errada', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(
      autenticar({ prisma }, { login: 'GES589', senha: 'senha-errada' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });

  it('rejeita login inexistente com o mesmo erro da senha errada', async () => {
    const { prisma } = prismaCom(null);

    await expect(
      autenticar({ prisma }, { login: 'NAOEXISTE', senha: 'qualquer' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });
});

describe('encerrarSessoes', () => {
  it('incrementa a versão do token do usuário', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = { usuario: { update } } as never;

    await encerrarSessoes({ prisma }, 7);

    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { tokenVersao: { increment: 1 } },
    });
  });
});
