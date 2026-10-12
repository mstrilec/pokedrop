-- CreateIndex
-- NULLS LAST is not expressible in schema.prisma; the price sorts order unpriced cards last.
CREATE INDEX "cards_latestPriceUsd_id_idx" ON "cards"("latestPriceUsd" DESC NULLS LAST, "id" DESC);
