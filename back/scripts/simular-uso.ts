/**
 * Simulação de uso da API, como um teste manual: alunos e admin fazendo, em sequência, o que
 * as telas vão fazer, com os erros esperados de cada regra. Roda contra a API de
 * desenvolvimento já no ar (`npm run dev`), sobre o seed de demonstração.
 *
 * Uso (em back/, com o Docker e o `npm run dev` rodando): npm run simular
 *
 * Recria o seed DEMO no início e no fim (`npm run db:seed:demo`), então o banco de
 * desenvolvimento volta ao estado do seed. Só para desenvolvimento. Ver back/README.md.
 */
import '../src/config/zod.js';
import { execSync } from 'node:child_process';
import type { z } from 'zod';
import { criarPrismaClient } from '../src/lib/prisma.js';
import type { alunoDaEdicaoSchema, alunosDaEdicaoSchema } from '../src/modules/alunos/schemas.js';
import type { loginRespostaSchema, usuarioSchema } from '../src/modules/auth/schemas.js';
import type { duvidaSchema } from '../src/modules/duvidas/schemas.js';
import type {
  dashboardSchema,
  edicaoCriadaSchema,
  listaDeEdicoesSchema,
} from '../src/modules/edicoes/schemas.js';
import type {
  alunoResumoSchema,
  grupoSchema,
  gruposDaEdicaoSchema,
  minhasFisicasSchema,
  remocaoDeIntegranteSchema,
} from '../src/modules/grupos/schemas.js';
import type { erroSchema } from '../src/shared/errors/schemas.js';

type Erro = z.infer<typeof erroSchema>;
type Login = z.infer<typeof loginRespostaSchema>;
type Usuario = z.infer<typeof usuarioSchema>;
type Grupo = z.infer<typeof grupoSchema>;
type AlunoResumo = z.infer<typeof alunoResumoSchema>;
type MinhasFisicas = z.infer<typeof minhasFisicasSchema>;
type GruposDaEdicao = z.infer<typeof gruposDaEdicaoSchema>;
type Remocao = z.infer<typeof remocaoDeIntegranteSchema>;
type AlunosDaEdicao = z.infer<typeof alunosDaEdicaoSchema>;
type AlunoDaEdicao = z.infer<typeof alunoDaEdicaoSchema>;
type ListaDeEdicoes = z.infer<typeof listaDeEdicoesSchema>;
type Dashboard = z.infer<typeof dashboardSchema>;
type EdicaoCriada = z.infer<typeof edicaoCriadaSchema>;
type Duvida = z.infer<typeof duvidaSchema>;

const API = process.env.SIMULAR_URL ?? 'http://127.0.0.1:3333';
/** Semestre da edição criada no fim; bem no futuro para não colidir com uma edição real. */
const DATA_DA_EDICAO_NOVA = '2099-03-10';
const SEMESTRE_NOVO = '2099/1';
/** Matrículas dos alunos novos da planilha simulada, apagados na limpeza. */
const MATRICULAS_NOVAS = ['99001', '99002'];
/** Matrículas dos alunos que a simulação cadastra pela API (Zélia e os Extras), apagados na limpeza. */
const MATRICULAS_ADICIONADAS = ['5001', '6001', '6002', '6003', '6004'];

// ---------------------------------------------------------------- infraestrutura

let passos = 0;
const falhas: string[] = [];

function secao(titulo: string) {
  console.log(`\n${titulo}`);
}

function passo(nome: string, ok: boolean, detalhe?: unknown) {
  passos += 1;
  if (ok) {
    console.log(`  ok    ${nome}`);
    return;
  }
  falhas.push(nome);
  const texto = detalhe === undefined ? '' : ` → ${JSON.stringify(detalhe).slice(0, 300)}`;
  console.log(`  FALHA ${nome}${texto}`);
}

type Resposta<T> = { status: number; corpo: T };

async function chamar<T = unknown>(
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
  caminho: string,
  { token, corpo }: { token?: string; corpo?: unknown } = {},
): Promise<Resposta<T>> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const resposta = await fetch(API + caminho, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: (texto ? JSON.parse(texto) : null) as T };
}

/** Código do erro da resposta (`erro.codigo`), ou `undefined` se não é erro. */
function codigo(resposta: Resposta<unknown>) {
  return (resposta.corpo as Partial<Erro> | null)?.erro?.codigo;
}

/** O item precisa existir para o cenário continuar; sem ele, a simulação para. */
function achar<T>(itens: readonly T[], condicao: (item: T) => boolean, descricao: string): T {
  const item = itens.find(condicao);
  if (item === undefined) {
    throw new Error(`Não encontrei ${descricao}.`);
  }
  return item;
}

type Sessao = Usuario & { token: string };

async function entrar(login: string, senha: string): Promise<Sessao> {
  const resposta = await chamar<Login>('POST', '/auth/login', { corpo: { login, senha } });
  if (codigo(resposta) === 'MUITAS_TENTATIVAS') {
    throw new Error(
      `Limite de logins de ${login} atingido (10 por minuto). Aguarde um minuto e rode de novo.`,
    );
  }
  if (resposta.status !== 200) {
    throw new Error(`Login de ${login} falhou: ${JSON.stringify(resposta.corpo)}`);
  }
  return { ...resposta.corpo.usuario, token: resposta.corpo.token };
}

