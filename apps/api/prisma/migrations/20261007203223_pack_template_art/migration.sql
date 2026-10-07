-- AlterTable
ALTER TABLE "pack_templates" ADD COLUMN     "coverCardId" TEXT,
ADD COLUMN     "imageUrl" TEXT;

-- AddForeignKey
ALTER TABLE "pack_templates" ADD CONSTRAINT "pack_templates_coverCardId_fkey" FOREIGN KEY ("coverCardId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
