import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { erroSchema } from '../../shared/errors/schemas.js';
import { criarEdicaoBodySchema, edicaoCriadaSchema } from './schemas.js';
import { criarEdicao } from './service.js';

const somenteAdmin = { papeis: ['ADMIN' as const] };

/** A planilha inteira vai no corpo: o limite padrão do Fastify (1 MB) é curto para ela. */
const LIMITE_DO_CORPO = 5 * 1024 * 1024;

/** Registrado com o prefixo `/admin/edicoes` (todas as rotas são só do admin). */
export const edicoesRoutes: FastifyPluginAsyncZod = async (app) => {
  const deps = { prisma: app.prisma };

  app.post(
    '',
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