const primeiroNome = (nome: string) => nome.split(' ')[0];

// ---------------------------------------------------------------- cenários

/** Ids das Físicas da edição ativa (DEMO) pelo código, lidos como o admin. */
async function fisicasDaDemo(admin: Sessao) {
  const { corpo } = await chamar<GruposDaEdicao>('GET', '/admin/grupos', { token: admin.token });
  const id = (codigoDaFisica: string) =>
    achar(corpo.fisicas, (f) => f.codigo === codigoDaFisica, `a Física ${codigoDaFisica}`).id;
  return { F01: id('F01'), F02: id('F02'), F03: id('F03') };
}

async function loginESessao() {
  secao('Login e sessão (aluno)');
  // Cada aluno entra no máximo duas vezes por rodada: o login tem limite de 10 tentativas por
  // minuto por IP + login, e a simulação pode ser repetida em seguida.
  let r = await chamar('POST', '/auth/login', { corpo: { login: 'GEC9012', senha: 'errada' } });
  passo('senha errada → 401 CREDENCIAIS_INVALIDAS', codigo(r) === 'CREDENCIAIS_INVALIDAS', r);
  r = await chamar('POST', '/auth/login', { corpo: { login: 'XYZ1', senha: 'ana' } });
  passo('login inexistente → 401 com a mesma mensagem', codigo(r) === 'CREDENCIAIS_INVALIDAS', r);
  r = await chamar<Login>('POST', '/auth/login', {
    corpo: { login: ' gec 9020 ', senha: 'úrsula' },
  });
  passo('login com espaços e minúsculas, senha com acento (Úrsula) → 200', r.status === 200, r);
  const fabio = await entrar('GEC9006', 'fabio');
  const me = await chamar<Usuario>('GET', '/auth/me', { token: fabio.token });
  passo(
    '/auth/me traz o nome e o papel',
    me.corpo.nome === 'Fábio Nunes' && me.corpo.papel === 'ALUNO',
    me,
  );
  r = await chamar('GET', '/admin/dashboard', { token: fabio.token });
  passo('aluno numa rota do admin → 403 SEM_PERMISSAO', codigo(r) === 'SEM_PERMISSAO', r);
  r = await chamar('GET', '/fisicas/minhas');
  passo('sem token → 401', r.status === 401, r);
  return fabio;
}

