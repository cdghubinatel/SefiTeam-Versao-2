import argon2 from 'argon2';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { UsuarioAutenticado } from '../../plugins/auth.js';
import { CredenciaisInvalidas } from '../../shared/errors/app-error.js';
import type { LoginBody } from './schemas.js';

type Deps = { prisma: Pick<PrismaClient, 'usuario'> };

let hashFalso: Promise<string> | undefined;

/**
 * Hash comparado quando o e-mail não existe, para o tempo de resposta
 * não revelar quais e-mails estão cadastrados.
 */
function obterHashFalso() {
  hashFalso ??= argon2.hash('login-inexistente');
  return hashFalso;
}

/** O e-mail é o login: gravado e comparado sem espaços nas pontas e em minúsculas. */
export function normalizarEmail(email: string) {
  return email.trim().toLowerCase();
}

/** A senha do aluno não diferencia maiúsculas: `ges589` = `GES589`. */
function normalizarSenhaDoAluno(senha: string) {
  return senha.trim().toUpperCase();
}

/**
 * Senha do aluno: curso + matrícula (ex.: `GES589`). Usada ao cadastrar o aluno.
 * Risco aceito: quem souber o e-mail, o curso e a matrícula de um colega entra como ele
 * (ver docs/autenticacao.md).
 */
export function senhaDoAluno({ curso, matricula }: { curso: string; matricula: string }) {
  return normalizarSenhaDoAluno(`${curso.trim()}${matricula.trim()}`);
}

export async function autenticar(
  { prisma }: Deps,
  { email, senha }: LoginBody,
): Promise<{ usuario: UsuarioAutenticado; tokenVersao: number }> {
  const usuario = await prisma.usuario.findUnique({ where: { email: normalizarEmail(email) } });

  // Só a senha do aluno é normalizada; a do admin diferencia maiúsculas.
  const senhaDigitada = usuario?.papel === 'ALUNO' ? normalizarSenhaDoAluno(senha) : senha;
  const senhaConfere = await argon2.verify(
    usuario?.senhaHash ?? (await obterHashFalso()),
    senhaDigitada,
  );
  if (!usuario || !senhaConfere) {
    throw new CredenciaisInvalidas();
  }

  return {
    usuario: { id: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel },
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
