-- CreateTable
CREATE TABLE "sets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "printedTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "symbolUrl" TEXT,
    "logoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supertype" TEXT NOT NULL,
    "subtypes" TEXT[],
    "hp" INTEGER,
    "types" TEXT[],
    "rarity" TEXT,
    "retreatCost" TEXT[],
    "weaknesses" JSONB NOT NULL,
    "resistances" JSONB NOT NULL,
    "attacks" JSONB NOT NULL,
    "abilities" JSONB NOT NULL,
    "legalities" JSONB NOT NULL,
    "nationalPokedexNumbers" INTEGER[],
    "imageSmall" TEXT NOT NULL,
    "imageLarge" TEXT NOT NULL,
    "tcgplayerId" TEXT,
    "cardmarketId" TEXT,
    "latestPriceUsd" DECIMAL(10,2),
    "latestPriceEur" DECIMAL(10,2),
    "priceUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "source" "PriceSource" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "market" DECIMAL(10,2),
    "low" DECIMAL(10,2),
    "mid" DECIMAL(10,2),
    "high" DECIMAL(10,2),
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cards_name_idx" ON "cards"("name");

-- CreateIndex
CREATE INDEX "cards_setId_idx" ON "cards"("setId");

-- CreateIndex
CREATE INDEX "cards_rarity_idx" ON "cards"("rarity");

-- CreateIndex
CREATE INDEX "cards_types_idx" ON "cards" USING GIN ("types");

-- CreateIndex
CREATE INDEX "price_snapshots_cardId_capturedAt_idx" ON "price_snapshots"("cardId", "capturedAt");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_setId_fkey" FOREIGN KEY ("setId") REFERENCES "sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
