-- CreateTable
CREATE TABLE "user_activity" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "user_activity_pkey" PRIMARY KEY ("userId","day")
);

-- CreateIndex
CREATE INDEX "user_activity_day_idx" ON "user_activity"("day");

-- CreateIndex
CREATE INDEX "pack_openings_createdAt_idx" ON "pack_openings"("createdAt");

-- CreateIndex
CREATE INDEX "trades_createdAt_idx" ON "trades"("createdAt");

-- CreateIndex
CREATE INDEX "trades_resolvedAt_status_idx" ON "trades"("resolvedAt", "status");

-- AddForeignKey
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
