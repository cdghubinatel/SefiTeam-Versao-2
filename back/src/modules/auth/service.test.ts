import { beforeAll, describe, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { CredenciaisInvalidas } from '../../shared/errors/app-error.js';
import {
  autenticar,
  encerrarSessoes,
  loginDoAluno,
  normalizarLogin,
  senhaDoAluno,
} from './service.js';

describe('normalizarLogin', () => {
  it('remove todos os espaços e converte para maiúsculas', () => {
    expect(normalizarLogin('  ges 589 ')).toBe('GES589');
  });
});

describe('loginDoAluno', () => {
  it('junta curso e matrícula em maiúsculas', () => {
    expect(loginDoAluno({ curso: 'GES', matricula: '589' })).toBe('GES589');
  });

  it('normaliza espaços e minúsculas vindos da planilha', () => {
    expect(loginDoAluno({ curso: ' ges ', matricula: ' 589 ' })).toBe('GES589');
  });

  it('mantém zeros à esquerda da matrícula', () => {
    expect(loginDoAluno({ curso: 'GEC', matricula: '0042' })).toBe('GEC0042');
  });
});

describe('senhaDoAluno', () => {
  it.each([
    ['Maria', 'MARIA'],
    ['Maria Clara Souza', 'MARIA'],
    ['  joão   pereira ', 'JOAO'],
    ['ÁLVARO', 'ALVARO'],
    ['Conceição Dias', 'CONCEICAO'],
    ["D'Ávila Ramos", "D'AVILA"],
    ['Ana-Luísa Prado', 'ANA-LUISA'],
  ])('usa só a primeira palavra do nome, sem acentos e em maiúsculas (%j)', (nome, senha) => {
    expect(senhaDoAluno({ nome })).toBe(senha);
  });
});

describe('autenticar', () => {
  let hashDoAluno: string;
  let hashDoAdmin: string;

  beforeAll(async () => {
    [hashDoAluno, hashDoAdmin] = await Promise.all([
      argon2.hash(senhaDoAluno({ nome: 'João Pereira' })),
      argon2.hash('Senha-Do-Admin-123'),
    ]);
  });

  function prismaCom(usuario: object | null) {
    const findUnique = vi.fn().mockResolvedValue(usuario);
    return { prisma: { usuario: { findUnique } } as never, findUnique };
  }

  const aluno = () => ({
    id: 7,
    login: 'GES589',
    nome: 'João Pereira',
    papel: 'ALUNO',
    senhaHash: hashDoAluno,
    tokenVersao: 3,
  });

  const admin = () => ({
    id: 1,
    login: 'ADMIN',
    nome: 'Administrador',
    papel: 'ADMIN',
    senhaHash: hashDoAdmin,
    tokenVersao: 0,
  });

  it('devolve o usuário e a versão do token quando a senha confere', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(autenticar({ prisma }, { login: 'GES589', senha: 'João' })).resolves.toEqual({
      usuario: { id: 7, login: 'GES589', nome: 'João Pereira', papel: 'ALUNO' },
      tokenVersao: 3,
    });
  });

  it('busca pelo login normalizado', async () => {
    const { prisma, findUnique } = prismaCom(aluno());

    await autenticar({ prisma }, { login: ' ges 589 ', senha: 'João' });

    expect(findUnique).toHaveBeenCalledWith({ where: { login: 'GES589' } });
  });

  it('não devolve o hash da senha', async () => {
    const { prisma } = prismaCom(aluno());

    const { usuario } = await autenticar({ prisma }, { login: 'GES589', senha: 'João' });

    expect(usuario).not.toHaveProperty('senhaHash');
  });

  it.each(['joao', 'JOAO', 'João', ' joão '])(
    'aceita a senha do aluno sem diferenciar maiúsculas nem acentos (%j)',
    async (senha) => {
      const { prisma } = prismaCom(aluno());

      await expect(autenticar({ prisma }, { login: 'GES589', senha })).resolves.toEqual(
        expect.objectContaining({ tokenVersao: 3 }),
      );
    },
  );

  it('recusa o nome completo como senha do aluno', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(
      autenticar({ prisma }, { login: 'GES589', senha: 'João Pereira' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });

  it('aceita a senha exata do admin', async () => {
    const { prisma } = prismaCom(admin());

    await expect(
      autenticar({ prisma }, { login: 'admin', senha: 'Senha-Do-Admin-123' }),
    ).resolves.toEqual(expect.objectContaining({ tokenVersao: 0 }));
  });

  it('diferencia maiúsculas na senha do admin', async () => {
    const { prisma } = prismaCom(admin());

    await expect(
      autenticar({ prisma }, { login: 'admin', senha: 'senha-do-admin-123' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });

  it('rejeita senha errada', async () => {
    const { prisma } = prismaCom(aluno());

    await expect(
      autenticar({ prisma }, { login: 'GES589', senha: 'Pereira' }),
    ).rejects.toBeInstanceOf(CredenciaisInvalidas);
  });

  it('rejeita login inexistente com o mesmo erro da senha errada', async () => {
    const { prisma } = prismaCom(null);

    await expect(
      autenticar({ prisma }, { login: 'GES999', senha: 'qualquer' }),
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
