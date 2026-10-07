import fastifyJwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../config/env.js';
import type { Papel } from '../generated/prisma/client.js';
import { SemPermissao, TokenAusente, TokenInvalido } from '../shared/errors/app-error.js';
import { SWAGGER_PREFIXO } from './swagger.js';

export type UsuarioAutenticado = {
  id: number;
  email: string;
  nome: string;
  papel: Papel;
};

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Rota acessível sem token. */
    publica?: boolean;
    /** Papéis permitidos; se omitido, qualquer usuário autenticado. */
    papeis?: Papel[];
  }

  interface FastifyRequest {
    usuario: UsuarioAutenticado;
  }
}

/** `versao` = `usuario.token_versao` na emissão; se o banco mudar, o token deixa de valer. */
export type TokenPayload = { sub: string; papel: Papel; versao: number };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
  }
}

function lerToken(request: FastifyRequest) {
  const [tipo, token] = request.headers.authorization?.split(' ') ?? [];
  return tipo === 'Bearer' && token ? token : null;
}

/**
 * Autenticação e autorização (ver docs/autenticacao.md).
 * Fechado por padrão: toda rota exige token, exceto as marcadas com `config.publica`.
 */
export default fp(
  async (app) => {
    await app.register(fastifyJwt, {
      secret: env.JWT_SECRET,
      sign: { expiresIn: env.JWT_EXPIRES_IN },
    });

    app.decorateRequest('usuario', null as unknown as UsuarioAutenticado);

    app.addHook('onRequest', async (request) => {
      const rota = request.routeOptions;

      // Rota inexistente (404), pública ou do Swagger: segue sem token.
      if (!rota.url || rota.config.publica || rota.url.startsWith(SWAGGER_PREFIXO)) {
        return;
      }

      const token = lerToken(request);
      if (!token) {
        throw new TokenAusente();
      }

      let payload: TokenPayload;
      try {
        payload = app.jwt.verify<TokenPayload>(token);
      } catch {
        throw new TokenInvalido();
      }

      // Busca no banco: garante que o usuário existe, que o token não foi revogado
      // (logout / nova senha incrementam token_versao) e usa o papel atual.
      const usuario = await app.prisma.usuario.findUnique({
        where: { id: Number(payload.sub) },
        select: { id: true, email: true, nome: true, papel: true, tokenVersao: true },
      });
      if (!usuario || usuario.tokenVersao !== payload.versao) {
        throw new TokenInvalido();
      }

      if (rota.config.papeis && !rota.config.papeis.includes(usuario.papel)) {
        throw new SemPermissao();
      }

      request.usuario = {
        id: usuario.id,
        email: usuario.email,
        nome: usuario.nome,
        papel: usuario.papel,
      };
    });
  },
  { name: 'auth', dependencies: ['prisma'] },
);
