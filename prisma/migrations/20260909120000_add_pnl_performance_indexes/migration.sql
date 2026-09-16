-- Add indexes used by Walmart P&L page loads, settlement fee attribution, and ad rollups.
CREATE INDEX IF NOT EXISTS "SalesOrderItem_order_lookup_idx"
  ON "SalesOrderItem" ("organizationId", "marketplace", "orderId");

CREATE INDEX IF NOT EXISTS "SalesOrderItem_parent_sku_idx"
  ON "SalesOrderItem" ("organizationId", "marketplace", "parentSku", "sellerSku");

CREATE INDEX IF NOT EXISTS "MarketplaceFee_order_lookup_idx"
  ON "MarketplaceFee" ("organizationId", "orderId");

CREATE INDEX IF NOT EXISTS "MarketplaceFee_order_item_lookup_idx"
  ON "MarketplaceFee" ("organizationId", "orderItemId");

CREATE INDEX IF NOT EXISTS "MarketplaceFee_posted_at_idx"
  ON "MarketplaceFee" ("organizationId", "marketplace", "postedAt");

CREATE INDEX IF NOT EXISTS "MarketplaceFee_sku_posted_at_idx"
  ON "MarketplaceFee" ("organizationId", "marketplace", "sellerSku", "postedAt");

CREATE INDEX IF NOT EXISTS "Refund_order_lookup_idx"
  ON "Refund" ("organizationId", "orderId");

CREATE INDEX IF NOT EXISTS "Refund_order_item_lookup_idx"
  ON "Refund" ("organizationId", "orderItemId");

CREATE INDEX IF NOT EXISTS "Refund_sku_refund_date_idx"
  ON "Refund" ("organizationId", "marketplace", "sellerSku", "refundDate");

CREATE INDEX IF NOT EXISTS "AdvertisingCost_sku_date_idx"
  ON "AdvertisingCost" ("organizationId", "marketplace", "sellerSku", "costDate");

CREATE INDEX IF NOT EXISTS "AdvertisingCost_parent_date_idx"
  ON "AdvertisingCost" ("organizationId", "marketplace", "parentSku", "costDate");
