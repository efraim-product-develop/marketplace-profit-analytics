import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { importDb } from "@/server/imports/db";
import type { ImportCommitContext, ImportCommitResult } from "@/server/imports/types";
import { readDate, readNumber, readString, toArray, toJsonValue, toRecord } from "@/server/imports/utils";
import type { ParsedSalesRow } from "@/server/sales/parser";

const SKU_BATCH_SIZE = 100;
const ORDER_BATCH_SIZE = 250;

export async function commitSalesImportPayload(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const importRun = await importDb.importRun.findUnique({
    where: { id: context.importRunId },
    include: { issues: true }
  });

  const rows = decodeSalesRows(payload);
  let importedCount = 0;

  if (!rows.length) {
    return { importedCount: 0 };
  }

  const salesImport = await prisma.salesImport.create({
    data: {
      organizationId: context.organizationId,
      marketplace: context.marketplace,
      source: "generic_import_framework",
      originalFileName: context.originalFileName,
      status: "PENDING",
      rowCount: importRun?.rowCount ?? rows.length,
      importedCount: 0,
      rejectedCount: importRun?.rejectedCount ?? 0
    }
  });

  if (importRun?.issues.length) {
    await prisma.salesImportIssue.createMany({
      data: importRun.issues.map((issue) => ({
        organizationId: context.organizationId,
        importId: salesImport.id,
        rowNumber: issue.rowNumber,
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        rawData: issue.rawData === null ? undefined : toJsonValue(issue.rawData)
      }))
    });
  }

  const rowsByOrderId = groupRowsByOrder(rows);
  const skuRows = getRepresentativeRowsBySku(rows);
  const productCache = new Map<string, { id: string; parentSku: string | null }>();
  const listingCache = new Map<string, { id: string; parentSku: string | null }>();
  let feeRows = 0;
  let refundRows = 0;

  for (const skuChunk of chunkArray(Array.from(skuRows.values()), SKU_BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      for (const row of skuChunk) {
        const product = await tx.product.upsert({
          where: {
            organizationId_internalSku: {
              organizationId: context.organizationId,
              internalSku: row.sellerSku
            }
          },
          update: buildProductUpdate(row),
          create: {
            organizationId: context.organizationId,
            internalSku: row.sellerSku,
            parentSku: row.parentSku,
            title: row.productName,
            brand: row.brand
          }
        });
        productCache.set(row.sellerSku, product);

        const listing = await tx.listing.upsert({
          where: {
            organizationId_marketplace_sellerSku: {
              organizationId: context.organizationId,
              marketplace: context.marketplace,
              sellerSku: row.sellerSku
            }
          },
          update: buildListingUpdate(row, product.id),
          create: {
            organizationId: context.organizationId,
            productId: product.id,
            marketplace: context.marketplace,
            sellerSku: row.sellerSku,
            parentSku: row.parentSku,
            marketplaceItemId: row.marketplaceItemId,
            title: row.productName,
            fulfillmentChannel: row.fulfillmentChannel
          }
        });
        listingCache.set(row.sellerSku, listing);
      }
    }, { maxWait: 10000, timeout: 60000 });
  }

  for (const orderChunk of chunkArray(Array.from(rowsByOrderId.keys()), ORDER_BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      const ordersByExternalId = new Map<string, { id: string }>();

      for (const externalOrderId of orderChunk) {
        const orderRows = rowsByOrderId.get(externalOrderId) ?? [];
        const firstRow = orderRows[0];

        if (!firstRow) {
          continue;
        }

        const order = await tx.salesOrder.upsert({
          where: {
            organizationId_marketplace_externalOrderId: {
              organizationId: context.organizationId,
              marketplace: context.marketplace,
              externalOrderId
            }
          },
          update: {
            importId: salesImport.id,
            orderDate: firstRow.orderDate,
            status: firstRow.status,
            currency: firstRow.currency
          },
          create: {
            organizationId: context.organizationId,
            importId: salesImport.id,
            marketplace: context.marketplace,
            externalOrderId,
            orderDate: firstRow.orderDate,
            status: firstRow.status,
            currency: firstRow.currency
          }
        });
        ordersByExternalId.set(externalOrderId, order);
      }

      const orderDatabaseIds = Array.from(ordersByExternalId.values()).map((order) => order.id);

      if (orderDatabaseIds.length) {
        await tx.marketplaceFee.deleteMany({
          where: { organizationId: context.organizationId, orderId: { in: orderDatabaseIds } }
        });
        await deleteRefundsForOrders(tx, context.organizationId, orderDatabaseIds);
        await tx.salesOrderItem.deleteMany({
          where: { organizationId: context.organizationId, orderId: { in: orderDatabaseIds } }
        });
      }

      for (const externalOrderId of orderChunk) {
        const orderRows = rowsByOrderId.get(externalOrderId) ?? [];
        const order = ordersByExternalId.get(externalOrderId);

        if (!order) {
          continue;
        }

        for (const row of orderRows) {
          const product = productCache.get(row.sellerSku);
          const listing = listingCache.get(row.sellerSku);

          if (!product || !listing) {
            continue;
          }

          const item = await tx.salesOrderItem.create({
            data: {
              organizationId: context.organizationId,
              orderId: order.id,
              productId: product.id,
              listingId: listing.id,
              marketplace: context.marketplace,
              sellerSku: row.sellerSku,
              parentSku: row.parentSku ?? listing.parentSku ?? product.parentSku,
              externalLineId: row.externalLineId,
              sourceRow: row.sourceRow,
              quantity: row.quantity,
              unitPrice: row.unitPrice,
              itemRevenue: row.itemRevenue,
              shippingRevenue: row.shippingRevenue,
              taxCollected: row.taxCollected,
              discountAmount: row.discountAmount
            }
          });

          if (shouldCreateFee(row)) {
            await tx.marketplaceFee.create({
              data: {
                organizationId: context.organizationId,
                orderId: order.id,
                orderItemId: item.id,
                marketplace: context.marketplace,
                sellerSku: row.sellerSku,
                feeType: row.feeType ?? "marketplace_fee",
                feeAmount: row.feeAmount,
                currency: row.currency,
                postedAt: row.orderDate,
                metadata: row.metadata ? toJsonValue(row.metadata) : undefined
              }
            });
            feeRows += 1;
          }

          if (row.refundAmount && row.refundAmount > 0) {
            await createRefund(tx, {
              organizationId: context.organizationId,
              orderId: order.id,
              orderItemId: item.id,
              marketplace: context.marketplace,
              sellerSku: row.sellerSku,
              externalOrderId,
              externalLineId: row.externalLineId,
              refundAmount: row.refundAmount,
              refundDate: row.refundDate ?? row.orderDate,
              currency: row.currency,
              metadata: row.metadata
            });
            refundRows += 1;
          }

          importedCount += 1;
        }
      }
    }, { maxWait: 10000, timeout: 60000 });
  }

  await prisma.salesImport.update({
    where: { id: salesImport.id },
    data: {
      importedCount,
      status:
        !importedCount
          ? "FAILED"
          : importRun?.rejectedCount
            ? "NEEDS_REVIEW"
            : "IMPORTED"
    }
  });

  return {
    importedCount,
    summary: {
      salesImportId: salesImport.id,
      importedRows: importedCount,
      feeRows,
      refundRows
    }
  };
}

