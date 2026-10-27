-- Login passa a ser curso + matrícula (aluno) ou ADMIN_LOGIN (admin); o e-mail sai (a planilha não o traz).
-- SQL gerado com `prisma migrate diff` e completado à mão para preencher o login das linhas existentes.

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN "login" TEXT;

-- Mesma normalização de `loginDoAluno` (src/modules/auth/service.ts): sem espaços, em maiúsculas.
UPDATE "usuario"
SET "login" = UPPER(REGEXP_REPLACE("curso" || "matricula", '\s', '', 'g'))
WHERE "papel" = 'ALUNO';

-- Provisório: o `npm run db:seed` grava o ADMIN_LOGIN do .env no admin (existe um só).
UPDATE "usuario" SET "login" = 'ADMIN' WHERE "papel" = 'ADMIN';

-- A senha dos alunos já cadastrados continua a antiga (curso + matrícula) até serem
-- cadastrados de novo (upload da planilha ou `npm run db:seed:demo`): o hash não é recalculável em SQL.

-- AlterTable
ALTER TABLE "usuario" ALTER COLUMN "login" SET NOT NULL;

-- DropIndex
DROP INDEX "usuario_email_key";

-- AlterTable
ALTER TABLE "usuario" DROP COLUMN "email";

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_key" ON "usuario"("login");
