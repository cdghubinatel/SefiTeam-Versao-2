import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Usuario } from '../generated/prisma/client.js';
import type { z } from 'zod';
import type { erroSchema } from '../shared/errors/schemas.js';

export type ErroResposta = z.infer<typeof erroSchema>;

/** Corpo de erro da API (`{ erro: { codigo, mensagem, detalhes? } }`), já tipado. */
export function erroDa(resposta: LightMyRequestResponse) {
  return resposta.json<ErroResposta>().erro;
}

/** Token válido do usuário, assinado pela própria app (como o login faria). */
export function tokenDe(app: FastifyInstance, usuario: Usuario) {
  return app.jwt.sign({
    sub: String(usuario.id),
    papel: usuario.papel,
    versao: usuario.tokenVersao,
  });
}

/** `app.inject` autenticado como o usuário; sem usuário, vai sem token. */
export function requisicaoComo(app: FastifyInstance, opcoes: InjectOptions, usuario?: Usuario) {
  return app.inject({
    ...opcoes,
    headers: usuario ? { authorization: `Bearer ${tokenDe(app, usuario)}` } : {},
  });
}
