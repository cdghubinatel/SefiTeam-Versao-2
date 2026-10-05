-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "papel" AS ENUM ('ADMIN', 'ALUNO');

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "login" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "papel" "papel" NOT NULL,
    "curso" TEXT,
    "matricula" TEXT,
    "deve_trocar_senha" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edicao" (
    "id" SERIAL NOT NULL,
    "semestre" TEXT NOT NULL,
    "data_limite" TIMESTAMPTZ NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fisica" (
    "id" SERIAL NOT NULL,
    "edicao_id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "quantidade_grupos" INTEGER NOT NULL,
    "minimo_integrantes" INTEGER NOT NULL,
    "maximo_integrantes" INTEGER NOT NULL,
    "multiturma" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fisica_pkey" PRIMARY KEY ("id"),
    -- Manual: o Prisma não suporta CHECK no schema.
    CONSTRAINT "fisica_minimo_maximo_check" CHECK ("minimo_integrantes" <= "maximo_integrantes")
);

-- CreateTable
CREATE TABLE "turma" (
    "id" SERIAL NOT NULL,
    "fisica_id" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,

    CONSTRAINT "turma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupo" (
    "id" SERIAL NOT NULL,
    "fisica_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "criado_por_id" INTEGER,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscricao" (
    "id" SERIAL NOT NULL,
    "aluno_id" INTEGER NOT NULL,
    "fisica_id" INTEGER NOT NULL,
    "turma_id" INTEGER NOT NULL,
    "grupo_id" INTEGER,
    "entrou_no_grupo_em" TIMESTAMPTZ,

    CONSTRAINT "inscricao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duvida_frequente" (
    "id" SERIAL NOT NULL,
    "pergunta" TEXT NOT NULL,
    "resposta" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "duvida_frequente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_key" ON "usuario"("login");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_curso_matricula_key" ON "usuario"("curso", "matricula");

-- CreateIndex
CREATE UNIQUE INDEX "edicao_semestre_key" ON "edicao"("semestre");

-- CreateIndex
CREATE UNIQUE INDEX "edicao_unica_ativa" ON "edicao"("ativa") WHERE (ativa = true);

-- CreateIndex
CREATE UNIQUE INDEX "fisica_edicao_id_codigo_key" ON "fisica"("edicao_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "turma_fisica_id_codigo_key" ON "turma"("fisica_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "turma_id_fisica_id_key" ON "turma"("id", "fisica_id");

-- CreateIndex
CREATE UNIQUE INDEX "grupo_fisica_id_numero_key" ON "grupo"("fisica_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "grupo_id_fisica_id_key" ON "grupo"("id", "fisica_id");

-- CreateIndex
CREATE INDEX "inscricao_grupo_id_idx" ON "inscricao"("grupo_id");

-- CreateIndex
CREATE UNIQUE INDEX "inscricao_aluno_id_fisica_id_key" ON "inscricao"("aluno_id", "fisica_id");

-- AddForeignKey
ALTER TABLE "fisica" ADD CONSTRAINT "fisica_edicao_id_fkey" FOREIGN KEY ("edicao_id") REFERENCES "edicao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turma" ADD CONSTRAINT "turma_fisica_id_fkey" FOREIGN KEY ("fisica_id") REFERENCES "fisica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupo" ADD CONSTRAINT "grupo_fisica_id_fkey" FOREIGN KEY ("fisica_id") REFERENCES "fisica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupo" ADD CONSTRAINT "grupo_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_fisica_id_fkey" FOREIGN KEY ("fisica_id") REFERENCES "fisica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_turma_id_fisica_id_fkey" FOREIGN KEY ("turma_id", "fisica_id") REFERENCES "turma"("id", "fisica_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_grupo_id_fisica_id_fkey" FOREIGN KEY ("grupo_id", "fisica_id") REFERENCES "grupo"("id", "fisica_id") ON DELETE RESTRICT ON UPDATE CASCADE;
