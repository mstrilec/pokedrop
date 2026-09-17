-- CreateIndex
CREATE UNIQUE INDEX "currency_transactions_userId_type_refId_key" ON "currency_transactions"("userId", "type", "refId");

