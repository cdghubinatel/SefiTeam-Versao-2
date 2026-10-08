import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { AppError } from './app-error.js';

function statusDe(erro: unknown) {
  const status = (erro as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : 500;
}

export function registrarErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((erro, request, reply) => {
    if (erro instanceof AppError) {
      const { codigo, message: mensagem, detalhes } = erro;
      return reply
        .status(erro.statusCode)
        .send({ erro: detalhes ? { codigo, mensagem, detalhes } : { codigo, mensagem } });
    }

    if (hasZodFastifySchemaValidationErrors(erro)) {
      return reply.status(400).send({
        erro: {
          codigo: 'VALIDACAO',
          mensagem: 'Dados inválidos.',
          detalhes: erro.validation.map((item) => ({
            campo: item.instancePath.replace(/^\//, '').replaceAll('/', '.'),
            mensagem: item.message,
          })),
        },
      });
    }

    // Erros 4xx do próprio Fastify (JSON malformado, Content-Type não suportado, corpo grande demais...).
    const status = statusDe(erro);
    if (status >= 400 && status < 500) {
      return reply
        .status(status)
        .send({ erro: { codigo: 'REQUISICAO_INVALIDA', mensagem: 'Requisição inválida.' } });
    }

    request.log.error(erro);
    return reply
      .status(500)
      .send({ erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno do servidor.' } });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .status(404)
      .send({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' } });
  });
}