async function fluxoDoAluno(fisicas: { F01: number; F02: number }, fabio: Sessao) {
  secao('Dashboard do aluno (Fábio)');
  const minhas = await chamar<MinhasFisicas>('GET', '/fisicas/minhas', { token: fabio.token });
  const f01 = minhas.corpo.fisicas.find((f) => f.codigo === 'F01');
  const f02 = minhas.corpo.fisicas.find((f) => f.codigo === 'F02');
  passo(
    'edição DEMO; F01 na turma A sem grupo; F02 no grupo 4',
    minhas.corpo.edicao?.semestre === 'DEMO' &&
      f01?.turma === 'A' &&
      f01.grupo === null &&
      f02?.grupo?.numero === 4,
    minhas,
  );

  secao('Entrar num grupo');
  const paraEntrar = await chamar<Grupo[]>('GET', `/fisicas/${fisicas.F01}/grupos`, {
    token: fabio.token,
  });
  passo(
    'só aparecem grupos da turma A com vaga (o Grupo 1)',
    paraEntrar.corpo.map((g) => g.numero).join() === '1',
    paraEntrar.corpo.map((g) => g.numero),
  );
  const grupo1 = achar(paraEntrar.corpo, (g) => g.numero === 1, 'o Grupo 1 da F01');
  let r = await chamar<Grupo>('POST', `/grupos/${grupo1.id}/entrar`, { token: fabio.token });
  passo(
    'Fábio entra no Grupo 1 (Ana e Bruno) → 3 integrantes',
    r.corpo.integrantes?.length === 3,
    r,
  );
  r = await chamar('POST', `/grupos/${grupo1.id}/entrar`, { token: fabio.token });
  passo('clica de novo → 409 JA_EM_GRUPO', codigo(r) === 'JA_EM_GRUPO', r);

  secao('Criar um grupo (Gabriela, F01)');
  const gabriela = await entrar('GES9007', 'gabriela');
  r = await chamar('POST', `/grupos/${grupo1.id}/entrar`, { token: gabriela.token });
  passo('o Grupo 1 encheu → 409 GRUPO_CHEIO', codigo(r) === 'GRUPO_CHEIO', r);
  const colegas = (busca: string) =>
    chamar<AlunoResumo[]>(
      'GET',
      `/fisicas/${fisicas.F01}/colegas-disponiveis?busca=${encodeURIComponent(busca)}`,
      { token: gabriela.token },
    );
  const henrique = achar((await colegas('henri')).corpo, () => true, 'o Henrique na busca');
  const joao = achar((await colegas('joao')).corpo, () => true, 'o João na busca sem acento');
  passo(
    'busca "henri" e "joao" (sem acento) acham os colegas',
    henrique.nome === 'Henrique Alves' && joao.nome === 'João Pereira',
  );
  passo(
    'busca "nicolas" não acha o Nícolas (turma B)',
    (await colegas('nicolas')).corpo.length === 0,
  );
  passo(
    'busca "fabio" não acha o Fábio (já tem grupo)',
    (await colegas('fabio')).corpo.length === 0,
  );
  r = await chamar('POST', `/fisicas/${fisicas.F01}/grupos`, {
    token: gabriela.token,
    corpo: { colegas: [] },
  });
  passo('sozinha (mínimo 2) → 409 GRUPO_INCOMPLETO', codigo(r) === 'GRUPO_INCOMPLETO', r);
  r = await chamar('POST', `/fisicas/${fisicas.F01}/grupos`, {
    token: gabriela.token,
    corpo: { colegas: [gabriela.id] },
  });
  passo('incluindo a si mesma → 400 VALIDACAO', codigo(r) === 'VALIDACAO', r);
  const criado = await chamar<Grupo>('POST', `/fisicas/${fisicas.F01}/grupos`, {
    token: gabriela.token,
    corpo: { colegas: [henrique.id] },
  });
  passo(
    'com o Henrique → 201, Grupo 5 (menor número livre), formado',
    criado.status === 201 && criado.corpo.numero === 5 && criado.corpo.formado,
    criado,
  );
  const grupoDaGabi = criado.corpo;

  secao('Turma diferente e grupos de outros (Pedro, turma B)');
  const pedro = await entrar('GEC9016', 'pedro');
  r = await chamar('POST', `/grupos/${grupoDaGabi.id}/entrar`, { token: pedro.token });
  passo('grupo da turma A → 409 TURMA_DIFERENTE', codigo(r) === 'TURMA_DIFERENTE', r);
  const doPedro = await chamar<Grupo[]>('GET', `/fisicas/${fisicas.F01}/grupos`, {
    token: pedro.token,
  });
  const grupo4 = achar(doPedro.corpo, (g) => g.numero === 4, 'o Grupo 4 (Olívia)');
  r = await chamar<Grupo>('POST', `/grupos/${grupo4.id}/entrar`, { token: pedro.token });
  passo('entra no Grupo 4 (Olívia, abaixo do mínimo) → passa a formado', r.corpo.formado, r);
  r = await chamar('POST', `/grupos/${grupoDaGabi.id}/integrantes`, {
    token: pedro.token,
    corpo: { alunos: [joao.id] },
  });
  passo('adicionar colega num grupo que não é dele → 404', r.status === 404, r);

  secao('Adicionar colegas ao próprio grupo (Gabriela)');
  r = await chamar<Grupo>('POST', `/grupos/${grupoDaGabi.id}/integrantes`, {
    token: gabriela.token,
    corpo: { alunos: [joao.id] },
  });
  passo('adiciona o João → 3 integrantes', r.corpo.integrantes?.length === 3, r);
  const isabela = achar((await colegas('isabela')).corpo, () => true, 'a Isabela na busca');
  r = await chamar('POST', `/grupos/${grupoDaGabi.id}/integrantes`, {
    token: gabriela.token,
    corpo: { alunos: [isabela.id] },
  });
  passo('mais um passaria do máximo (3) → 409 GRUPO_CHEIO', codigo(r) === 'GRUPO_CHEIO', r);

  secao('Multiturma (Henrique, F02: mínimo 3, 4 de 5 grupos)');
  const henriqueSessao = await entrar('GEC9008', 'henrique');
  const daF02 = await chamar<AlunoResumo[]>('GET', `/fisicas/${fisicas.F02}/colegas-disponiveis`, {
    token: henriqueSessao.token,
  });
  const helena = achar(daF02.corpo, (a) => a.nome === 'Helena Correia', 'a Helena');
  const igor = achar(daF02.corpo, (a) => a.nome === 'Igor Santana', 'o Igor');
  passo('vê colegas da turma B (multiturma)', helena.turma === 'B' && igor.turma === 'B');
  r = await chamar('POST', `/fisicas/${fisicas.F02}/grupos`, {
    token: henriqueSessao.token,
    corpo: { colegas: [helena.id] },
  });
  passo('só com a Helena (2 de 3) → 409 GRUPO_INCOMPLETO', codigo(r) === 'GRUPO_INCOMPLETO', r);
  r = await chamar<Grupo>('POST', `/fisicas/${fisicas.F02}/grupos`, {
    token: henriqueSessao.token,
    corpo: { colegas: [helena.id, igor.id] },
  });
  passo('com Helena e Igor → 201, Grupo 5 de 5', r.status === 201 && r.corpo.numero === 5, r);

  secao('Logout (Fábio)');
  r = await chamar('POST', '/auth/logout', { token: fabio.token });
  passo('logout → 2xx', r.status >= 200 && r.status < 300, r);
  r = await chamar('GET', '/auth/me', { token: fabio.token });
  passo('o token antigo deixa de valer → 401', r.status === 401, r);
  const fabioDeNovo = await entrar('GEC9006', 'fabio');
  passo('entra de novo', fabioDeNovo.token.length > 0);

  return fabioDeNovo;
}

