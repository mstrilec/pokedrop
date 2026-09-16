-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lockedQuantity" INTEGER NOT NULL DEFAULT 0,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setFilter" JSONB NOT NULL,
    "cost" INTEGER NOT NULL,
    "slotConfig" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pack_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_openings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_opening_cards" (
    "id" TEXT NOT NULL,
    "packOpeningId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,

    CONSTRAINT "pack_opening_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "type" "TransactionType" NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_userId_cardId_key" ON "inventory_items"("userId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "pack_openings_openId_key" ON "pack_openings"("openId");

-- CreateIndex
CREATE INDEX "pack_openings_userId_createdAt_idx" ON "pack_openings"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "pack_opening_cards_packOpeningId_idx" ON "pack_opening_cards"("packOpeningId");

-- CreateIndex
CREATE INDEX "currency_transactions_userId_createdAt_idx" ON "currency_transactions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_openings" ADD CONSTRAINT "pack_openings_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "pack_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_opening_cards" ADD CONSTRAINT "pack_opening_cards_packOpeningId_fkey" FOREIGN KEY ("packOpeningId") REFERENCES "pack_openings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_opening_cards" ADD CONSTRAINT "pack_opening_cards_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_transactions" ADD CONSTRAINT "currency_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
