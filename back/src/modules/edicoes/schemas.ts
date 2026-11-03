import { z } from 'zod';

/** Texto obrigatório, sem espaços nas pontas. */
const texto = (maximo: number) => z.string().trim().min(1).max(maximo);

/** Sem nenhum espaço e em maiúsculas, como o login do aluno é montado (`ges 589` → `GES589`). */
const semEspacos = (maximo: number, { maiusculas }: { maiusculas: boolean }) =>
  texto(maximo).transform((valor) => {
    const junto = valor.replace(/\s/g, '');
    return maiusculas ? junto.toUpperCase() : junto;
  });

/** Uma linha da aba da Física, já lida pelo front. */
export const alunoDaPlanilhaSchema = z.object({
  /** Sigla do curso (ex.: "GES"). */
  curso: semEspacos(20, { maiusculas: true }),
  matricula: semEspacos(30, { maiusculas: true }),
  /** Nome completo; espaços repetidos viram um só. A senha do aluno é a primeira palavra. */
  nome: texto(200).transform((nome) => nome.replace(/\s+/g, ' ')),
  /** Código da turma na Física (ex.: "A"). */
  turma: texto(50).transform((turma) => turma.toUpperCase()),
});

/** Uma aba da planilha (uma Física) com a configuração escolhida no assistente. */
export const fisicaDaPlanilhaSchema = z.object({
  /** Nome da aba, como está (ex.: "Fis1"). */
  codigo: texto(50),
  quantidadeGrupos: z.number().int().min(1).max(1000),
  minimoIntegrantes: z.number().int().min(1).max(100),
  maximoIntegrantes: z.number().int().min(1).max(100),
  /** Permite grupos com alunos de turmas diferentes da Física. */
  multiturma: z.boolean(),
  alunos: z.array(alunoDaPlanilhaSchema).max(3000),
});

export const criarEdicaoBodySchema = z.object({
  /** Só a data (AAAA-MM-DD): o prazo vale até 23:59 desse dia, no horário de Brasília. */
  dataLimite: z.iso.date(),
  fisicas: z.array(fisicaDaPlanilhaSchema).min(1).max(30),
});

export const fisicaCriadaSchema = z.object({
  id: z.number().int(),
  codigo: z.string(),
  /** Derivado do código: "Fis1" → "Física 1". */
  nome: z.string(),
  quantidadeGrupos: z.number().int(),
  minimoIntegrantes: z.number().int(),
  maximoIntegrantes: z.number().int(),
  multiturma: z.boolean(),
  /** Alunos inscritos na Física (repetidos na planilha contam uma vez). */
  alunos: z.number().int(),
  /** Em ordem de código, com a quantidade de alunos de cada uma. */
  turmas: z.array(z.object({ codigo: z.string(), alunos: z.number().int() })),
});

export const edicaoCriadaSchema = z.object({
  edicao: z.object({
    id: z.number().int(),
    /** Calculado pela data limite: até junho, "AAAA/1"; depois, "AAAA/2". */
    semestre: z.string(),
    dataLimite: z.iso.datetime(),
    ativa: z.boolean(),
  }),
  fisicas: z.array(fisicaCriadaSchema),
  alunos: z.object({
    /** Cadastrados agora. */
    novos: z.number().int(),
    /** Já cadastrados em edições anteriores (mesmo curso + matrícula), com nome e senha atualizados. */
    reaproveitados: z.number().int(),
  }),
  /** A edição que estava ativa e foi finalizada (só uma fica ativa), ou `null`. */
  edicaoFinalizada: z.object({ id: z.number().int(), semestre: z.string() }).nullable(),
});

const edicaoSchema = z.object({
  id: z.number().int(),
  semestre: z.string(),
  dataLimite: z.iso.datetime(),
  ativa: z.boolean(),
});

/** Edições da mais recente para a mais antiga (para o seletor e o histórico). */
export const listaDeEdicoesSchema = z.array(
  edicaoSchema.extend({
    criadoEm: z.iso.datetime(),
    /** Quantidade de Físicas da edição. */
    fisicas: z.number().int(),
    /** Alunos inscritos em pelo menos uma Física (quem está em duas conta uma vez). */
    alunos: z.number().int(),
  }),
);

export const dashboardQuerySchema = z.object({
  /** Sem ele, a última edição criada (mesmo finalizada), como nas outras telas do admin. */
  edicaoId: z.coerce.number().int().positive().optional(),
});

export const dashboardSchema = z.object({
  /** Edição pedida (ou a última criada); `null` quando não existe nenhuma edição. */
  edicao: edicaoSchema.nullable(),
  /** Um card por Física, em ordem de código. */
  fisicas: z.array(
    z.object({
      id: z.number().int(),
      codigo: z.string(),
      nome: z.string(),
      quantidadeGrupos: z.number().int(),
      minimoIntegrantes: z.number().int(),
      maximoIntegrantes: z.number().int(),
      multiturma: z.boolean(),
      /** Grupos que atingiram o mínimo de integrantes (o "14" de "14/20 grupos formados"). */
      gruposFormados: z.number().int(),
      /** Grupos criados que ainda estão abaixo do mínimo. */
      gruposNaoFormados: z.number().int(),
      /** Alunos inscritos na Física. */
      alunos: z.number().int(),
      alunosSemGrupo: z.number().int(),
    }),
  ),
});

export type AlunoDaPlanilha = z.infer<typeof alunoDaPlanilhaSchema>;
export type FisicaDaPlanilha = z.infer<typeof fisicaDaPlanilhaSchema>;
export type CriarEdicaoBody = z.infer<typeof criarEdicaoBodySchema>;
export type EdicaoCriada = z.infer<typeof edicaoCriadaSchema>;
export type ListaDeEdicoes = z.infer<typeof listaDeEdicoesSchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;