async function painelDoAdmin(admin: Sessao, fisicas: { F01: number; F02: number; F03: number }) {
  secao('Painel do admin');
  const edicoes = await chamar<ListaDeEdicoes>('GET', '/admin/edicoes', { token: admin.token });
  passo(
    'lista de edições: DEMO (ativa), DEMO 2025/2, DEMO 2025/1',
    edicoes.corpo.map((e) => `${e.semestre}:${e.ativa}`).join() ===
      'DEMO:true,DEMO 2025/2:false,DEMO 2025/1:false',
    edicoes.corpo,
  );
  const dash = await chamar<Dashboard>('GET', '/admin/dashboard', { token: admin.token });
  const card = (cod: string) => achar(dash.corpo.fisicas, (f) => f.codigo === cod, `o card ${cod}`);
  passo(
    'dashboard reflete os alunos: F01 5/9 formados, 0 abaixo do mínimo, 11 sem grupo',
    card('F01').gruposFormados === 5 &&
      card('F01').gruposNaoFormados === 0 &&
      card('F01').alunosSemGrupo === 11,
    card('F01'),
  );
  passo(
    'F02 5/5 formados, ninguém sem grupo',
    card('F02').gruposFormados === 5 && card('F02').alunosSemGrupo === 0,
    card('F02'),
  );
  const naoFormados = await chamar<GruposDaEdicao>('GET', '/admin/grupos?status=nao-formado', {
    token: admin.token,
  });
  passo(
    'lista de grupos, filtro "não formado" → nenhum',
    naoFormados.corpo.grupos.length === 0,
    naoFormados.corpo.grupos,
  );
  const alunos = await chamar<AlunosDaEdicao>('GET', '/admin/alunos', { token: admin.token });
  passo(
    'lista de alunos: 52 linhas (uma por aluno em cada Física)',
    alunos.corpo.alunos.length === 52,
    alunos.corpo.alunos.length,
  );
  const semGrupo = await chamar<AlunosDaEdicao>('GET', '/admin/alunos?status=sem-grupo', {
    token: admin.token,
  });
  passo(
    'filtro "sem grupo" → 20 (11 + 0 + 9)',
    semGrupo.corpo.alunos.length === 20,
    semGrupo.corpo.alunos.length,
  );

  secao('Admin monta e desmonta um grupo (F03)');
  const semGrupoF03 = (busca: string) =>
    chamar<AlunoResumo[]>(
      'GET',
      `/admin/fisicas/${fisicas.F03}/alunos-sem-grupo?busca=${encodeURIComponent(busca)}`,
      { token: admin.token },
    );
  const julia = achar((await semGrupoF03('julia')).corpo, () => true, 'a Júlia');
  const kevin = achar((await semGrupoF03('kevin')).corpo, () => true, 'o Kevin');
  const renato = achar((await semGrupoF03('renato')).corpo, () => true, 'o Renato');
  const criado = await chamar<Grupo>('POST', `/admin/fisicas/${fisicas.F03}/grupos`, {
    token: admin.token,
    corpo: { alunos: [julia.id] },
  });
  passo(
    'grupo só com a Júlia (o admin pode abaixo do mínimo) → 201, não formado',
    criado.status === 201 && !criado.corpo.formado,
    criado,
  );
  let r = await chamar('POST', `/grupos/${criado.corpo.id}/integrantes`, {
    token: admin.token,
    corpo: { alunos: [renato.id] },
  });
  passo('adiciona o Renato (turma B) → 409 TURMA_DIFERENTE', codigo(r) === 'TURMA_DIFERENTE', r);
  r = await chamar<Grupo>('POST', `/grupos/${criado.corpo.id}/integrantes`, {
    token: admin.token,
    corpo: { alunos: [kevin.id] },
  });
  passo('adiciona o Kevin → formado', (r.corpo as Grupo).formado, r);
  let remocao = await chamar<Remocao>(
    'DELETE',
    `/admin/grupos/${criado.corpo.id}/integrantes/${kevin.id}`,
    { token: admin.token },
  );
  passo('remove o Kevin → volta a não formado', remocao.corpo.grupo?.formado === false, remocao);
  remocao = await chamar<Remocao>(
    'DELETE',
    `/admin/grupos/${criado.corpo.id}/integrantes/${julia.id}`,
    { token: admin.token },
  );
  passo(
    'remove a Júlia, a última → grupo apagado (grupo: null)',
    remocao.status === 200 && remocao.corpo.grupo === null,
    remocao,
  );
}

