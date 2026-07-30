-- CreateTable
CREATE TABLE "MarketplaceDailyTotal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importRunId" TEXT,
    "marketplace" TEXT NOT NULL,
    "reportType" TEXT NOT NULL DEFAULT 'overview',
    "totalDate" TIMESTAMP(3) NOT NULL,
    "gmv" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "refundSales" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cancelledSales" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "gmvMinusCommission" DECIMAL(14,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceDailyTotal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceDailyTotal_organizationId_marketplace_reportType_totalDate_key" ON "MarketplaceDailyTotal"("organizationId", "marketplace", "reportType", "totalDate");

-- CreateIndex
CREATE INDEX "MarketplaceDailyTotal_organizationId_marketplace_totalDate_idx" ON "MarketplaceDailyTotal"("organizationId", "marketplace", "totalDate");

-- CreateIndex
CREATE INDEX "MarketplaceDailyTotal_organizationId_importRunId_idx" ON "MarketplaceDailyTotal"("organizationId", "importRunId");

-- AddForeignKey
ALTER TABLE "MarketplaceDailyTotal" ADD CONSTRAINT "MarketplaceDailyTotal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceDailyTotal" ADD CONSTRAINT "MarketplaceDailyTotal_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
