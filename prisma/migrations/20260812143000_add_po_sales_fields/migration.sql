ALTER TABLE "SalesOrderItem"
  ADD COLUMN IF NOT EXISTS "purchaseOrderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "purchaseOrderLineNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "customerOrderNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "customerOrderLineNumber" TEXT;

UPDATE "SalesOrderItem" soi
SET
  "purchaseOrderNumber" = COALESCE(soi."purchaseOrderNumber", sales_order."externalOrderId"),
  "purchaseOrderLineNumber" = COALESCE(soi."purchaseOrderLineNumber", soi."externalLineId")
FROM "SalesOrder" sales_order
WHERE soi."orderId" = sales_order.id
  AND soi."marketplace" = 'walmart'
  AND (
    soi."purchaseOrderNumber" IS NULL
    OR soi."purchaseOrderLineNumber" IS NULL
  );

CREATE INDEX IF NOT EXISTS "SalesOrderItem_po_lookup_idx"
  ON "SalesOrderItem"("organizationId", "marketplace", "purchaseOrderNumber");

CREATE INDEX IF NOT EXISTS "SalesOrderItem_po_line_lookup_idx"
  ON "SalesOrderItem"("organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber");
