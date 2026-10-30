/** Regras puras da criação da edição (sem banco), usadas pelo service. Ver docs/edicoes.md. */
import type { DetalheErro } from '../../shared/errors/app-error.js';
import { loginDoAluno } from '../auth/service.js';
import type { AlunoDaPlanilha, FisicaDaPlanilha } from './schemas.js';

/** Acima disso, a resposta ficaria enorme numa planilha toda errada; o professor corrige e reenvia. */
export const MAXIMO_DE_ERROS = 50;

/**
 * Prazo de uma data (AAAA-MM-DD): até 23:59:59 desse dia no horário de Brasília.
 * O Brasil não tem horário de verão desde 2019, então o fuso é fixo em -03:00.
 */
export function prazoDoDia(data: string) {
  return new Date(`${data}T23:59:59.999-03:00`);
}

/** Semestre da edição pela data limite: até junho, "AAAA/1"; de julho em diante, "AAAA/2". */
export function semestreDoDia(data: string) {
  const [ano, mes] = data.split('-').map(Number);
  return `${ano}/${mes! <= 6 ? 1 : 2}`;
}

/** Nome da Física pelo código da aba: "Fis1" → "Física 1". Fora desse padrão, o próprio código. */
export function nomeDaFisica(codigo: string) {
  const numero = /^fis\s*0*(\d+)$/i.exec(codigo.trim())?.[1];
  return numero ? `Física ${numero}` : codigo;
}

/** Nomes iguais a menos de maiúsculas, acentos e espaços são o mesmo nome. */
function nomeComparavel(nome: string) {
  return nome.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export type FisicaValidada = Omit<FisicaDaPlanilha, 'alunos'> & {
  /** Sem repetições: o aluno repetido na mesma turma conta uma vez. */
  alunos: AlunoDaPlanilha[];
};

/**
 * Confere as Físicas da planilha e devolve todos os erros de uma vez (até `MAXIMO_DE_ERROS`),
 * identificados pela Física (`campo` = código da aba) e pelo aluno (curso + matrícula).
 * O aluno é a mesma pessoa em todas as Físicas: o que o identifica é o curso + a matrícula.
 */
export function validarFisicas(fisicas: readonly FisicaDaPlanilha[]): {
  erros: DetalheErro[];
  fisicas: FisicaValidada[];
} {
  const erros: DetalheErro[] = [];
  const codigosVistos = new Set<string>();
  /** Primeiro nome visto de cada aluno, e em qual Física, para comparar com as próximas. */
  const nomes = new Map<string, { nome: string; fisica: string }>();
  const nomesJaAcusados = new Set<string>();

  const validadas = fisicas.map((fisica) => {
    const { codigo } = fisica;
    const erro = (mensagem: string) => erros.push({ campo: codigo, mensagem });

    const codigoComparavel = codigo.toUpperCase();
    if (codigosVistos.has(codigoComparavel)) {
      erro(`A Física ${codigo} aparece mais de uma vez.`);
    }
    codigosVistos.add(codigoComparavel);

    if (fisica.minimoIntegrantes > fisica.maximoIntegrantes) {
      erro(
        `O mínimo de integrantes (${fisica.minimoIntegrantes}) é maior que o máximo (${fisica.maximoIntegrantes}).`,
      );
    }

    const turmas = new Map<string, string>();
    const turmasJaAcusadas = new Set<string>();
    const alunos: AlunoDaPlanilha[] = [];
    for (const aluno of fisica.alunos) {
      const login = loginDoAluno(aluno);

      const anterior = nomes.get(login);
      if (!anterior) {
        nomes.set(login, { nome: aluno.nome, fisica: codigo });
      } else if (
        nomeComparavel(anterior.nome) !== nomeComparavel(aluno.nome) &&
        !nomesJaAcusados.has(login)
      ) {
        nomesJaAcusados.add(login);
        const onde = anterior.fisica === codigo ? 'nesta mesma Física' : `na ${anterior.fisica}`;
        erro(`${login} aparece como "${aluno.nome}" e como "${anterior.nome}" ${onde}.`);
      }

      const turma = turmas.get(login);
      if (turma === undefined) {
        turmas.set(login, aluno.turma);
        alunos.push(aluno);
      } else if (turma !== aluno.turma && !turmasJaAcusadas.has(login)) {
        turmasJaAcusadas.add(login);
        erro(`${login} (${aluno.nome}) aparece nas turmas ${turma} e ${aluno.turma}.`);
      }
    }

    if (alunos.length === 0) {
      erro('A Física não tem alunos.');
    }

    const capacidade = fisica.quantidadeGrupos * fisica.maximoIntegrantes;
    if (alunos.length > capacidade) {
      erro(
        `São ${alunos.length} alunos, mas ${fisica.quantidadeGrupos} grupos de até ${fisica.maximoIntegrantes} integrantes cabem ${capacidade}.`,
      );
    }

    return { ...fisica, alunos };
  });

  return { erros: erros.slice(0, MAXIMO_DE_ERROS), fisicas: validadas };
}