async function alunosDoAdmin(admin: Sessao, fisicas: { F01: number; F02: number; F03: number }) {
  secao('Admin adiciona alunos (fora da planilha)');
  const adicionar = (fisicaId: number, corpo: object) =>
    chamar<AlunoDaEdicao>('POST', `/admin/fisicas/${fisicaId}/alunos`, {
      token: admin.token,
      corpo,
    });
  let r = await adicionar(fisicas.F03, {
    curso: 'ges',
    matricula: ' 50 01 ',
    nome: ' Zélia  Prado ',
    turma: 'c',
  });
  passo(
    'aluna nova na F03 → 201, normalizada (GES5001, "Zélia Prado", turma C)',
    r.status === 201 &&
      r.corpo.matricula === '5001' &&
      r.corpo.nome === 'Zélia Prado' &&
      r.corpo.turma === 'C',
    r,
  );
  passo(
    'a Zélia já entra com GES5001 / zelia',
    (await entrar('GES5001', 'zelia')).nome === 'Zélia Prado',
  );
  r = await adicionar(fisicas.F03, {
    curso: 'GES',
    matricula: '5001',
    nome: 'Zélia Prado',
    turma: 'A',
  });
  passo('de novo na F03 → 409 JA_INSCRITO', codigo(r) === 'JA_INSCRITO', r);
  r = await adicionar(fisicas.F03, { curso: 'GES', matricula: '5002', nome: 'Teste', turma: 'Z' });
  passo('turma que não existe → 400, com as turmas válidas', codigo(r) === 'VALIDACAO', r);

  secao('Limite de grupos e capacidade (F02: 5 grupos de até 4, 19 alunos)');
  for (const matricula of ['6001', '6002', '6003']) {
    r = await adicionar(fisicas.F02, {
      curso: 'GEC',
      matricula,
      nome: `Extra ${matricula}`,
      turma: 'A',
    });
    passo(`adiciona o Extra ${matricula} na F02`, r.status === 201, r);
  }
  const extra = await entrar('GEC6001', 'extra');
  const outros = await chamar<AlunoResumo[]>(
    'GET',
    `/fisicas/${fisicas.F02}/colegas-disponiveis?busca=extra`,
    {
      token: extra.token,
    },
  );
  r = await chamar('POST', `/fisicas/${fisicas.F02}/grupos`, {
    token: extra.token,
    corpo: { colegas: outros.corpo.map((a) => a.id) },
  });
  passo('os 5 grupos já existem → 409 LIMITE_DE_GRUPOS', codigo(r) === 'LIMITE_DE_GRUPOS', r);
  r = await adicionar(fisicas.F02, {
    curso: 'GEC',
    matricula: '6004',
    nome: 'Extra 6004',
    turma: 'B',
  });
  passo('20º aluno ainda cabe → 201', r.status === 201, r);
  r = await adicionar(fisicas.F02, {
    curso: 'GEC',
    matricula: '6005',
    nome: 'Extra 6005',
    turma: 'B',
  });
  passo('21º não cabe (5 × 4 = 20) → 409 FISICA_LOTADA', codigo(r) === 'FISICA_LOTADA', r);

  secao('Admin edita alunos');
  const lista = await chamar<AlunosDaEdicao>('GET', '/admin/alunos', { token: admin.token });
  const linha = (nome: string, fis: string) =>
    achar(
      lista.corpo.alunos,
      (a) => a.nome === nome && a.fisica.codigo === fis,
      `${nome} na ${fis}`,
    );
  const isabela = linha('Isabela Costa', 'F01');
  const sessaoDaIsabela = await entrar('GES9009', 'isabela');
  const editar = (fisicaId: number, alunoId: number, corpo: object) =>
    chamar<AlunoDaEdicao>('PUT', `/admin/fisicas/${fisicaId}/alunos/${alunoId}`, {
      token: admin.token,
      corpo,
    });
  r = await editar(fisicas.F01, isabela.id, {
    curso: 'GES',
    matricula: '9009',
    nome: 'Isabel Costa',
    turma: 'B',
  });
  passo(
    'Isabela (sem grupo na F01): nome novo e turma B → 200',
    r.status === 200 && r.corpo.turma === 'B',
    r,
  );
  const senhaNova = await chamar('POST', '/auth/login', {
    corpo: { login: 'GES9009', senha: 'isabel' },
  });
  const senhaVelha = await chamar('POST', '/auth/login', {
    corpo: { login: 'GES9009', senha: 'isabela' },
  });
  passo(
    'a senha passa a ser "isabel"; "isabela" não entra mais',
    senhaNova.status === 200 && senhaVelha.status === 401,
  );
  passo(
    'a sessão aberta dela continua',
    (await chamar('GET', '/auth/me', { token: sessaoDaIsabela.token })).status === 200,
  );
  const ana = linha('Ana Souza', 'F01');
  r = await editar(fisicas.F01, ana.id, {
    curso: 'GES',
    matricula: '9001',
    nome: 'Ana Souza',
    turma: 'B',
  });
  passo('Ana (em grupo) para outra turma → 409 ALUNO_EM_GRUPO', codigo(r) === 'ALUNO_EM_GRUPO', r);
  r = await editar(fisicas.F01, ana.id, {
    curso: 'GES',
    matricula: '9003',
    nome: 'Ana Souza',
    turma: 'A',
  });
  passo('Ana com a matrícula da Carla → 409 LOGIN_EXISTENTE', codigo(r) === 'LOGIN_EXISTENTE', r);

  secao('Admin tira alunos da Física');
  const remover = (fisicaId: number, alunoId: number) =>
    chamar<Remocao>('DELETE', `/admin/fisicas/${fisicaId}/alunos/${alunoId}`, {
      token: admin.token,
    });
  let remocao = await remover(fisicas.F01, linha('Carla Dias', 'F01').id);
  passo(
    'Carla sai da F01 → o Grupo 2 fica com Diego e Elisa',
    remocao.corpo.grupo?.integrantes.map((i) => primeiroNome(i.nome)).join() === 'Diego,Elisa',
    remocao,
  );
  const carla = await chamar<AlunosDaEdicao>('GET', '/admin/alunos?busca=carla', {
    token: admin.token,
  });
  passo(
    'Carla continua na F02',
    carla.corpo.alunos.map((a) => a.fisica.codigo).join() === 'F02',
    carla.corpo.alunos,
  );
  remocao = await remover(fisicas.F01, linha('Pedro Gomes', 'F01').id);
  passo(
    'Pedro sai do Grupo 4 → Olívia fica sozinha (não formado)',
    remocao.corpo.grupo?.formado === false,
    remocao,
  );
  remocao = await remover(fisicas.F01, linha('Olívia Cardoso', 'F01').id);
  passo(
    'Olívia, a última → grupo apagado (grupo: null)',
    remocao.status === 200 && remocao.corpo.grupo === null,
    remocao,
  );
  remocao = await remover(fisicas.F01, linha('Olívia Cardoso', 'F01').id);
  passo('de novo → 404', remocao.status === 404, remocao);
  passo(
    'a Olívia ainda entra no sistema (o cadastro continua)',
    (await entrar('GES9015', 'olivia')).nome === 'Olívia Cardoso',
  );
}

