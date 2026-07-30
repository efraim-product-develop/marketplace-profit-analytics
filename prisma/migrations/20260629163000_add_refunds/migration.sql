-- Marketplace-neutral refund records for imported order exports.

CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "marketplace" TEXT NOT NULL,
    "sellerSku" TEXT,
    "externalOrderId" TEXT,
    "externalLineId" TEXT,
    "refundAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "refundDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Refund_organizationId_marketplace_refundDate_idx" ON "Refund"("organizationId", "marketplace", "refundDate");
CREATE INDEX "Refund_organizationId_sellerSku_idx" ON "Refund"("organizationId", "sellerSku");
CREATE INDEX "Refund_organizationId_marketplace_externalOrderId_idx" ON "Refund"("organizationId", "marketplace", "externalOrderId");

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
