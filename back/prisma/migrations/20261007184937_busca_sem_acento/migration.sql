-- Busca por nome sem diferenciar acentos ("Joao" encontra "João"), usada com $queryRaw.
-- Manual: o schema do Prisma não declara a extensão (o recurso postgresqlExtensions é preview).
-- unaccent é "trusted" no PostgreSQL 13+: o dono do banco pode criá-la sem ser superusuário.
CREATE EXTENSION IF NOT EXISTS unaccent;
