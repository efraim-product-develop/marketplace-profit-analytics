-- Drop old COGS uniqueness; shipment-specific history is now allowed.
DROP INDEX IF EXISTS "CostRecord_organizationId_marketplace_sellerSku_effectiveDate_key";

-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN "batchId" TEXT;
ALTER TABLE "CostRecord" ADD COLUMN "shipmentId" TEXT;
ALTER TABLE "CostRecord" ADD COLUMN "productName" TEXT;
ALTER TABLE "CostRecord" ADD COLUMN "variationName" TEXT;
ALTER TABLE "CostRecord" ADD COLUMN "unitCogs" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "CostRecord" ADD COLUMN "inboundFreightPerUnit" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "CostRecord" ADD COLUMN "prepCostPerUnit" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "CostRecord" ADD COLUMN "packagingCostPerUnit" DECIMAL(14,4) NOT NULL DEFAULT 0;
ALTER TABLE "CostRecord" ADD COLUMN "notes" TEXT;

-- CreateTable
CREATE TABLE "CogsBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadId" TEXT,
    "marketplace" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CogsBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CogsBatch_organizationId_marketplace_shipmentId_key" ON "CogsBatch"("organizationId", "marketplace", "shipmentId");

-- CreateIndex
CREATE INDEX "CogsBatch_organizationId_marketplace_idx" ON "CogsBatch"("organizationId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "CostRecord_organizationId_marketplace_sellerSku_shipmentId_effectiveDate_key" ON "CostRecord"("organizationId", "marketplace", "sellerSku", "shipmentId", "effectiveDate");

-- CreateIndex
CREATE INDEX "CostRecord_organizationId_marketplace_shipmentId_idx" ON "CostRecord"("organizationId", "marketplace", "shipmentId");

-- AddForeignKey
ALTER TABLE "CogsBatch" ADD CONSTRAINT "CogsBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CogsBatch" ADD CONSTRAINT "CogsBatch_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "CostUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CogsBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
