import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import {
  criarEdicaoBodySchema,
  dashboardQuerySchema,
  dashboardSchema,
  edicaoCriadaSchema,
  listaDeEdicoesSchema,
} from './schemas.js';
import { criarEdicao, listarEdicoes, resumoDaEdicao } from './service.js';

const somenteAdmin = { papeis: ['ADMIN' as const] };

/** A planilha inteira vai no corpo: o limite padrão do Fastify (1 MB) é curto para ela. */
const LIMITE_DO_CORPO = 5 * 1024 * 1024;

/** Registrado com o prefixo `/admin`: as rotas ficam em `/admin/edicoes` e `/admin/dashboard` (só do admin). */
export const edicoesRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.get(
    '/edicoes',
    {
      config: somenteAdmin,
      schema: {
        tags: ['edicoes'],
        summary: 'Lista de edições',
        description:
          'Todas as edições, da mais recente para a mais antiga, para o seletor de edição e o histórico. `fisicas` e `alunos` são contagens; o aluno inscrito em duas Físicas conta uma vez. Sem paginação. Sem nenhuma edição, a lista vem vazia.',
        response: { 200: listaDeEdicoesSchema, 401: erroSchema, 403: erroSchema },
      },
    },
    async () => listarEdicoes(deps),
  );

  app.get(
    '/dashboard',
    {
      config: somenteAdmin,
      schema: {
        tags: ['edicoes'],
        summary: 'Dashboard do admin',
        description:
          'Um card por Física da edição (sem `edicaoId`, a última criada, mesmo finalizada), em ordem de código: configuração, grupos formados (atingiram o mínimo) e não formados, alunos e alunos sem grupo. O card mostra `gruposFormados`/`quantidadeGrupos`. Sem nenhuma edição: `edicao: null` e lista vazia. `404` se a edição pedida não existe.',
        querystring: dashboardQuerySchema,
        response: {
          200: dashboardSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          404: erroSchema,
        },
      },
    },
    async (request) => resumoDaEdicao(deps, request.query),
  );

  app.post(
    '/edicoes',
    {
      config: somenteAdmin,
      bodyLimit: LIMITE_DO_CORPO,
      schema: {
        tags: ['edicoes'],
        summary: 'Cria uma edição a partir da planilha',
        description:
          'Último passo do assistente: o front lê a planilha (uma aba por Física) e envia tudo de uma vez, com o prazo e a configuração de cada Física. A edição já nasce ativa e a que estava ativa é finalizada. O semestre é calculado pela data limite (até junho, `AAAA/1`; depois, `AAAA/2`), e o prazo vale até 23:59 desse dia (horário de Brasília). Alunos já cadastrados (mesmo curso + matrícula) são reaproveitados, com o nome e a senha atualizados. Erros: `400 VALIDACAO` com todos os problemas da planilha de uma vez em `detalhes` (`campo` = código da Física), `409 SEMESTRE_EXISTENTE`.',
        body: criarEdicaoBodySchema,
        response: {
          201: edicaoCriadaSchema,
          400: erroSchema,
          401: erroSchema,
          403: erroSchema,
          409: erroSchema,
        },
      },
    },
    async (request, reply) => {
      const criada = await criarEdicao(deps, request.body);
      return reply.status(201).send(criada);
    },
  );
};
