-- AlterEnum
ALTER TYPE "SyncKind" ADD VALUE 'PRICE_ACTIVE';

-- CreateIndex
CREATE INDEX "cards_priceUpdatedAt_idx" ON "cards"("priceUpdatedAt");

-- CreateIndex
CREATE INDEX "deck_cards_cardId_idx" ON "deck_cards"("cardId");

-- CreateIndex
CREATE INDEX "inventory_items_cardId_idx" ON "inventory_items"("cardId");

-- CreateIndex
CREATE INDEX "trade_items_cardId_idx" ON "trade_items"("cardId");
