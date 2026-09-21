-- AlterTable
ALTER TABLE "price_snapshots" ADD COLUMN     "capturedOn" DATE NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "price_snapshots_cardId_source_capturedOn_key" ON "price_snapshots"("cardId", "source", "capturedOn");
