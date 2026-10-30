import type { PrismaClient } from '../../generated/prisma/client.js';
import { DadosInvalidos, SemestreExistente } from '../../shared/errors/app-error.js';
import { hashDaSenhaDoAluno, loginDoAluno, senhaDoAluno } from '../auth/service.js';
import { nomeDaFisica, prazoDoDia, semestreDoDia, validarFisicas } from './regras.js';
import type { AlunoDaPlanilha, CriarEdicaoBody, EdicaoCriada } from './schemas.js';

type Deps = { prisma: PrismaClient };

/**
 * Chave do lock de transação (`pg_advisory_xact_lock`) que põe em fila as criações de edição:
 * sem ele, duas criações ao mesmo tempo finalizariam a mesma edição e as duas tentariam
 * ficar ativas (o índice único recusaria uma com erro 500). Ver docs/edicoes.md#concorrência.
 */
const LOCK_CRIAR_EDICAO = 51_001;

/** Criar a edição grava muitos alunos de uma vez; o padrão do Prisma (5 s) é curto para isso. */
const TEMPO_MAXIMO_DA_TRANSACAO = 60_000;

/** Turmas em ordem de código, com números em ordem natural ("A2" antes de "A10"). */
function emOrdemDeCodigo(codigos: Iterable<string>) {
  return [...codigos].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

/**
 * Cria a edição a partir da planilha lida pelo front: a edição (ativa), as Físicas com as
 * turmas, os alunos novos e as inscrições, numa transação. A edição que estava ativa é
 * finalizada. Alunos já cadastrados (mesmo curso + matrícula) são reaproveitados, com o nome e a
 * senha atualizados, sem deslogar. Regras em docs/edicoes.md.
 */
export async function criarEdicao(
  { prisma }: Deps,
  { dataLimite, fisicas: fisicasDaPlanilha }: CriarEdicaoBody,
  agora = new Date(),
): Promise<EdicaoCriada> {
  const prazo = prazoDoDia(dataLimite);
  if (prazo.getTime() < agora.getTime()) {
    throw new DadosInvalidos('dataLimite', 'A data limite precisa ser hoje ou uma data futura.');
  }

  const { erros, fisicas } = validarFisicas(fisicasDaPlanilha);
  if (erros.length > 0) {
    throw new DadosInvalidos(erros);
  }

  const semestre = semestreDoDia(dataLimite);

  /** Cada aluno uma vez (ele aparece em várias Físicas), com a primeira Física em que aparece. */
  const alunos = new Map<string, { aluno: AlunoDaPlanilha; fisica: string }>();
  for (const fisica of fisicas) {
    for (const aluno of fisica.alunos) {
      const login = loginDoAluno(aluno);
      if (!alunos.has(login)) {
        alunos.set(login, { aluno, fisica: fisica.codigo });
      }
    }
  }

  // O hash é a parte lenta: fica fora da transação e é calculado uma vez por senha
  // (alunos com o mesmo primeiro nome têm a mesma senha, que não é secreta).
  const senhas = new Set([...alunos.values()].map(({ aluno }) => senhaDoAluno(aluno)));
  const hashes = new Map(
    await Promise.all(
      [...senhas].map(async (senha) => [senha, await hashDaSenhaDoAluno(senha)] as const),
    ),
  );
  const hashDe = (aluno: AlunoDaPlanilha) => hashes.get(senhaDoAluno(aluno))!;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CRIAR_EDICAO})`;

      if (await tx.edicao.findUnique({ where: { semestre }, select: { id: true } })) {
        throw new SemestreExistente(semestre);
      }

      const existentes = await tx.usuario.findMany({
        where: { login: { in: [...alunos.keys()] } },
        select: { id: true, login: true, nome: true, papel: true },
      });

      // Login de aluno igual ao de um admin: atualizar o "aluno" trocaria a senha do admin.
      const admins = existentes.filter((usuario) => usuario.papel !== 'ALUNO');
      if (admins.length > 0) {
        throw new DadosInvalidos(
          admins.map(({ login }) => ({
            campo: alunos.get(login)!.fisica,
            mensagem: `${login} é o login de um administrador.`,
          })),
        );
      }

      const reaproveitados = new Set(existentes.map((usuario) => usuario.login));
      const novos = await tx.usuario.createManyAndReturn({
        data: [...alunos]
          .filter(([login]) => !reaproveitados.has(login))
          .map(([login, { aluno }]) => ({
            login,
            senhaHash: hashDe(aluno),
            nome: aluno.nome,
            papel: 'ALUNO' as const,
            curso: aluno.curso,
            matricula: aluno.matricula,
          })),
        select: { id: true, login: true },
      });

      // A senha sai do nome: com o nome igual, nada muda. O `tokenVersao` fica igual (não desloga).
      for (const usuario of existentes) {
        const { aluno } = alunos.get(usuario.login)!;
        if (usuario.nome !== aluno.nome) {
          await tx.usuario.update({
            where: { id: usuario.id },
            data: { nome: aluno.nome, senhaHash: hashDe(aluno) },
          });
        }
      }

      const idDoAluno = new Map(
        [...existentes, ...novos].map((usuario) => [usuario.login, usuario.id]),
      );

      const edicaoFinalizada = await tx.edicao.findFirst({
        where: { ativa: true },
        select: { id: true, semestre: true },
      });
      if (edicaoFinalizada) {
        await tx.edicao.update({ where: { id: edicaoFinalizada.id }, data: { ativa: false } });
      }

      const edicao = await tx.edicao.create({
        data: { semestre, dataLimite: prazo, ativa: true },
      });

      const fisicasCriadas = [];
      for (const { alunos: alunosDaFisica, ...configuracao } of fisicas) {
        const turmas = emOrdemDeCodigo(new Set(alunosDaFisica.map((aluno) => aluno.turma)));
        const fisica = await tx.fisica.create({
          data: {
            ...configuracao,
            edicaoId: edicao.id,
            nome: nomeDaFisica(configuracao.codigo),
            turmas: { create: turmas.map((codigo) => ({ codigo })) },
          },
          include: { turmas: true },
        });

        const idDaTurma = new Map(fisica.turmas.map((turma) => [turma.codigo, turma.id]));
        await tx.inscricao.createMany({
          data: alunosDaFisica.map((aluno) => ({
            alunoId: idDoAluno.get(loginDoAluno(aluno))!,
            fisicaId: fisica.id,
            turmaId: idDaTurma.get(aluno.turma)!,
          })),
        });

        fisicasCriadas.push({
          id: fisica.id,
          codigo: fisica.codigo,
          nome: fisica.nome,
          quantidadeGrupos: fisica.quantidadeGrupos,
          minimoIntegrantes: fisica.minimoIntegrantes,
          maximoIntegrantes: fisica.maximoIntegrantes,
          multiturma: fisica.multiturma,
          alunos: alunosDaFisica.length,
          turmas: turmas.map((codigo) => ({
            codigo,
            alunos: alunosDaFisica.filter((aluno) => aluno.turma === codigo).length,
          })),
        });
      }

      return {
        edicao: {
          id: edicao.id,
          semestre: edicao.semestre,
          dataLimite: edicao.dataLimite.toISOString(),
          ativa: edicao.ativa,
        },
        fisicas: fisicasCriadas,
        alunos: { novos: novos.length, reaproveitados: existentes.length },
        edicaoFinalizada,
      };
    },
    { timeout: TEMPO_MAXIMO_DA_TRANSACAO },
  );
}
