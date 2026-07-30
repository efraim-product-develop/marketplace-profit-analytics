-- Remove an orphaned manual COGS test upload row for seller SKU INSTEST.
-- Audit result:
-- - Present only in CostRecord.
-- - Created from CostUpload originalFileName = 'cogs tes t.xlsx', source = 'excel'.
-- - sourceRow = 2.
-- - No product, listing, batch, shipment, sales order item, fee, or ad spend linkage.
-- - Not part of the validation seed dataset.

WITH target_org AS (
  SELECT id
  FROM "Organization"
  WHERE slug = 'local-workspace'
),
target_records AS (
  SELECT
    cr.id,
    cr."uploadId"
  FROM "CostRecord" cr
  JOIN target_org org ON org.id = cr."organizationId"
  LEFT JOIN "CostUpload" cu ON cu.id = cr."uploadId"
  WHERE cr."sellerSku" = 'INSTEST'
    AND cr."parentSku" IS NULL
    AND cr."shipmentId" IS NULL
    AND cr."productId" IS NULL
    AND cr."listingId" IS NULL
    AND cr."batchId" IS NULL
    AND cr."sourceRow" = 2
    AND cr."unitCost" = 1.6700
    AND cu.source = 'excel'
    AND cu."originalFileName" = 'cogs tes t.xlsx'
),
deleted_records AS (
  DELETE FROM "CostRecord" cr
  USING target_records tr
  WHERE cr.id = tr.id
  RETURNING tr."uploadId"
)
DELETE FROM "CostUpload" cu
USING (
  SELECT DISTINCT "uploadId"
  FROM deleted_records
  WHERE "uploadId" IS NOT NULL
) deleted_uploads
WHERE cu.id = deleted_uploads."uploadId"
  AND cu."organizationId" = (SELECT id FROM target_org)
  AND cu.source = 'excel'
  AND cu."originalFileName" = 'cogs tes t.xlsx'
  AND NOT EXISTS (
    SELECT 1
    FROM "CostRecord" cr
    WHERE cr."uploadId" = cu.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CostUploadIssue" issue
    WHERE issue."uploadId" = cu.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "CogsBatch" batch
    WHERE batch."uploadId" = cu.id
  );
