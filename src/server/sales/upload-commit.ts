import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedSalesUploadRow, SalesUploadIssue } from "@/server/sales/upload-types";
import { toJsonValue } from "@/server/imports/utils";

const SKU_BATCH_SIZE = 100;
const ROW_BATCH_SIZE = 250;

export type CommitSalesUploadInput = {
  organizationId: string;
  marketplace: string;
  originalFileName: string;
  rows: ParsedSalesUploadRow[];
  issues: SalesUploadIssue[];
};

export type CommitSalesUploadResult = {
  salesImportId: string;
  importedRows: number;
  updatedRows: number;
  feeRows: number;
  refundRows: number;
};

export async function commitSalesUpload({
  organizationId,
  marketplace,
  originalFileName,
  rows,
  issues
}: CommitSalesUploadInput): Promise<CommitSalesUploadResult> {
  const salesImport = await prisma.salesImport.create({
    data: {
      organizationId,
      marketplace,
      source: "sales_upload",
      originalFileName,
      status: "PENDING",
      rowCount: rows.length + issues.length,
      importedCount: 0,
      rejectedCount: issues.length
    }
  });

  if (issues.length) {
    await prisma.salesImportIssue.createMany({
      data: issues.map((issue) => ({
        organizationId,
        importId: salesImport.id,
        rowNumber: issue.row,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        rawData: issue.rawData ? toJsonValue(issue.rawData) : undefined
      }))
    });
  }

  if (!rows.length) {
    await prisma.salesImport.update({
      where: { id: salesImport.id },
      data: { status: "FAILED" }
    });

    return {
      salesImportId: salesImport.id,
      importedRows: 0,
      updatedRows: 0,
      feeRows: 0,
      refundRows: 0
    };
  }

  const skuRows = getRepresentativeRowsBySku(rows);
  const productCache = new Map<string, { id: string; parentSku: string | null }>();
  const listingCache = new Map<string, { id: string; parentSku: string | null }>();

  for (const skuChunk of chunkArray(Array.from(skuRows.values()), SKU_BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      for (const row of skuChunk) {
        if (row.parentSku && row.parentSku !== row.sku) {
          await tx.product.upsert({
            where: {
              organizationId_internalSku: {
                organizationId,
                internalSku: row.parentSku
              }
            },
            update: buildParentProductUpdate(row),
            create: {
              organizationId,
              internalSku: row.parentSku,
              title: row.productName,
              brand: row.brand
            }
          });
        }

        const product = await tx.product.upsert({
          where: {
            organizationId_internalSku: {
              organizationId,
              internalSku: row.sku
            }
          },
          update: buildProductUpdate(row),
          create: {
            organizationId,
            internalSku: row.sku,
            parentSku: row.parentSku,
            title: row.productName,
            brand: row.brand
          }
        });
        productCache.set(row.sku, product);

        const listing = await tx.listing.upsert({
          where: {
            organizationId_marketplace_sellerSku: {
              organizationId,
              marketplace,
              sellerSku: row.sku
            }
          },
          update: buildListingUpdate(row, product.id),
          create: {
            organizationId,
            productId: product.id,
            marketplace,
            sellerSku: row.sku,
            parentSku: row.parentSku,
            marketplaceItemId: row.marketplaceItemId,
            title: row.productName
          }
        });
        listingCache.set(row.sku, listing);
      }
    }, { maxWait: 10000, timeout: 60000 });
  }

  let importedRows = 0;
  let updatedRows = 0;
  let feeRows = 0;
  let refundRows = 0;

  for (const rowChunk of chunkArray(rows, ROW_BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      for (const row of rowChunk) {
        const order = await tx.salesOrder.upsert({
          where: {
            organizationId_marketplace_externalOrderId: {
              organizationId,
              marketplace,
              externalOrderId: row.externalOrderId
            }
          },
          update: {
            importId: salesImport.id,
            orderDate: row.orderDate,
            status: row.orderStatus,
            currency: row.currency
          },
          create: {
            organizationId,
            importId: salesImport.id,
            marketplace,
            externalOrderId: row.externalOrderId,
            orderDate: row.orderDate,
            status: row.orderStatus,
            currency: row.currency
          }
        });
        const existingItems = await tx.salesOrderItem.findMany({
          where: {
            organizationId,
            orderId: order.id,
            marketplace,
            sellerSku: row.sku
          },
          select: { id: true }
        });

        if (existingItems.length) {
          updatedRows += 1;
          await tx.marketplaceFee.deleteMany({
            where: {
              organizationId,
              orderItemId: { in: existingItems.map((item) => item.id) }
            }
          });
          await deleteRefundsForOrderItems(
            tx,
            organizationId,
            existingItems.map((item) => item.id)
          );
          await tx.salesOrderItem.deleteMany({
            where: {
              organizationId,
              id: { in: existingItems.map((item) => item.id) }
            }
          });
        } else {
          importedRows += 1;
        }

        const product = productCache.get(row.sku);
        const listing = listingCache.get(row.sku);
        const item = await tx.salesOrderItem.create({
          data: {
            organizationId,
            orderId: order.id,
            productId: product?.id,
            listingId: listing?.id,
            marketplace,
            sellerSku: row.sku,
            parentSku: row.parentSku ?? listing?.parentSku ?? product?.parentSku,
            externalLineId: row.externalOrderLineId,
            sourceRow: row.sourceRow,
            quantity: row.quantity,
            unitPrice: row.itemPrice,
            itemRevenue: row.grossSales,
            shippingRevenue: row.shippingRevenue,
            taxCollected: row.taxCollected,
            discountAmount: row.discountAmount
          }
        });

        if (row.fees.length) {
          await tx.marketplaceFee.createMany({
            data: row.fees.map((fee) => ({
              organizationId,
              orderId: order.id,
              orderItemId: item.id,
              marketplace,
              sellerSku: row.sku,
              feeType: fee.feeType,
              feeAmount: fee.feeAmount,
              currency: fee.currency,
              postedAt: row.orderDate,
              metadata: row.metadata ? toJsonValue(row.metadata) : undefined
            }))
          });
          feeRows += row.fees.length;
        }

        if (row.refund) {
          await createRefund(tx, {
            organizationId,
            orderId: order.id,
            orderItemId: item.id,
            marketplace,
            sellerSku: row.sku,
            externalOrderId: row.externalOrderId,
            externalLineId: row.externalOrderLineId,
            refundAmount: row.refund.refundAmount,
            refundDate: row.refund.refundDate,
            currency: row.refund.currency,
            metadata: row.metadata
          });
          refundRows += 1;
        }
      }
    }, { maxWait: 10000, timeout: 60000 });
  }

  await prisma.salesImport.update({
    where: { id: salesImport.id },
    data: {
      importedCount: importedRows + updatedRows,
      status:
        importedRows + updatedRows <= 0
          ? "FAILED"
          : issues.length
            ? "NEEDS_REVIEW"
            : "IMPORTED"
    }
  });

  return {
    salesImportId: salesImport.id,
    importedRows,
    updatedRows,
    feeRows,
    refundRows
  };
}

