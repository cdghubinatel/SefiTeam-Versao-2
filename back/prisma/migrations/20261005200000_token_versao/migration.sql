-- AlterTable
ALTER TABLE "usuario" DROP COLUMN "deve_trocar_senha",
ADD COLUMN     "token_versao" INTEGER NOT NULL DEFAULT 0;