async function edicaoAntiga(admin: Sessao) {
  secao('Admin ajusta a edição finalizada DEMO 2025/2 (depois do prazo)');
  const edicoes = await chamar<ListaDeEdicoes>('GET', '/admin/edicoes', { token: admin.token });
  const antiga = achar(edicoes.corpo, (e) => e.semestre === 'DEMO 2025/2', 'a DEMO 2025/2');
  const grupos = await chamar<GruposDaEdicao>(
    'GET',
    `/admin/grupos?edicaoId=${antiga.id}&status=nao-formado`,
    { token: admin.token },
  );
  const grupo = achar(grupos.corpo.grupos, () => true, 'o grupo abaixo do mínimo da 2025/2');
  passo(
    'acha o grupo abaixo do mínimo (Rafaela sozinha)',
    grupo.integrantes.map((i) => i.nome).join() === 'Rafaela Moura',
    grupo,
  );
  const fis1 = achar(grupos.corpo.fisicas, (f) => f.codigo === 'Fis1', 'a Fis1 da 2025/2');
  const samuel = achar(
    (
      await chamar<AlunoResumo[]>(
        'GET',
        `/admin/fisicas/${fis1.id}/alunos-sem-grupo?busca=samuel`,
        {
          token: admin.token,
        },
      )
    ).corpo,
    () => true,
    'o Samuel',
  );
  let r = await chamar<Grupo>('POST', `/grupos/${grupo.id}/integrantes`, {
    token: admin.token,
    corpo: { alunos: [samuel.id] },
  });
  passo('adiciona o Samuel → formado (o admin não tem prazo)', r.corpo.formado, r);
  const dash = await chamar<Dashboard>('GET', `/admin/dashboard?edicaoId=${antiga.id}`, {
    token: admin.token,
  });
  const card = achar(dash.corpo.fisicas, (f) => f.codigo === 'Fis1', 'o card Fis1');
  passo(
    'dashboard da 2025/2: Fis1 7/7 formados',
    card.gruposFormados === 7 && card.quantidadeGrupos === 7,
    card,
  );
  r = await chamar('POST', `/admin/fisicas/${fis1.id}/alunos`, {
    token: admin.token,
    corpo: { curso: 'GES', matricula: '5003', nome: 'Teste', turma: 'A' },
  });
  passo('adicionar aluno numa edição que não é a atual → 404', r.status === 404, r);
}

async function duvidas(admin: Sessao, aluno: Sessao) {
  secao('Dúvidas frequentes');
  const antes = await chamar<Duvida[]>('GET', '/duvidas', { token: aluno.token });
  passo('aluno consulta a lista → 200', antes.status === 200, antes);
  const criar = (pergunta: string) =>
    chamar<Duvida>('POST', '/duvidas', {
      token: admin.token,
      corpo: { pergunta, resposta: 'Resposta da simulação.' },
    });
  const d1 = await criar('Simulação: como entro num grupo?');
  const d2 = await criar('Simulação: até quando posso formar grupo?');
  passo('admin cria duas dúvidas → 201', d1.status === 201 && d2.status === 201, [d1, d2]);
  let r = await chamar('POST', '/duvidas', {
    token: aluno.token,
    corpo: { pergunta: 'x', resposta: 'y' },
  });
  passo('aluno tentando criar → 403', r.status === 403, r);
  r = await chamar('POST', '/duvidas', {
    token: admin.token,
    corpo: { pergunta: ' ', resposta: 'y' },
  });
  passo('pergunta vazia → 400 VALIDACAO', codigo(r) === 'VALIDACAO', r);
  r = await chamar<Duvida>('PUT', `/duvidas/${d1.corpo.id}`, {
    token: admin.token,
    corpo: {
      pergunta: 'Simulação: como entro num grupo existente?',
      resposta: 'Pela tela Montar Grupo.',
    },
  });
  passo('admin edita uma → 200', r.status === 200, r);
  const ids = (await chamar<Duvida[]>('GET', '/duvidas', { token: admin.token })).corpo.map(
    (d) => d.id,
  );
  r = await chamar('PUT', '/duvidas/ordem', {
    token: admin.token,
    corpo: { ids: [...ids].reverse() },
  });
  passo('reordena (invertendo) → 2xx', r.status >= 200 && r.status < 300, r);
  const invertida = (await chamar<Duvida[]>('GET', '/duvidas', { token: aluno.token })).corpo.map(
    (d) => d.id,
  );
  passo('o aluno vê a nova ordem', invertida.join() === [...ids].reverse().join(), invertida);
  r = await chamar('PUT', '/duvidas/ordem', { token: admin.token, corpo: { ids: ids.slice(1) } });
  passo(
    'lista de ordem incompleta → 409 ORDEM_DESATUALIZADA',
    codigo(r) === 'ORDEM_DESATUALIZADA',
    r,
  );
  // Limpeza: volta à ordem original e apaga as dúvidas da simulação.
  await chamar('PUT', '/duvidas/ordem', { token: admin.token, corpo: { ids } });
  for (const duvida of [d1, d2]) {
    r = await chamar('DELETE', `/duvidas/${duvida.corpo.id}`, { token: admin.token });
    passo(`apaga a dúvida ${duvida.corpo.id}`, r.status >= 200 && r.status < 300, r);
  }
  r = await chamar('DELETE', `/duvidas/${d1.corpo.id}`, { token: admin.token });
  passo('apagar de novo → 404', r.status === 404, r);
}

