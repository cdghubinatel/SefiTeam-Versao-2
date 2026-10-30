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

/** O login é gravado e comparado sem espaços e em maiúsculas: `ges 589` = `GES589`. */
export function normalizarLogin(login: string) {
  return login.replace(/\s/g, '').toUpperCase();
}

/** Login do aluno: curso + matrícula (ex.: `GES589`). Usado ao cadastrar o aluno. */
export function loginDoAluno({ curso, matricula }: { curso: string; matricula: string }) {
  return normalizarLogin(`${curso}${matricula}`);
}

/** A senha do aluno não diferencia maiúsculas nem acentos: `joao` = `João` = `JOAO`. */
function normalizarSenhaDoAluno(senha: string) {
  return senha.trim().normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

/**
 * Senha do aluno: a primeira palavra do nome, separada por espaço ("Maria Clara Souza" → `MARIA`).
 * Usada ao cadastrar o aluno. Não é secreta, de propósito (ver docs/autenticacao.md).
 */
export function senhaDoAluno({ nome }: { nome: string }) {
  const [primeiraPalavra = ''] = nome.trim().split(/\s+/);
  return normalizarSenhaDoAluno(primeiraPalavra);
}

/**
 * Custo do argon2 para a senha do aluno, bem menor que o padrão: a senha é o primeiro nome
 * (não é secreta), então o custo alto não protege nada e tornaria lenta a criação da edição,
 * que cadastra centenas de alunos numa requisição (~100 ms por hash no padrão, ~2 ms aqui).
 * O `verify` lê os parâmetros de dentro do hash, então o login não muda.
 */
const CUSTO_DA_SENHA_DO_ALUNO = { memoryCost: 4096, timeCost: 1, parallelism: 1 };

/** Hash da senha do aluno (a primeira palavra do nome, normalizada). */
export function hashDaSenhaDoAluno(senha: string) {
  return argon2.hash(senha, CUSTO_DA_SENHA_DO_ALUNO);
}

export async function autenticar(
  { prisma }: Deps,
  { login, senha }: LoginBody,
): Promise<{ usuario: UsuarioAutenticado; tokenVersao: number }> {
  const usuario = await prisma.usuario.findUnique({ where: { login: normalizarLogin(login) } });

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