export function encodeSalesRows(rows: ParsedSalesRow[]) {
  return rows.map((row) => ({
    ...row,
    orderDate: row.orderDate.toISOString(),
    refundDate: row.refundDate ? row.refundDate.toISOString() : row.refundDate
  }));
}

function decodeSalesRows(payload: Prisma.JsonValue): ParsedSalesRow[] {
  const record = toRecord(payload);
  const rows = toArray(record.rows);

  return rows.map((value) => {
    const row = toRecord(value as Prisma.JsonValue);
    const metadata = toRecord(row.metadata as Prisma.JsonValue);
    return {
      externalOrderId: readString(row.externalOrderId),
      orderDate: readDate(row.orderDate),
      sellerSku: readString(row.sellerSku),
      parentSku: optionalString(row.parentSku),
      productName: optionalString(row.productName),
      brand: optionalString(row.brand),
      marketplaceItemId: optionalString(row.marketplaceItemId),
      fulfillmentChannel: optionalString(row.fulfillmentChannel),
      quantity: Math.trunc(readNumber(row.quantity)),
      unitPrice: readNumber(row.unitPrice),
      itemRevenue: readNumber(row.itemRevenue),
      shippingRevenue: readNumber(row.shippingRevenue),
      taxCollected: readNumber(row.taxCollected),
      discountAmount: readNumber(row.discountAmount),
      feeType: optionalString(row.feeType),
      feeAmount: readNumber(row.feeAmount),
      refundAmount: optionalNumber(row.refundAmount),
      refundDate: readOptionalDate(row.refundDate),
      currency: readString(row.currency) || "USD",
      status: optionalString(row.status),
      externalLineId: optionalString(row.externalLineId),
      sourceRow: Math.trunc(readNumber(row.sourceRow)),
      metadata: Object.keys(metadata).length ? metadata : undefined
    };
  });
}

function optionalString(value: unknown) {
  const text = readString(value).trim();
  return text || undefined;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  return readNumber(value);
}

function readOptionalDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const date = readDate(value);
  return date.getTime() === 0 ? undefined : date;
}

function shouldCreateFee(row: ParsedSalesRow) {
  return row.feeAmount !== 0 || row.metadata?.reportType === "walmart_item_sales";
}

function groupRowsByOrder(rows: ParsedSalesRow[]) {
  const groups = new Map<string, ParsedSalesRow[]>();

  for (const row of rows) {
    const existing = groups.get(row.externalOrderId) ?? [];
    existing.push(row);
    groups.set(row.externalOrderId, existing);
  }

  return groups;
}

function getRepresentativeRowsBySku(rows: ParsedSalesRow[]) {
  const rowsBySku = new Map<string, ParsedSalesRow>();

  for (const row of rows) {
    const existing = rowsBySku.get(row.sellerSku);

    if (!existing) {
      rowsBySku.set(row.sellerSku, row);
      continue;
    }

    rowsBySku.set(row.sellerSku, {
      ...existing,
      parentSku: existing.parentSku ?? row.parentSku,
      productName: existing.productName ?? row.productName,
      brand: existing.brand ?? row.brand,
      marketplaceItemId: existing.marketplaceItemId ?? row.marketplaceItemId,
      fulfillmentChannel: existing.fulfillmentChannel ?? row.fulfillmentChannel
    });
  }

  return rowsBySku;
}

function buildProductUpdate(row: ParsedSalesRow): Prisma.ProductUpdateInput {
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
  row: ParsedSalesRow,
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

  if (row.fulfillmentChannel) {
    update.fulfillmentChannel = row.fulfillmentChannel;
  }

  return update;
}

async function deleteRefundsForOrders(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orderIds: string[]
) {
  if (!orderIds.length) {
    return;
  }

  await tx.$executeRaw`
    DELETE FROM "Refund"
    WHERE "organizationId" = ${organizationId}
    AND "orderId" IN (${Prisma.join(orderIds)})
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
