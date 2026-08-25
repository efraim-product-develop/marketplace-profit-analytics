ALTER TABLE "SalesOrderItem"
  ADD COLUMN IF NOT EXISTS "poCancelledQuantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "poPriceSourceKind" TEXT;
