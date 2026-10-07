import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export function criarPrismaClient(databaseUrl: string) {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Escapa os curingas do LIKE (`%`, `_`) para o texto ser buscado literalmente.
 * O `contains` do Prisma vira `ILIKE '%texto%'` no Postgres sem escapar o texto,
 * então uma busca por "%" listaria tudo. A barra invertida é o escape padrão do LIKE.
 */
export function escaparLike(texto: string) {
  return texto.replace(/[\\%_]/g, '\\$&');
}

/** `update`/`delete` do Prisma não encontrou o registro (código P2025). */
export function ehRegistroInexistente(erro: unknown) {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2025';
}
