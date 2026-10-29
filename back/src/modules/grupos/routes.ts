import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import {
  adicionarIntegrantesBodySchema,
  alunoResumoSchema,
  alunosSemGrupoQuerySchema,
  colegasQuerySchema,
  criarGrupoBodySchema,
  criarGrupoComoAdminBodySchema,
  fisicaParamsSchema,
  grupoParamsSchema,
  grupoSchema,
  gruposDaEdicaoQuerySchema,
  gruposDaEdicaoSchema,
  integranteParamsSchema,
  minhasFisicasSchema,
  remocaoDeIntegranteSchema,
} from './schemas.js';
import {
  adicionarIntegrantesComoAdmin,
  adicionarIntegrantesComoAluno,
  criarGrupo,
  criarGrupoComoAdmin,
  entrarNoGrupo,
  listarAlunosSemGrupo,
  listarColegasDisponiveis,
  listarGruposDaEdicao,
  listarGruposParaEntrar,
  listarMinhasFisicas,
  removerIntegrante,
} from './service.js';

const somenteAluno = { papeis: ['ALUNO' as const] };
const somenteAdmin = { papeis: ['ADMIN' as const] };
const alunoOuAdmin = { papeis: ['ALUNO' as const, 'ADMIN' as const] };

/** Registrado sem prefixo: as rotas ficam em `/fisicas/...` e `/grupos/...`. */
export const gruposRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.get(
    '/fisicas/minhas',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Físicas do aluno na edição ativa',
        description:
          'Dashboard do aluno: cada Física em que ele está inscrito, com a turma e o grupo (ou `null`). Sem edição ativa, `edicao` é `null` e a lista vem vazia.',
        response: { 200: minhasFisicasSchema, 401: erroSchema, 403: erroSchema },
      },
    },
    async (request) => listarMinhasFisicas(deps, request.usuario.id),
  );

  app.get(
    '/fisicas/:fisicaId/grupos',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Grupos em que o aluno pode entrar',
        description:
          'Só os grupos com vaga e, sem multiturma, da turma do aluno. `409 JA_EM_GRUPO` se ele já tem grupo nesta Física. `404` se a Física não é da edição ativa ou o aluno não está inscrito nela.',
        params: fisicaParamsSchema,
        response: {
          200: z.array(grupoSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request) => listarGruposParaEntrar(deps, request.usuario.id, request.params.fisicaId),
  );

  app.get(
    '/fisicas/:fisicaId/colegas-disponiveis',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Colegas que o aluno pode incluir num grupo',
        description:
          'Inscritos na Física, sem grupo e, sem multiturma, da mesma turma; em ordem de nome. Serve para criar um grupo e para adicionar colegas ao grupo do aluno. `busca` filtra por parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos.',
        params: fisicaParamsSchema,
        querystring: colegasQuerySchema,
        response: {
          200: z.array(alunoResumoSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) =>
      listarColegasDisponiveis(
        deps,
        request.usuario.id,
        request.params.fisicaId,
        request.query.busca,
      ),
  );

  app.post(
    '/fisicas/:fisicaId/grupos',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Cria um grupo',
        description:
          'Quem cria entra no grupo, junto com os `colegas` escolhidos (ids de aluno), que entram sem precisar aceitar. O grupo já nasce formado: quem cria + colegas precisa atingir o mínimo de integrantes da Física. Recebe o menor número livre na Física. Erros `409`: `PRAZO_ENCERRADO`, `JA_EM_GRUPO` (o aluno ou um colega), `GRUPO_CHEIO`, `GRUPO_INCOMPLETO`, `TURMA_DIFERENTE`, `LIMITE_DE_GRUPOS`. `404` se a Física não é da edição ativa, se o aluno não está inscrito nela ou se um colega não está.',
        params: fisicaParamsSchema,
        body: criarGrupoBodySchema,
        response: {
          201: grupoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      const grupo = await criarGrupo(
        deps,
        request.usuario.id,
        request.params.fisicaId,
        request.body,
      );
      return reply.status(201).send(grupo);
    },
  );

  app.post(
    '/grupos/:grupoId/entrar',
    {
      config: somenteAluno,
      schema: {
        tags: ['grupos'],
        summary: 'Entra num grupo',
        description:
          'O aluno entra no grupo e recebe o grupo atualizado. Erros, na ordem: `404` (grupo inexistente, de edição inativa ou de Física em que o aluno não está inscrito), `409 PRAZO_ENCERRADO`, `409 JA_EM_GRUPO`, `409 GRUPO_CHEIO`, `409 TURMA_DIFERENTE`.',
        params: grupoParamsSchema,
        response: {
          200: grupoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request) => entrarNoGrupo(deps, request.usuario.id, request.params.grupoId),
  );

  app.post(
    '/grupos/:grupoId/integrantes',
    {
      config: alunoOuAdmin,
      schema: {
        tags: ['grupos'],
        summary: 'Adiciona integrantes a um grupo',
        description:
          'Os `alunos` (ids de aluno, inscritos na Física e sem grupo nela) entram no grupo, sem precisar aceitar; tudo ou nada. **Aluno:** só no grupo de que é integrante, na edição ativa, até o prazo; incluir o próprio id dá `400`. **Admin:** qualquer grupo, de qualquer edição, sem prazo. Os dois respeitam o máximo de integrantes e a turma. Erros, na ordem: `404` (grupo não encontrado; para o aluno, também se ele não é integrante), `409 PRAZO_ENCERRADO` (só aluno), `409 GRUPO_CHEIO`, `404` (aluno não inscrito na Física), `409 JA_EM_GRUPO`, `409 TURMA_DIFERENTE`.',
        params: grupoParamsSchema,
        body: adicionarIntegrantesBodySchema,
        response: {
          200: grupoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request) => {
      const { usuario, params, body } = request;
      return usuario.papel === 'ADMIN'
        ? adicionarIntegrantesComoAdmin(deps, params.grupoId, body)
        : adicionarIntegrantesComoAluno(deps, usuario.id, params.grupoId, body);
    },
  );

  app.delete(
    '/admin/grupos/:grupoId/integrantes/:alunoId',
    {
      config: somenteAdmin,
      schema: {
        tags: ['grupos'],
        summary: 'Remove um integrante do grupo',
        description:
          'Só admin, em qualquer edição e sem prazo. O aluno fica sem grupo nesta Física. O grupo pode ficar abaixo do mínimo (`formado: false`). Se era o último integrante, o grupo é apagado e a resposta traz `grupo: null`; os outros grupos não são renumerados. `404` se o grupo não existe ou se o aluno não é integrante dele.',
        params: integranteParamsSchema,
        response: {
          200: remocaoDeIntegranteSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) => removerIntegrante(deps, request.params.grupoId, request.params.alunoId),
  );

  app.get(
    '/admin/grupos',
    {
      config: somenteAdmin,
      schema: {
        tags: ['grupos'],
        summary: 'Lista de grupos do admin',
        description:
          'Grupos de uma edição (sem `edicaoId`, a última criada, mesmo finalizada), em ordem de Física e número, com todas as Físicas da edição (configuração e turmas, para os filtros). Filtros opcionais: `fisicaId` e `status` (`formado` | `nao-formado`). Sem paginação. Sem nenhuma edição: `edicao: null` e listas vazias. `404` se a edição pedida não existe ou se a Física não é dela.',
        querystring: gruposDaEdicaoQuerySchema,
        response: {
          200: gruposDaEdicaoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) => listarGruposDaEdicao(deps, request.query),
  );

  app.get(
    '/admin/fisicas/:fisicaId/alunos-sem-grupo',
    {
      config: somenteAdmin,
      schema: {
        tags: ['grupos'],
        summary: 'Alunos sem grupo numa Física',
        description:
          'Inscritos na Física (de qualquer edição) sem grupo, em ordem de nome. `busca` filtra por parte do nome ou da matrícula, sem diferenciar maiúsculas nem acentos; `turma` filtra pelo código da turma (ex.: `A`). Usada nos modais "Adicionar Aluno no Grupo" e "Adicionar Grupo". `404` se a Física não existe.',
        params: fisicaParamsSchema,
        querystring: alunosSemGrupoQuerySchema,
        response: {
          200: z.array(alunoResumoSchema),
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) => listarAlunosSemGrupo(deps, request.params.fisicaId, request.query),
  );

  app.post(
    '/admin/fisicas/:fisicaId/grupos',
    {
      config: somenteAdmin,
      schema: {
        tags: ['grupos'],
        summary: 'O admin cria um grupo',
        description:
          'Grupo com os `alunos` escolhidos (1 até o máximo da Física, sem exigir o mínimo), em qualquer edição e sem prazo. O admin fica como autor; o grupo recebe o menor número livre. Erros, na ordem: `404` (Física inexistente), `409 GRUPO_CHEIO`, `404` (aluno não inscrito na Física), `409 JA_EM_GRUPO`, `409 TURMA_DIFERENTE` (sem multiturma, alunos de turmas diferentes), `409 LIMITE_DE_GRUPOS`.',
        params: fisicaParamsSchema,
        body: criarGrupoComoAdminBodySchema,
        response: {
          201: grupoSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      const grupo = await criarGrupoComoAdmin(
        deps,
        request.usuario.id,
        request.params.fisicaId,
        request.body,
      );
      return reply.status(201).send(grupo);
    },
  );
};
