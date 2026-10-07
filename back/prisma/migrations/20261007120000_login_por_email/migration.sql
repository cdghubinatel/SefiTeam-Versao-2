-- Login passa a ser o e-mail (obrigatório e único para todos os usuários).
-- Falha se houver usuário sem e-mail: em desenvolvimento, recrie o banco (prisma migrate reset).

-- DropIndex
DROP INDEX "usuario_login_key";

-- AlterTable
ALTER TABLE "usuario" DROP COLUMN "login",
ALTER COLUMN "email" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");