async function prazoEncerrado(admin: Sessao, fisicas: { F03: number }) {
  secao('Prazo encerrado (a data limite da DEMO é movida para o passado)');
  const prisma = criarPrismaClient(process.env.DATABASE_URL ?? '');
  try {
    await prisma.edicao.update({
      where: { semestre: 'DEMO' },
      data: { dataLimite: new Date(Date.now() - 60_000) },
    });
  } finally {
    await prisma.$disconnect();
  }
  const kevin = await entrar('GEC9034', 'kevin');
  const semGrupo = await chamar<AlunoResumo[]>(
    'GET',
    `/admin/fisicas/${fisicas.F03}/alunos-sem-grupo?busca=larissa`,
    { token: admin.token },
  );
  const larissa = achar(semGrupo.corpo, () => true, 'a Larissa');
  let r = await chamar('POST', `/fisicas/${fisicas.F03}/grupos`, {
    token: kevin.token,
    corpo: { colegas: [larissa.id] },
  });
  passo(
    'aluno criando grupo depois do prazo → 409 PRAZO_ENCERRADO',
    codigo(r) === 'PRAZO_ENCERRADO',
    r,
  );
  r = await chamar<Grupo>('POST', `/admin/fisicas/${fisicas.F03}/grupos`, {
    token: admin.token,
    corpo: { alunos: [larissa.id] },
  });
  passo('o admin ainda cria o grupo → 201', r.status === 201, r);
  const grupo = r.corpo as Grupo;
  r = await chamar('POST', `/grupos/${grupo.id}/entrar`, { token: kevin.token });
  passo('aluno entrando depois do prazo → 409 PRAZO_ENCERRADO', codigo(r) === 'PRAZO_ENCERRADO', r);
}

