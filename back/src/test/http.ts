import type { LightMyRequestResponse } from 'fastify';
import type { z } from 'zod';
import type { erroSchema } from '../shared/errors/schemas.js';

export type ErroResposta = z.infer<typeof erroSchema>;

/** Corpo de erro da API (`{ erro: { codigo, mensagem, detalhes? } }`), já tipado. */
export function erroDa(resposta: LightMyRequestResponse) {
  return resposta.json<ErroResposta>().erro;
}