function getRepresentativeRowsBySku(rows: ParsedSalesUploadRow[]) {
  const rowsBySku = new Map<string, ParsedSalesUploadRow>();

  for (const row of rows) {
    const existing = rowsBySku.get(row.sku);

    if (!existing) {
      rowsBySku.set(row.sku, row);
      continue;
    }

    rowsBySku.set(row.sku, {
      ...existing,
      parentSku: existing.parentSku ?? row.parentSku,
      productName: existing.productName ?? row.productName,
      brand: existing.brand ?? row.brand,
      marketplaceItemId: existing.marketplaceItemId ?? row.marketplaceItemId
    });
  }

  return rowsBySku;
}

function buildParentProductUpdate(row: ParsedSalesUploadRow): Prisma.ProductUpdateInput {
  const update: Prisma.ProductUpdateInput = {};

  if (row.productName) {
    update.title = row.productName;
  }

  if (row.brand) {
    update.brand = row.brand;
  }

  return update;
}

function buildProductUpdate(row: ParsedSalesUploadRow): Prisma.ProductUpdateInput {
  const update: Prisma.ProductUpdateInput = {};

  if (row.parentSku !== undefined) {
    update.parentSku = row.parentSku;
  }

  if (row.productName) {
    update.title = row.productName;
  }

  if (row.brand) {
    update.brand = row.brand;
  }

  return update;
}

function buildListingUpdate(
  row: ParsedSalesUploadRow,
  productId: string
): Prisma.ListingUpdateInput {
  const update: Prisma.ListingUpdateInput = {
    product: { connect: { id: productId } }
  };

  if (row.parentSku !== undefined) {
    update.parentSku = row.parentSku;
  }

  if (row.marketplaceItemId) {
    update.marketplaceItemId = row.marketplaceItemId;
  }

  if (row.productName) {
    update.title = row.productName;
  }

  return update;
}

async function deleteRefundsForOrderItems(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orderItemIds: string[]
) {
  if (!orderItemIds.length) {
    return;
  }

  await tx.$executeRaw`
    DELETE FROM "Refund"
    WHERE "organizationId" = ${organizationId}
    AND "orderItemId" IN (${Prisma.join(orderItemIds)})
  `;
}

async function createRefund(
  tx: Prisma.TransactionClient,
  data: {
    organizationId: string;
    orderId: string;
    orderItemId: string;
    marketplace: string;
    sellerSku: string;
    externalOrderId: string;
    externalLineId?: string;
    refundAmount: number;
    refundDate: Date | null;
    currency: string;
    metadata?: Record<string, unknown>;
  }
) {
  const metadataJson = data.metadata ? JSON.stringify(toJsonValue(data.metadata)) : null;

  await tx.$executeRaw`
    INSERT INTO "Refund" (
      "id",
      "organizationId",
      "orderId",
      "orderItemId",
      "marketplace",
      "sellerSku",
      "externalOrderId",
      "externalLineId",
      "refundAmount",
      "refundDate",
      "currency",
      "metadata"
    )
    VALUES (
      ${randomUUID()},
      ${data.organizationId},
      ${data.orderId},
      ${data.orderItemId},
      ${data.marketplace},
      ${data.sellerSku},
      ${data.externalOrderId},
      ${data.externalLineId ?? null},
      ${data.refundAmount},
      ${data.refundDate},
      ${data.currency},
      ${metadataJson}::jsonb
    )
  `;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