async function edicaoNova(admin: Sessao) {
  secao(`Admin cria a edição ${SEMESTRE_NOVO} pela planilha`);
  const aluno = (curso: string, matricula: string, nome: string, turma: string) => ({
    curso,
    matricula,
    nome,
    turma,
  });
  const fisica = (codigoDaAba: string, alunos: ReturnType<typeof aluno>[], extra: object = {}) => ({
    codigo: codigoDaAba,
    quantidadeGrupos: 3,
    minimoIntegrantes: 2,
    maximoIntegrantes: 3,
    multiturma: false,
    alunos,
    ...extra,
  });
  const comErros = await chamar<Erro>('POST', '/admin/edicoes', {
    token: admin.token,
    corpo: {
      dataLimite: DATA_DA_EDICAO_NOVA,
      fisicas: [
        fisica('Fis1', [
          aluno('GES', MATRICULAS_NOVAS[0]!, 'Nova Aluna', 'A'),
          aluno('GES', MATRICULAS_NOVAS[0]!, 'Nova Aluna', 'B'),
        ]),
        fisica('Fis2', [], { minimoIntegrantes: 4 }),
      ],
    },
  });
  passo(
    'planilha com erros → 400 com todos os problemas de uma vez',
    codigo(comErros) === 'VALIDACAO' && (comErros.corpo.erro.detalhes?.length ?? 0) >= 3,
    comErros.corpo.erro?.detalhes,
  );
  let edicoes = await chamar<ListaDeEdicoes>('GET', '/admin/edicoes', { token: admin.token });
  passo(
    'nada foi gravado: a DEMO continua ativa',
    edicoes.corpo[0]?.semestre === 'DEMO' && edicoes.corpo[0].ativa,
    edicoes.corpo[0],
  );

  const valida = {
    dataLimite: DATA_DA_EDICAO_NOVA,
    fisicas: [
      fisica('Fis1', [
        aluno('GES', '9001', 'Ana Souza Lima', 'A'),
        aluno('GES', MATRICULAS_NOVAS[0]!, 'Nova Aluna', 'A'),
        aluno('gec', ` ${MATRICULAS_NOVAS[1]!} `, 'Novo  Aluno', 'b'),
      ]),
    ],
  };
  const criada = await chamar<EdicaoCriada>('POST', '/admin/edicoes', {
    token: admin.token,
    corpo: valida,
  });
  passo(
    `cria a ${SEMESTRE_NOVO} → 201; 2 alunos novos, 1 reaproveitado; a DEMO é finalizada`,
    criada.status === 201 &&
      criada.corpo.edicao.semestre === SEMESTRE_NOVO &&
      criada.corpo.alunos.novos === 2 &&
      criada.corpo.alunos.reaproveitados === 1 &&
      criada.corpo.edicaoFinalizada?.semestre === 'DEMO',
    criada,
  );
  const repetida = await chamar('POST', '/admin/edicoes', { token: admin.token, corpo: valida });
  passo(
    'mesmo semestre de novo → 409 SEMESTRE_EXISTENTE',
    codigo(repetida) === 'SEMESTRE_EXISTENTE',
    repetida,
  );

  const ana = await entrar('GES9001', 'ana');
  const minhas = await chamar<MinhasFisicas>('GET', '/fisicas/minhas', { token: ana.token });
  passo(
    `a Ana (reaproveitada) vê a ${SEMESTRE_NOVO}, só com a Fis1`,
    minhas.corpo.edicao?.semestre === SEMESTRE_NOVO &&
      minhas.corpo.fisicas.map((f) => f.codigo).join() === 'Fis1',
    minhas.corpo,
  );
  const novo = await entrar(`GEC${MATRICULAS_NOVAS[1]!}`, 'novo');
  passo('o aluno novo entra com o login normalizado', novo.nome === 'Novo Aluno');
  edicoes = await chamar<ListaDeEdicoes>('GET', '/admin/edicoes', { token: admin.token });
  passo(
    `lista de edições: ${SEMESTRE_NOVO} ativa primeiro, DEMO finalizada`,
    edicoes.corpo
      .slice(0, 2)
      .map((e) => `${e.semestre}:${e.ativa}`)
      .join() === `${SEMESTRE_NOVO}:true,DEMO:false`,
    edicoes.corpo,
  );
  const alunos = await chamar<AlunosDaEdicao>('GET', '/admin/alunos', { token: admin.token });
  passo(
    'a lista de alunos passa a mostrar a edição nova (3 linhas)',
    alunos.corpo.edicao?.semestre === SEMESTRE_NOVO && alunos.corpo.alunos.length === 3,
    alunos.corpo.alunos,
  );
}

// ---------------------------------------------------------------- execução

function recriarSeed() {
  execSync('npm run db:seed:demo', { stdio: 'ignore' });
}

/**
 * Apaga o que a simulação criou fora do seed: a edição nova (sem ela, o seed recusa rodar, porque
 * ela fica ativa) e os alunos cadastrados durante a simulação.
 */
async function apagarEdicaoNova() {
  const prisma = criarPrismaClient(process.env.DATABASE_URL ?? '');
  try {
    await prisma.$transaction(async (tx) => {
      const edicao = { semestre: SEMESTRE_NOVO };
      // Desvincular antes: a FK do grupo na inscrição é RESTRICT.
      await tx.inscricao.updateMany({ where: { fisica: { edicao } }, data: { grupoId: null } });
      await tx.edicao.deleteMany({ where: edicao });
      await tx.usuario.deleteMany({
        where: { matricula: { in: [...MATRICULAS_NOVAS, ...MATRICULAS_ADICIONADAS] } },
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('A simulação não roda em produção.');
  }
  const saude = await fetch(`${API}/health`).catch(() => null);
  if (!saude?.ok) {
    throw new Error(`A API não respondeu em ${API}. Rode \`npm run dev\` em outro terminal.`);
  }
  const { ADMIN_LOGIN, ADMIN_SENHA } = process.env;
  if (!ADMIN_LOGIN || !ADMIN_SENHA) {
    throw new Error('ADMIN_LOGIN e ADMIN_SENHA precisam estar no .env.');
  }

  const inicio = Date.now();
  console.log(`Simulação contra ${API}. Recriando o seed DEMO...`);
  await apagarEdicaoNova();
  recriarSeed();
  try {
    const admin = await entrar(ADMIN_LOGIN, ADMIN_SENHA);
    const fisicas = await fisicasDaDemo(admin);
    const fabio = await fluxoDoAluno(fisicas, await loginESessao());
    await painelDoAdmin(admin, fisicas);
    await alunosDoAdmin(admin, fisicas);
    await edicaoAntiga(admin);
    await duvidas(admin, fabio);
    await prazoEncerrado(admin, fisicas);
    await edicaoNova(admin);
  } catch (erro) {
    falhas.push('simulação interrompida');
    console.log(`\nSimulação interrompida: ${erro instanceof Error ? erro.message : String(erro)}`);
  } finally {
    console.log('\nLimpando: apagando a edição nova e recriando o seed DEMO...');
    await apagarEdicaoNova();
    recriarSeed();
  }

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`\n${passos - falhas.length} de ${passos} passos ok em ${segundos} s.`);
  if (falhas.length > 0) {
    console.log(`Falharam: ${falhas.join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
