-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN "listingId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN "importId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN "externalLineId" TEXT;
ALTER TABLE "SalesOrderItem" ADD COLUMN "sourceRow" INTEGER;

-- CreateTable
CREATE TABLE "CostUploadIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostUploadIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'excel',
    "originalFileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesImportIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvertisingCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seller_center_sem',
    "sellerSku" TEXT,
    "parentSku" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "costDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvertisingCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostUploadIssue_organizationId_uploadId_idx" ON "CostUploadIssue"("organizationId", "uploadId");

-- Deduplicate historical cost records before enforcing one active cost per marketplace/SKU/effective date.
WITH ranked_costs AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "organizationId", "marketplace", "sellerSku", "effectiveDate"
            ORDER BY "createdAt" DESC, "id" DESC
        ) AS row_number
    FROM "CostRecord"
)
DELETE FROM "CostRecord"
USING ranked_costs
WHERE "CostRecord"."id" = ranked_costs."id"
  AND ranked_costs.row_number > 1;

-- CreateIndex
CREATE UNIQUE INDEX "CostRecord_organizationId_marketplace_sellerSku_effectiveDate_key" ON "CostRecord"("organizationId", "marketplace", "sellerSku", "effectiveDate");

-- CreateIndex
CREATE INDEX "SalesImport_organizationId_marketplace_createdAt_idx" ON "SalesImport"("organizationId", "marketplace", "createdAt");

-- CreateIndex
CREATE INDEX "SalesImportIssue_organizationId_importId_idx" ON "SalesImportIssue"("organizationId", "importId");

-- CreateIndex
CREATE INDEX "AdvertisingCost_organizationId_marketplace_source_costDate_idx" ON "AdvertisingCost"("organizationId", "marketplace", "source", "costDate");

-- CreateIndex
CREATE INDEX "AdvertisingCost_organizationId_sellerSku_idx" ON "AdvertisingCost"("organizationId", "sellerSku");

-- CreateIndex
CREATE INDEX "AdvertisingCost_organizationId_parentSku_idx" ON "AdvertisingCost"("organizationId", "parentSku");

-- AddForeignKey
ALTER TABLE "CostUploadIssue" ADD CONSTRAINT "CostUploadIssue_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "CostUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImport" ADD CONSTRAINT "SalesImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesImportIssue" ADD CONSTRAINT "SalesImportIssue_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvertisingCost" ADD CONSTRAINT "AdvertisingCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
