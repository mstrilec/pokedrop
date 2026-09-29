-- AlterTable
ALTER TABLE "users" ADD COLUMN     "showCollectionValue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showSetCompletion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showcaseCardIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
