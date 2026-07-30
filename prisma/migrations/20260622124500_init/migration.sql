-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('DRAFT', 'CONNECTED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'IMPORTED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "CostRecordStatus" AS ENUM ('ACTIVE', 'NEEDS_REVIEW', 'IGNORED');

-- CreateEnum
CREATE TYPE "CostMethod" AS ENUM ('LATEST_EFFECTIVE_DATE', 'WEIGHTED_AVERAGE');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "timeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "defaultMarketplace" TEXT,
    "inventoryCostMethod" "CostMethod" NOT NULL DEFAULT 'LATEST_EFFECTIVE_DATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "syncMode" TEXT NOT NULL DEFAULT 'manual',
    "credentialsRef" TEXT,
    "metadata" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "internalSku" TEXT,
    "parentSku" TEXT,
    "title" TEXT,
    "brand" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT,
    "marketplace" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "parentSku" TEXT,
    "marketplaceItemId" TEXT,
    "title" TEXT,
    "status" TEXT,
    "fulfillmentChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostUpload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT,
    "source" TEXT NOT NULL DEFAULT 'excel',
    "originalFileName" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadId" TEXT,
    "productId" TEXT,
    "marketplace" TEXT,
    "sellerSku" TEXT NOT NULL,
    "parentSku" TEXT,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "sourceRow" INTEGER,
    "status" "CostRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "listingId" TEXT,
    "marketplace" TEXT NOT NULL,
    "sellerSku" TEXT NOT NULL,
    "parentSku" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "itemRevenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "shippingRevenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "taxCollected" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "cogsUnit" DECIMAL(14,4),
    "cogsTotal" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceFee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "marketplace" TEXT NOT NULL,
    "sellerSku" TEXT,
    "feeType" TEXT NOT NULL,
    "feeAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "postedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_organizationId_marketplace_displayName_key" ON "MarketplaceConnection"("organizationId", "marketplace", "displayName");

-- CreateIndex
CREATE INDEX "MarketplaceConnection_organizationId_marketplace_idx" ON "MarketplaceConnection"("organizationId", "marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_internalSku_key" ON "Product"("organizationId", "internalSku");

-- CreateIndex
CREATE INDEX "Product_organizationId_parentSku_idx" ON "Product"("organizationId", "parentSku");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_organizationId_marketplace_sellerSku_key" ON "Listing"("organizationId", "marketplace", "sellerSku");

-- CreateIndex
CREATE INDEX "Listing_organizationId_marketplace_parentSku_idx" ON "Listing"("organizationId", "marketplace", "parentSku");

-- CreateIndex
CREATE INDEX "CostUpload_organizationId_marketplace_createdAt_idx" ON "CostUpload"("organizationId", "marketplace", "createdAt");

-- CreateIndex
CREATE INDEX "CostRecord_organizationId_marketplace_sellerSku_effectiveDate_idx" ON "CostRecord"("organizationId", "marketplace", "sellerSku", "effectiveDate");

-- CreateIndex
CREATE INDEX "CostRecord_organizationId_parentSku_idx" ON "CostRecord"("organizationId", "parentSku");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_organizationId_marketplace_externalOrderId_key" ON "SalesOrder"("organizationId", "marketplace", "externalOrderId");

-- CreateIndex
CREATE INDEX "SalesOrder_organizationId_marketplace_orderDate_idx" ON "SalesOrder"("organizationId", "marketplace", "orderDate");

-- CreateIndex
CREATE INDEX "SalesOrderItem_organizationId_marketplace_sellerSku_idx" ON "SalesOrderItem"("organizationId", "marketplace", "sellerSku");

-- CreateIndex
CREATE INDEX "SalesOrderItem_organizationId_parentSku_idx" ON "SalesOrderItem"("organizationId", "parentSku");

-- CreateIndex
CREATE INDEX "MarketplaceFee_organizationId_marketplace_feeType_idx" ON "MarketplaceFee"("organizationId", "marketplace", "feeType");

-- CreateIndex
CREATE INDEX "MarketplaceFee_organizationId_sellerSku_idx" ON "MarketplaceFee"("organizationId", "sellerSku");

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceConnection" ADD CONSTRAINT "MarketplaceConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostUpload" ADD CONSTRAINT "CostUpload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "CostUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceFee" ADD CONSTRAINT "MarketplaceFee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceFee" ADD CONSTRAINT "MarketplaceFee_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceFee" ADD CONSTRAINT "MarketplaceFee_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
