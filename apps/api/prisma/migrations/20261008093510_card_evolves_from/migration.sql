-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "evolvesFrom" TEXT;

-- CreateIndex
CREATE INDEX "cards_evolvesFrom_idx" ON "cards"("evolvesFrom");
