import argon2 from 'argon2';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../../plugins/auth.js';
import { CredenciaisInvalidas } from '../../shared/errors/app-error.js';
import type { LoginBody } from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'usuario'> };

let hashFalso: Promise<string> | undefined;

/**
 * Hash comparado quando o login não existe, para o tempo de resposta
 * não revelar quais logins estão cadastrados.
 */
function obterHashFalso() {
  hashFalso ??= argon2.hash('login-inexistente');
  return hashFalso;
}

export function normalizarLogin(login: string) {
  return login.trim().toUpperCase();
}

export async function autenticar(
  { prisma }: Deps,
  { login, senha }: LoginBody,
): Promise<{ usuario: UsuarioAutenticado; tokenVersao: number }> {
  const usuario = await prisma.usuario.findUnique({ where: { login: normalizarLogin(login) } });

  const senhaConfere = await argon2.verify(usuario?.senhaHash ?? (await obterHashFalso()), senha);
  if (!usuario || !senhaConfere) {
    throw new CredenciaisInvalidas();
  }

  return {
    usuario: { id: usuario.id, login: usuario.login, nome: usuario.nome, papel: usuario.papel },
    tokenVersao: usuario.tokenVersao,
  };
}

/** Logout: invalida todos os tokens já emitidos para o usuário (em todos os dispositivos). */
export async function encerrarSessoes({ prisma }: Deps, usuarioId: number) {
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: { tokenVersao: { increment: 1 } },
  });
}
