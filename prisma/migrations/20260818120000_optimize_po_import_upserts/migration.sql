ALTER TABLE "SalesOrderItem"
  ADD COLUMN IF NOT EXISTS "poReportLineNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "poReportFlids" TEXT,
  ADD COLUMN IF NOT EXISTS "poItemId" TEXT,
  ADD COLUMN IF NOT EXISTS "poProductName" TEXT,
  ADD COLUMN IF NOT EXISTS "poFulfillmentType" TEXT,
  ADD COLUMN IF NOT EXISTS "poOrderStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "poOriginalQuantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "poOriginalItemRevenue" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "poShippingCost" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "poTax" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "poDiscount" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "poOriginalFileName" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SalesOrderItem"
    WHERE "purchaseOrderNumber" IS NOT NULL
      AND "purchaseOrderLineNumber" IS NOT NULL
    GROUP BY "organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create SalesOrderItem PO unique index because duplicate PO lines already exist. Run a PO duplicate cleanup before applying this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrderItem_po_line_unique_idx"
  ON "SalesOrderItem"("organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber")
  WHERE "purchaseOrderNumber" IS NOT NULL
    AND "purchaseOrderLineNumber" IS NOT NULL;
