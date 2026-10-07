import { beforeAll, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { CredenciaisInvalidas } from '../../shared/errors/app-error.js';
import { autenticar, encerrarSessoes, normalizarEmail, senhaDoAluno } from './service.js';

describe('normalizarEmail', () => {
  it('remove espaços das pontas e converte para minúsculas', () => {
    expect(normalizarEmail('  Maria.Silva@Inatel.BR ')).toBe('maria.silva@inatel.br');
  });
});

describe('senhaDoAluno', () => {
  it('junta curso e matrícula em maiúsculas', () => {
    expect(senhaDoAluno({ curso: 'GES', matricula: '589' })).toBe('GES589');
  });

  it('normaliza espaços e minúsculas vindos da planilha', () => {
    expect(senhaDoAluno({ curso: ' ges ', matricula: ' 589 ' })).toBe('GES589');
  });
});

describe('autenticar', () => {
  let hashDoAluno: string;
  let hashDoAdmin: string;

  beforeAll(async () => {
    [hashDoAluno, hashDoAdmin] = await Promise.all([
      argon2.hash('GES589'),
      argon2.hash('Senha-Do-Admin-123'),
    ]);
  });

  function prismaCom(usuario: object | null) {
    const findUnique = vi.fn().mockResolvedValue(usuario);
    return { prisma: { usuario: { findUnique } } as never, findUnique };
  }

  const aluno = () => ({
    id: 7,
    email: 'maria@inatel.br',
    nome: 'Maria',
    papel: 'ALUNO',
    senhaHash: hashDoAluno,
    tokenVersao: 3,
  });

  const admin = () => ({
    id: 1,
    email: 'admin@inatel.br',
    nome: 'Administrador',
    papel: 'ADMIN',
    senhaHash: hashDoAdmin,
    tokenVersao: 0,
  });

  it('devolve o usuário e a versão do token quando a senha confere', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(
      autenticar({ prisma }, { email: 'maria@inatel.br', senha: 'GES589' }),
    ).resolves.toEqual({
      usuario: { id: 7, email: 'maria@inatel.br', nome: 'Maria', papel: 'ALUNO' },
      tokenVersao: 3,
    });
  });

  it('busca pelo e-mail normalizado', async () => {
    const { prisma, findUnique } = prismaCom(aluno());

    await autenticar({ prisma }, { email: ' Maria@Inatel.br ', senha: 'GES589' });

    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'maria@inatel.br' } });
  });

  it('não devolve o hash da senha', async () => {
    const { prisma } = prismaCom(aluno());

    const { usuario } = await autenticar({ prisma }, { email: 'maria@inatel.br', senha: 'GES589' });

    expect(usuario).not.toHaveProperty('senhaHash');
  });

  it.each(['ges589', 'Ges589', ' GES589 '])(
    'aceita a senha do aluno sem diferenciar maiúsculas (%j)',
    async (senha) => {
      const { prisma } = prismaCom(aluno());

      await expect(autenticar({ prisma }, { email: 'maria@inatel.br', senha })).resolves.toEqual(
        expect.objectContaining({ tokenVersao: 3 }),
      );
    },
  );

  it('aceita a senha exata do admin', async () => {
    const { prisma } = prismaCom(admin());

    await expect(
      autenticar({ prisma }, { email: 'admin@inatel.br', senha: 'Senha-Do-Admin-123' }),
    ).resolves.toEqual(expect.objectContaining({ tokenVersao: 0 }));
  });

  it('diferencia maiúsculas na senha do admin', async () => {
    const { prisma } = prismaCom(admin());

    await expect(
      autenticar({ prisma }, { email: 'admin@inatel.br', senha: 'senha-do-admin-123' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });

  it('rejeita senha errada', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(
      autenticar({ prisma }, { email: 'maria@inatel.br', senha: 'GES590' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });

  it('rejeita e-mail inexistente com o mesmo erro da senha errada', async () => {
    const { prisma } = prismaCom(null);

    await expect(
      autenticar({ prisma }, { email: 'ninguem@inatel.br', senha: 'qualquer' }),
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
