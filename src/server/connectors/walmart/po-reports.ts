import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "../../../lib/db.ts";
import type {
  ImportCommitContext,
  ImportCommitResult,
  ImportReportParser,
  ParsedImportIssue,
  ParsedImportPreviewRow,
  ParsedImportReport
} from "../../imports/types.ts";
import {
  compactObject,
  readNumber as readJsonNumber,
  readString as readJsonString,
  toArray,
  toJsonValue,
  toRecord
} from "../../imports/utils.ts";
import {
  NORMALIZED_PO_ORDER_STATUS,
  calculatePoGrossProductSales,
  getPoSalesFinancials,
  isPoCancellationStatus
} from "../../sales/po-sales-source.ts";
import { normalizeMarketplaceSku } from "../../sales/sku-normalization.ts";

const WALMART_PO_REPORT_TYPE = "walmart_po_order_sales";
const WALMART_PO_REPORT_LABEL = "Walmart PO Order Sales";
const WALMART_PO_DUPLICATE_VERSION = "walmart-po-order-sales-v1";
const PREVIEW_LIMIT = 50;
const COMMIT_CHUNK_SIZE = 500;
const PRODUCT_COMMIT_CHUNK_SIZE = 500;

const REQUIRED_HEADERS = ["po#", "line#", "order date", "sku", "qty"];

type WorkbookReport = {
  sheet: XLSX.WorkSheet | null;
  rawRows: Array<Record<string, unknown>>;
  headers: Set<string>;
};

type ParsedNumber = {
  status: "blank" | "invalid" | "valid";
  value: number | null;
};

type WalmartPoRow = {
  purchaseOrderNumber: string;
  purchaseOrderLineNumber: string;
  customerOrderNumber: string | null;
  customerOrderLineNumber: string | null;
  poReportLineNumber: string | null;
  poReportFlids: string | null;
  orderDate: string;
  sellerSku: string;
  itemId: string | null;
  productName: string | null;
  quantity: number;
  originalQuantity: number;
  cancelledQuantity: number;
  unitPrice: number;
  itemRevenue: number;
  originalItemRevenue: number;
  priceSourceKind: "unit_price" | "extended_line_amount";
  fulfillmentType: string | null;
  orderStatus: string | null;
  cancelled: boolean;
  shippingCost: number | null;
  tax: number | null;
  discount: number | null;
  sourceRow: number;
};

type WalmartPoParseSummary = {
  totalRowsRead: number;
  validRows: number;
  skippedRows: number;
  missingSkuRows: number;
  cancelledRows: number;
  skippedDuplicateRows: number;
  invalidRows: number;
  totalPoGmv: number;
  totalUnits: number;
  uniqueOrders: number;
  earliestOrderDate: string | null;
  latestOrderDate: string | null;
  fulfillmentBreakdown: Record<string, WalmartPoFulfillmentBreakdown>;
};

type WalmartPoFulfillmentBreakdown = {
  rows: number;
  salesRows: number;
  cancelledRows: number;
  units: number;
  gmv: number;
  uniqueOrders: number;
};

type PoOrderItemUpsertRow = {
  organizationId: string;
  orderId: string;
  productId?: string | null;
  listingId?: string | null;
  marketplace: string;
  sellerSku: string;
  parentSku?: string | null;
  externalLineId: string;
  purchaseOrderNumber: string;
  purchaseOrderLineNumber: string;
  customerOrderNumber?: string | null;
  customerOrderLineNumber?: string | null;
  sourceRow?: number | null;
  quantity: number;
  unitPrice: number;
  itemRevenue: number;
  shippingRevenue: number;
  taxCollected: number;
  discountAmount: number;
  poReportLineNumber?: string | null;
  poReportFlids?: string | null;
  poItemId?: string | null;
  poProductName?: string | null;
  poFulfillmentType?: string | null;
  poOrderStatus?: string | null;
  poOriginalQuantity: number;
  poCancelledQuantity: number;
  poOriginalItemRevenue: number;
  poPriceSourceKind: "unit_price" | "extended_line_amount";
  poShippingCost?: number | null;
  poTax?: number | null;
  poDiscount?: number | null;
  poOriginalFileName: string;
};

type WalmartPoParseResult = {
  rows: WalmartPoRow[];
  issues: ParsedImportIssue[];
  previewRows: ParsedImportPreviewRow[];
  summary: WalmartPoParseSummary;
  rowCount: number;
};

const workbookCache = new WeakMap<Buffer, WorkbookReport>();

export const walmartPoReportParser: ImportReportParser = {
  importKind: "sales",
  reportType: WALMART_PO_REPORT_TYPE,
  reportTypeLabel: WALMART_PO_REPORT_LABEL,
  detect(context) {
    const report = readWorkbookReport(context.buffer);

    if (!report.sheet) {
      return 0;
    }

    const hasRequiredHeaders = REQUIRED_HEADERS.every((header) => report.headers.has(header));
    const hasWalmartPoShape = report.headers.has("po#") && report.headers.has("order#");

    return hasRequiredHeaders && hasWalmartPoShape ? 100 : 0;
  },
  parse(context) {
    return parseWalmartPoImportReport(context.buffer);
  },
  commit: commitWalmartPoImportPayload
};

function parseWalmartPoImportReport(buffer: Buffer): ParsedImportReport {
  const report = readWorkbookReport(buffer);

  if (!report.sheet) {
    return unsupportedReport("WORKSHEET_NOT_FOUND", "The workbook did not contain a worksheet.");
  }

  if (!REQUIRED_HEADERS.every((header) => report.headers.has(header))) {
    return unsupportedReport(
      "UNSUPPORTED_WALMART_PO_REPORT",
      "This does not look like a Walmart PO report. Expected columns include PO#, Line#, Order Date, SKU, and Qty."
    );
  }

  const parsed = parseWalmartPoRows(report.rawRows);

  return {
    importKind: "sales",
    reportType: WALMART_PO_REPORT_TYPE,
    reportTypeLabel: WALMART_PO_REPORT_LABEL,
    rowCount: parsed.rowCount,
    validCount: parsed.rows.length,
    rejectedCount: parsed.issues.length,
    issues: parsed.issues,
    previewRows: parsed.previewRows,
    summary: {
      parserVersion: WALMART_PO_DUPLICATE_VERSION,
      ...parsed.summary,
      importedRows: 0,
      updatedRows: 0
    },
    payload: toJsonValue({
      marketplace: "walmart",
      rows: parsed.rows.map(encodeWalmartPoPayloadRow)
    }),
    duplicateVersion: WALMART_PO_DUPLICATE_VERSION,
    allowDuplicateFileImport: true
  };
}

function parseWalmartPoRows(rawRows: Array<Record<string, unknown>>): WalmartPoParseResult {
  const rows: WalmartPoRow[] = [];
  const issues: ParsedImportIssue[] = [];
  const seenKeys = new Set<string>();
  let missingSkuRows = 0;
  let skippedDuplicateRows = 0;
  let invalidRows = 0;

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;

    if (isBlankRow(rawRow)) {
      return;
    }

    const purchaseOrderNumber = readAliasedText(rawRow, [
      "po#",
      "po #",
      "purchase order #",
      "purchase order number",
      "purchase order"
    ]);
    const purchaseOrderLineNumber = readAliasedText(rawRow, [
      "line#",
      "line #",
      "purchase order line #",
      "purchase order line number",
      "po line #"
    ]);
    const poReportLineNumber = purchaseOrderLineNumber || null;
    const poReportFlids = readAliasedText(rawRow, [
      "flids",
      "flid",
      "fulfillment line id",
      "fulfillment line ids"
    ]) || null;
    const customerOrderNumber = readAliasedText(rawRow, [
      "order#",
      "order #",
      "customer order #",
      "customer order number",
      "customer order id"
    ]) || null;
    const customerOrderLineNumber = readAliasedText(rawRow, [
      "customer order line #",
      "customer order line number",
      "customer line #"
    ]) || poReportFlids || purchaseOrderLineNumber || null;
    const orderDate = readAliasedDate(rawRow, ["order date"]);
    const sellerSku = normalizeMarketplaceSku(
      readAliasedText(rawRow, ["sku", "seller sku", "partner sku", "item sku"])
    );
    const itemId = readAliasedText(rawRow, ["item id", "item id#", "upc", "gtin"]) || null;
    const productName = readAliasedText(rawRow, [
      "product name",
      "item description",
      "item name",
      "description"
    ]) || null;
    const quantity = parseNumberValue(readAliasedValue(rawRow, ["qty", "quantity"]));
    const cancelledQuantity = parseNumberValue(readAliasedValue(rawRow, [
      "cancelled qty",
      "canceled qty",
      "cancelled quantity",
      "canceled quantity",
      "qty cancelled",
      "qty canceled",
      "quantity cancelled",
      "quantity canceled"
    ]));
    const itemCost = parseNumberValue(readAliasedValue(rawRow, [
      "item cost",
      "item price",
      "unit price",
      "price"
    ]));
    const grossSales = parseNumberValue(readAliasedValue(rawRow, [
      "gross sales",
      "item revenue",
      "sales",
      "po gmv",
      "gmv"
    ]));
    const orderStatus = readAliasedText(rawRow, ["status", "order status"]) || null;
    const fulfillmentType = readAliasedText(rawRow, [
      "fulfillment entity",
      "fulfillment type",
      "fulfillment channel"
    ]) || null;
    const cancelled = isPoCancellationStatus(orderStatus);

    if (!purchaseOrderNumber) {
      issues.push(errorIssue(sourceRow, "MISSING_PURCHASE_ORDER", "Missing Purchase Order #.", rawRow));
      invalidRows += 1;
      return;
    }

    if (!purchaseOrderLineNumber) {
      issues.push(errorIssue(sourceRow, "MISSING_PO_LINE", "Missing Purchase Order Line #.", rawRow));
      invalidRows += 1;
      return;
    }

    if (!orderDate) {
      issues.push(errorIssue(sourceRow, "INVALID_ORDER_DATE", "Missing or invalid Order Date.", rawRow));
      invalidRows += 1;
      return;
    }

    if (!sellerSku) {
      missingSkuRows += 1;
      issues.push(errorIssue(sourceRow, "MISSING_SKU", "Missing SKU.", rawRow));
      return;
    }

    if (!cancelled && (quantity.status !== "valid" || (quantity.value ?? 0) <= 0)) {
      issues.push(errorIssue(sourceRow, "INVALID_QUANTITY", "Missing or invalid quantity.", rawRow));
      invalidRows += 1;
      return;
    }

    if (cancelledQuantity.status === "invalid") {
      issues.push(
        errorIssue(sourceRow, "INVALID_CANCELLED_QUANTITY", "Invalid cancelled quantity.", rawRow)
      );
      invalidRows += 1;
      return;
    }

    if (!cancelled && (itemCost.status === "invalid" || grossSales.status === "invalid")) {
      issues.push(errorIssue(sourceRow, "INVALID_PRICE", "Invalid price or PO GMV value.", rawRow));
      invalidRows += 1;
      return;
    }

    if (!cancelled && itemCost.status !== "valid" && grossSales.status !== "valid") {
      issues.push(
        errorIssue(
          sourceRow,
          "MISSING_PRICE",
          "Missing Item Cost, Price, or PO GMV value.",
          rawRow
        )
      );
      invalidRows += 1;
      return;
    }

    const duplicateKey = buildPoDuplicateKey(purchaseOrderNumber, purchaseOrderLineNumber);

    if (seenKeys.has(duplicateKey)) {
      skippedDuplicateRows += 1;
      issues.push(
        warningIssue(
          sourceRow,
          "DUPLICATE_PO_LINE",
          "Skipped duplicate PO line in this file.",
          rawRow
        )
      );
      return;
    }

    seenKeys.add(duplicateKey);

    const productSales = calculatePoGrossProductSales({
      orderedQuantity: quantity.status === "valid" ? quantity.value ?? 0 : 0,
      cancelledQuantity: cancelledQuantity.status === "valid" ? cancelledQuantity.value ?? 0 : null,
      cancelled,
      unitPrice: itemCost.status === "valid" ? itemCost.value ?? 0 : null,
      extendedLineAmount: grossSales.status === "valid" ? grossSales.value ?? 0 : null
    });

    rows.push({
      purchaseOrderNumber,
      purchaseOrderLineNumber,
      customerOrderNumber,
      customerOrderLineNumber,
      poReportLineNumber,
      poReportFlids,
      orderDate: formatDate(orderDate),
      sellerSku,
      itemId,
      productName,
      quantity: productSales.activeQuantity,
      originalQuantity: productSales.originalQuantity,
      cancelledQuantity: productSales.cancelledQuantity,
      unitPrice: productSales.unitPrice,
      itemRevenue: productSales.grossProductSales,
      originalItemRevenue: productSales.originalGrossProductSales,
      priceSourceKind: productSales.priceSourceKind,
      fulfillmentType,
      orderStatus,
      cancelled,
      shippingCost: optionalMoney(rawRow, ["shipping cost", "shipping"]),
      tax: optionalMoney(rawRow, ["tax"]),
      discount: optionalMoney(rawRow, ["discount"]),
      sourceRow
    });
  });

  const salesRows = rows.filter((row) => !row.cancelled);
  const totalPoGmv = roundMoney(salesRows.reduce((sum, row) => sum + row.itemRevenue, 0));
  const totalUnits = salesRows.reduce((sum, row) => sum + row.quantity, 0);
  const skippedRows = missingSkuRows + skippedDuplicateRows + invalidRows;
  const summary = {
    totalRowsRead: rawRows.length,
    validRows: rows.length,
    skippedRows,
    missingSkuRows,
    cancelledRows: rows.length - salesRows.length,
    skippedDuplicateRows,
    invalidRows,
    totalPoGmv,
    totalUnits,
    uniqueOrders: countUniqueOrders(salesRows),
    earliestOrderDate: getMinOrderDate(rows),
    latestOrderDate: getMaxOrderDate(rows),
    fulfillmentBreakdown: buildFulfillmentBreakdown(rows)
  };

  return {
    rows,
    issues,
    rowCount: rawRows.length,
    summary,
    previewRows: rows.slice(0, PREVIEW_LIMIT).map((row) => ({
      rowNumber: row.sourceRow,
      status: "valid",
      normalizedData: compactObject({
        purchaseOrderNumber: row.purchaseOrderNumber,
        purchaseOrderLineNumber: row.purchaseOrderLineNumber,
        customerOrderNumber: row.customerOrderNumber,
        customerOrderLineNumber: row.customerOrderLineNumber,
        poReportLineNumber: row.poReportLineNumber,
        poReportFlids: row.poReportFlids,
        orderDate: row.orderDate,
        sku: row.sellerSku,
        itemId: row.itemId,
        productName: row.productName,
        quantity: row.quantity,
        originalQuantity: row.originalQuantity,
        cancelledQuantity: row.cancelledQuantity,
        unitPrice: row.unitPrice,
        poGmv: row.itemRevenue,
        originalPoGmv: row.originalItemRevenue,
        priceSourceKind: row.priceSourceKind,
        fulfillmentType: row.fulfillmentType,
        orderStatus: row.orderStatus,
        cancelled: row.cancelled
      })
    }))
  };
}

async function commitWalmartPoImportPayload(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const rows = decodeWalmartPoRows(payload);
  const importRun = await prisma.importRun.findUnique({
    where: { id: context.importRunId },
    include: { issues: true }
  });

  if (!rows.length) {
    return {
      importedCount: 0,
      summary: {
        importedRows: 0,
        updatedRows: 0,
        missingSkuRows: 0,
        cancelledRows: 0,
        totalPoGmv: 0,
        totalUnits: 0,
        uniqueOrders: 0
      }
    };
  }

  const salesImport = await prisma.salesImport.create({
    data: {
      organizationId: context.organizationId,
      marketplace: context.marketplace,
      source: "walmart_po_report_import",
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

  const { productsBySku, listingsBySku } = await ensurePoProductsAndListings(
    context.organizationId,
    context.marketplace,
    rows
  );
  let importedRows = 0;
  let updatedRows = 0;
  let metadataRowsRemoved = 0;

  for (const rowChunk of chunkArray(rows, COMMIT_CHUNK_SIZE)) {
    const ordersByExternalId = await upsertPoOrders({
      organizationId: context.organizationId,
      marketplace: context.marketplace,
      importId: salesImport.id,
      rows: getRepresentativeRowsByPoNumber(rowChunk)
    });

    const existingItems = await prisma.salesOrderItem.findMany({
      where: {
        organizationId: context.organizationId,
        marketplace: context.marketplace,
        purchaseOrderNumber: { in: [...new Set(rowChunk.map((row) => row.purchaseOrderNumber))] },
        purchaseOrderLineNumber: {
          in: [...new Set(rowChunk.map((row) => row.purchaseOrderLineNumber))]
        }
      },
      select: {
        id: true,
        purchaseOrderNumber: true,
        purchaseOrderLineNumber: true
      }
    });
    const existingItemIds = existingItems.map((item) => item.id);

    if (existingItemIds.length) {
      const [metadataDeleteResult] = await Promise.all([
        prisma.marketplaceFee.deleteMany({
          where: {
            organizationId: context.organizationId,
            orderItemId: { in: existingItemIds },
            feeType: "po_report_metadata"
          }
        }),
        prisma.refund.deleteMany({
          where: {
            organizationId: context.organizationId,
            orderItemId: { in: existingItemIds },
            metadata: {
              path: ["source"],
              equals: "walmart_po_report"
            }
          }
        })
      ]);
      metadataRowsRemoved += metadataDeleteResult.count;
    }

    const orderItemRows: PoOrderItemUpsertRow[] = [];

    for (const row of rowChunk) {
      const order = ordersByExternalId.get(row.purchaseOrderNumber);

      if (!order) {
        continue;
      }

      const product = productsBySku.get(row.sellerSku);
      const listing = listingsBySku.get(row.sellerSku);
      const salesFinancials = getPoSalesFinancials({
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        itemRevenue: row.itemRevenue,
        shippingRevenue: 0,
        taxCollected: 0,
        discountAmount: 0,
        cancelled: row.cancelled
      });

      orderItemRows.push({
        organizationId: context.organizationId,
        orderId: order.id,
        productId: product?.id,
        listingId: listing?.id,
        marketplace: context.marketplace,
        sellerSku: row.sellerSku,
        parentSku: listing?.parentSku ?? product?.parentSku ?? null,
        externalLineId: row.purchaseOrderLineNumber,
        purchaseOrderNumber: row.purchaseOrderNumber,
        purchaseOrderLineNumber: row.purchaseOrderLineNumber,
        customerOrderNumber: row.customerOrderNumber,
        customerOrderLineNumber: row.customerOrderLineNumber,
        sourceRow: row.sourceRow || undefined,
        quantity: salesFinancials.quantity,
        unitPrice: salesFinancials.unitPrice,
        itemRevenue: salesFinancials.itemRevenue,
        shippingRevenue: salesFinancials.shippingRevenue,
        taxCollected: salesFinancials.taxCollected,
        discountAmount: salesFinancials.discountAmount,
        poReportLineNumber: row.poReportLineNumber,
        poReportFlids: row.poReportFlids,
        poItemId: row.itemId,
        poProductName: row.productName,
        poFulfillmentType: row.fulfillmentType,
        poOrderStatus: row.orderStatus,
        poOriginalQuantity: row.originalQuantity,
        poCancelledQuantity: row.cancelledQuantity,
        poOriginalItemRevenue: row.originalItemRevenue,
        poPriceSourceKind: row.priceSourceKind,
        poShippingCost: row.shippingCost,
        poTax: row.tax,
        poDiscount: row.discount,
        poOriginalFileName: context.originalFileName
      });
    }

    const orderItemResult = await upsertPoOrderItems(orderItemRows);
    importedRows += orderItemResult.importedRows;
    updatedRows += orderItemResult.updatedRows;
  }

  const importedCount = importedRows + updatedRows;
  const importSummary = summarizePoRows(rows);

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
      importedRows,
      updatedRows,
      duplicateUpsertedRows: updatedRows,
      upsertedRows: updatedRows,
      cancelledRows: importSummary.cancelledRows,
      refundRows: 0,
      feeRows: 0,
      totalPoGmv: importSummary.totalPoGmv,
      totalUnits: importSummary.totalUnits,
      uniqueOrders: importSummary.uniqueOrders,
      earliestOrderDate: importSummary.earliestOrderDate,
      latestOrderDate: importSummary.latestOrderDate,
      fulfillmentBreakdown: importSummary.fulfillmentBreakdown,
      metadataRowsCreated: 0,
      metadataRowsRemoved
    }
  };
}

async function upsertPoOrders({
  organizationId,
  marketplace,
  importId,
  rows
}: {
  organizationId: string;
  marketplace: string;
  importId: string;
  rows: WalmartPoRow[];
}) {
  if (!rows.length) {
    return new Map<string, { id: string }>();
  }

  const timestamp = new Date();
  const values = rows.map((row) =>
    Prisma.sql`(
      ${randomUUID()},
      ${organizationId},
      ${importId},
      ${marketplace},
      ${row.purchaseOrderNumber},
      ${getOrderDate(row)},
      ${NORMALIZED_PO_ORDER_STATUS},
      ${"USD"},
      ${timestamp}
    )`
  );
  const upsertedOrders = await prisma.$queryRaw<Array<{ id: string; externalOrderId: string }>>`
    INSERT INTO "SalesOrder" (
      "id",
      "organizationId",
      "importId",
      "marketplace",
      "externalOrderId",
      "orderDate",
      "status",
      "currency",
      "updatedAt"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("organizationId", "marketplace", "externalOrderId")
    DO UPDATE SET
      "importId" = EXCLUDED."importId",
      "orderDate" = EXCLUDED."orderDate",
      "status" = EXCLUDED."status",
      "currency" = EXCLUDED."currency",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "id", "externalOrderId"
  `;

  return new Map(
    upsertedOrders.map((order) => [order.externalOrderId, { id: order.id }] as const)
  );
}

async function upsertPoOrderItems(rows: PoOrderItemUpsertRow[]) {
  if (!rows.length) {
    return { importedRows: 0, updatedRows: 0 };
  }

  const timestamp = new Date();
  const values = rows.map((row) =>
    Prisma.sql`(
      ${randomUUID()},
      ${row.organizationId},
      ${row.orderId},
      ${row.productId ?? null},
      ${row.listingId ?? null},
      ${row.marketplace},
      ${row.sellerSku},
      ${row.parentSku ?? null},
      ${row.externalLineId},
      ${row.purchaseOrderNumber},
      ${row.purchaseOrderLineNumber},
      ${row.customerOrderNumber ?? null},
      ${row.customerOrderLineNumber ?? null},
      ${row.poReportLineNumber ?? null},
      ${row.poReportFlids ?? null},
      ${row.poItemId ?? null},
      ${row.poProductName ?? null},
      ${row.poFulfillmentType ?? null},
      ${row.poOrderStatus ?? null},
      ${row.poOriginalQuantity},
      ${row.poCancelledQuantity},
      ${row.poOriginalItemRevenue},
      ${row.poPriceSourceKind},
      ${row.poShippingCost ?? null},
      ${row.poTax ?? null},
      ${row.poDiscount ?? null},
      ${row.poOriginalFileName},
      ${row.sourceRow ?? null},
      ${row.quantity},
      ${row.unitPrice},
      ${row.itemRevenue},
      ${row.shippingRevenue},
      ${row.taxCollected},
      ${row.discountAmount},
      ${timestamp}
    )`
  );
  const upsertedItems = await prisma.$queryRaw<Array<{ inserted: boolean }>>`
    INSERT INTO "SalesOrderItem" (
      "id",
      "organizationId",
      "orderId",
      "productId",
      "listingId",
      "marketplace",
      "sellerSku",
      "parentSku",
      "externalLineId",
      "purchaseOrderNumber",
      "purchaseOrderLineNumber",
      "customerOrderNumber",
      "customerOrderLineNumber",
      "poReportLineNumber",
      "poReportFlids",
      "poItemId",
      "poProductName",
      "poFulfillmentType",
      "poOrderStatus",
      "poOriginalQuantity",
      "poCancelledQuantity",
      "poOriginalItemRevenue",
      "poPriceSourceKind",
      "poShippingCost",
      "poTax",
      "poDiscount",
      "poOriginalFileName",
      "sourceRow",
      "quantity",
      "unitPrice",
      "itemRevenue",
      "shippingRevenue",
      "taxCollected",
      "discountAmount",
      "updatedAt"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("organizationId", "marketplace", "purchaseOrderNumber", "purchaseOrderLineNumber")
    WHERE "purchaseOrderNumber" IS NOT NULL
      AND "purchaseOrderLineNumber" IS NOT NULL
    DO UPDATE SET
      "orderId" = EXCLUDED."orderId",
      "productId" = EXCLUDED."productId",
      "listingId" = EXCLUDED."listingId",
      "sellerSku" = EXCLUDED."sellerSku",
      "parentSku" = EXCLUDED."parentSku",
      "externalLineId" = EXCLUDED."externalLineId",
      "customerOrderNumber" = EXCLUDED."customerOrderNumber",
      "customerOrderLineNumber" = EXCLUDED."customerOrderLineNumber",
      "poReportLineNumber" = EXCLUDED."poReportLineNumber",
      "poReportFlids" = EXCLUDED."poReportFlids",
      "poItemId" = EXCLUDED."poItemId",
      "poProductName" = EXCLUDED."poProductName",
      "poFulfillmentType" = EXCLUDED."poFulfillmentType",
      "poOrderStatus" = EXCLUDED."poOrderStatus",
      "poOriginalQuantity" = EXCLUDED."poOriginalQuantity",
      "poCancelledQuantity" = EXCLUDED."poCancelledQuantity",
      "poOriginalItemRevenue" = EXCLUDED."poOriginalItemRevenue",
      "poPriceSourceKind" = EXCLUDED."poPriceSourceKind",
      "poShippingCost" = EXCLUDED."poShippingCost",
      "poTax" = EXCLUDED."poTax",
      "poDiscount" = EXCLUDED."poDiscount",
      "poOriginalFileName" = EXCLUDED."poOriginalFileName",
      "sourceRow" = EXCLUDED."sourceRow",
      "quantity" = EXCLUDED."quantity",
      "unitPrice" = EXCLUDED."unitPrice",
      "itemRevenue" = EXCLUDED."itemRevenue",
      "shippingRevenue" = EXCLUDED."shippingRevenue",
      "taxCollected" = EXCLUDED."taxCollected",
      "discountAmount" = EXCLUDED."discountAmount",
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING (xmax = 0) AS "inserted"
  `;

  const importedRows = upsertedItems.filter((item) => item.inserted).length;

  return {
    importedRows,
    updatedRows: upsertedItems.length - importedRows
  };
}

async function ensurePoProductsAndListings(
  organizationId: string,
  marketplace: string,
  rows: WalmartPoRow[]
) {
  const skuRows = getRepresentativeRowsBySku(rows);

  for (const rowChunk of chunkArray(skuRows, PRODUCT_COMMIT_CHUNK_SIZE)) {
    await prisma.$transaction(async (tx) => {
      await tx.product.createMany({
        data: rowChunk.map((row) => ({
          organizationId,
          internalSku: row.sellerSku,
          title: row.productName
        })),
        skipDuplicates: true
      });

      const products = await tx.product.findMany({
        where: {
          organizationId,
          internalSku: { in: rowChunk.map((row) => row.sellerSku) }
        },
        select: { id: true, internalSku: true, parentSku: true }
      });
      const productsBySku = new Map(
        products.flatMap((product) =>
          product.internalSku ? [[product.internalSku, product]] as const : []
        )
      );

      await tx.listing.createMany({
        data: rowChunk.map((row) => ({
          organizationId,
          productId: productsBySku.get(row.sellerSku)?.id,
          marketplace,
          sellerSku: row.sellerSku,
          parentSku: productsBySku.get(row.sellerSku)?.parentSku ?? null,
          marketplaceItemId: row.itemId,
          title: row.productName,
          fulfillmentChannel: row.fulfillmentType
        })),
        skipDuplicates: true
      });

      for (const row of rowChunk) {
        await tx.product.updateMany({
          where: { organizationId, internalSku: row.sellerSku },
          data: {
            ...(row.productName ? { title: row.productName } : {})
          }
        });
        await tx.listing.updateMany({
          where: { organizationId, marketplace, sellerSku: row.sellerSku },
          data: {
            ...(row.itemId ? { marketplaceItemId: row.itemId } : {}),
            ...(row.productName ? { title: row.productName } : {}),
            ...(row.fulfillmentType ? { fulfillmentChannel: row.fulfillmentType } : {})
          }
        });
      }
    }, { maxWait: 10000, timeout: 60000 });
  }

  const [products, listings] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId,
        internalSku: { in: skuRows.map((row) => row.sellerSku) }
      },
      select: { id: true, internalSku: true, parentSku: true }
    }),
    prisma.listing.findMany({
      where: {
        organizationId,
        marketplace,
        sellerSku: { in: skuRows.map((row) => row.sellerSku) }
      },
      select: { id: true, sellerSku: true, parentSku: true }
    })
  ]);

  return {
    productsBySku: new Map(
      products.flatMap((product) =>
        product.internalSku ? [[product.internalSku, product]] as const : []
      )
    ),
    listingsBySku: new Map(listings.map((listing) => [listing.sellerSku, listing]))
  };
}

function getRepresentativeRowsBySku(rows: WalmartPoRow[]) {
  const rowsBySku = new Map<string, WalmartPoRow>();

  for (const row of rows) {
    if (!rowsBySku.has(row.sellerSku)) {
      rowsBySku.set(row.sellerSku, row);
    }
  }

  return Array.from(rowsBySku.values());
}

function getRepresentativeRowsByPoNumber(rows: WalmartPoRow[]) {
  const rowsByPoNumber = new Map<string, WalmartPoRow>();

  for (const row of rows) {
    if (!rowsByPoNumber.has(row.purchaseOrderNumber)) {
      rowsByPoNumber.set(row.purchaseOrderNumber, row);
    }
  }

  return Array.from(rowsByPoNumber.values());
}

function encodeWalmartPoPayloadRow(row: WalmartPoRow) {
  return row;
}

function decodeWalmartPoRows(payload: Prisma.JsonValue): WalmartPoRow[] {
  const record = toRecord(payload);

  return toArray(record.rows)
    .map((value) => {
      const row = toRecord(value as Prisma.JsonValue);

      return {
        purchaseOrderNumber: readJsonString(row.purchaseOrderNumber),
        purchaseOrderLineNumber: readJsonString(row.purchaseOrderLineNumber),
        customerOrderNumber: optionalJsonString(row.customerOrderNumber),
        customerOrderLineNumber: optionalJsonString(row.customerOrderLineNumber),
        poReportLineNumber: optionalJsonString(row.poReportLineNumber),
        poReportFlids: optionalJsonString(row.poReportFlids),
        orderDate: readJsonString(row.orderDate),
        sellerSku: normalizeMarketplaceSku(readJsonString(row.sellerSku)),
        itemId: optionalJsonString(row.itemId),
        productName: optionalJsonString(row.productName),
        quantity: Math.trunc(readJsonNumber(row.quantity)),
        originalQuantity: Math.trunc(optionalJsonNumber(row.originalQuantity) ?? readJsonNumber(row.quantity)),
        cancelledQuantity: Math.trunc(optionalJsonNumber(row.cancelledQuantity) ?? 0),
        unitPrice: readJsonNumber(row.unitPrice),
        itemRevenue: readJsonNumber(row.itemRevenue),
        originalItemRevenue: optionalJsonNumber(row.originalItemRevenue) ?? readJsonNumber(row.itemRevenue),
        priceSourceKind: readPoPriceSourceKind(row.priceSourceKind),
        fulfillmentType: optionalJsonString(row.fulfillmentType),
        orderStatus: optionalJsonString(row.orderStatus),
        cancelled: row.cancelled === true,
        shippingCost: optionalJsonNumber(row.shippingCost),
        tax: optionalJsonNumber(row.tax),
        discount: optionalJsonNumber(row.discount),
        sourceRow: Math.trunc(readJsonNumber(row.sourceRow))
      };
    })
    .filter((row) =>
      row.purchaseOrderNumber &&
      row.purchaseOrderLineNumber &&
      row.orderDate &&
      row.sellerSku &&
      (row.quantity > 0 || row.cancelled)
    );
}

function summarizePoRows(rows: WalmartPoRow[]): WalmartPoParseSummary {
  const salesRows = rows.filter((row) => !row.cancelled);

  return {
    totalRowsRead: rows.length,
    validRows: rows.length,
    skippedRows: 0,
    missingSkuRows: 0,
    cancelledRows: rows.length - salesRows.length,
    skippedDuplicateRows: 0,
    invalidRows: 0,
    totalPoGmv: roundMoney(salesRows.reduce((sum, row) => sum + row.itemRevenue, 0)),
    totalUnits: salesRows.reduce((sum, row) => sum + row.quantity, 0),
    uniqueOrders: countUniqueOrders(salesRows),
    earliestOrderDate: getMinOrderDate(rows),
    latestOrderDate: getMaxOrderDate(rows),
    fulfillmentBreakdown: buildFulfillmentBreakdown(rows)
  };
}

function countUniqueOrders(rows: WalmartPoRow[]) {
  return new Set(rows.map((row) => row.purchaseOrderNumber)).size;
}

function getMinOrderDate(rows: WalmartPoRow[]) {
  return rows.reduce<string | null>((minDate, row) => {
    if (!minDate || row.orderDate < minDate) {
      return row.orderDate;
    }

    return minDate;
  }, null);
}

function getMaxOrderDate(rows: WalmartPoRow[]) {
  return rows.reduce<string | null>((maxDate, row) => {
    if (!maxDate || row.orderDate > maxDate) {
      return row.orderDate;
    }

    return maxDate;
  }, null);
}

function buildFulfillmentBreakdown(rows: WalmartPoRow[]) {
  const buckets = new Map<string, WalmartPoFulfillmentBreakdown & { orderNumbers: Set<string> }>();

  for (const row of rows) {
    const key = normalizeFulfillmentBucket(row.fulfillmentType);
    const bucket = buckets.get(key) ?? {
      rows: 0,
      salesRows: 0,
      cancelledRows: 0,
      units: 0,
      gmv: 0,
      uniqueOrders: 0,
      orderNumbers: new Set<string>()
    };

    bucket.rows += 1;

    if (row.cancelled) {
      bucket.cancelledRows += 1;
    } else {
      bucket.salesRows += 1;
      bucket.units += row.quantity;
      bucket.gmv = roundMoney(bucket.gmv + row.itemRevenue);
      bucket.orderNumbers.add(row.purchaseOrderNumber);
    }

    buckets.set(key, bucket);
  }

  return Object.fromEntries(
    Array.from(buckets.entries()).map(([key, bucket]) => [
      key,
      {
        rows: bucket.rows,
        salesRows: bucket.salesRows,
        cancelledRows: bucket.cancelledRows,
        units: bucket.units,
        gmv: roundMoney(bucket.gmv),
        uniqueOrders: bucket.orderNumbers.size
      }
    ])
  );
}

function normalizeFulfillmentBucket(fulfillmentType: string | null) {
  const normalized = normalizeHeader(fulfillmentType ?? "");

  if (normalized.includes("wfs")) {
    return "wfs";
  }

  if (
    normalized.includes("seller") ||
    normalized.includes("merchant") ||
    normalized.includes("partner")
  ) {
    return "sellerFulfilled";
  }

  return "unknown";
}

function readWorkbookReport(buffer: Buffer) {
  const cached = workbookCache.get(buffer);

  if (cached) {
    return cached;
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === "po details") ??
    workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

  if (!sheet) {
    const report = { sheet: null, rawRows: [], headers: new Set<string>() };
    workbookCache.set(buffer, report);
    return report;
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const report: WorkbookReport = {
    sheet,
    rawRows,
    headers: getHeaders(rawRows)
  };
  workbookCache.set(buffer, report);
  return report;
}

function unsupportedReport(code: string, message: string): ParsedImportReport {
  return {
    importKind: "sales",
    reportType: WALMART_PO_REPORT_TYPE,
    reportTypeLabel: WALMART_PO_REPORT_LABEL,
    rowCount: 0,
    validCount: 0,
    rejectedCount: 1,
    issues: [{ row: 0, code, message }],
    previewRows: [{ rowNumber: 0, status: "error", message }],
    summary: {},
    payload: toJsonValue({ rows: [] }),
    duplicateVersion: WALMART_PO_DUPLICATE_VERSION
  };
}

function getHeaders(rows: Array<Record<string, unknown>>) {
  const firstRow = rows[0] ?? {};
  return new Set(Object.keys(firstRow).map(normalizeHeader));
}

function errorIssue(row: number, code: string, message: string, rawData: Record<string, unknown>) {
  return { row, code, message, rawData, severity: "error" as const };
}

function warningIssue(row: number, code: string, message: string, rawData: Record<string, unknown>) {
  return { row, code, message, rawData, severity: "warning" as const };
}

function readAliasedText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function readAliasedDate(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, 12)) : null;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(`${value.trim()}T12:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function readAliasedValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const key = Object.keys(row).find((candidate) =>
    normalizedAliases.includes(normalizeHeader(candidate))
  );

  return key ? row[key] : null;
}

function parseNumberValue(value: unknown): ParsedNumber {
  if (value === null || value === undefined || value === "") {
    return { status: "blank", value: null };
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { status: "valid", value }
      : { status: "invalid", value: null };
  }

  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed)
    ? { status: "valid", value: parsed }
    : { status: "invalid", value: null };
}

function optionalMoney(row: Record<string, unknown>, aliases: string[]) {
  const parsed = parseNumberValue(readAliasedValue(row, aliases));
  return parsed.status === "valid" ? roundMoney(parsed.value ?? 0) : null;
}

function isBlankRow(row: Record<string, unknown>) {
  return Object.values(row).every((value) => value === null || value === undefined || value === "");
}

function buildPoDuplicateKey(purchaseOrderNumber: string, purchaseOrderLineNumber: string) {
  return `${normalizeHeader(purchaseOrderNumber)}:${normalizeHeader(purchaseOrderLineNumber)}`;
}

function getOrderDate(row: WalmartPoRow) {
  return new Date(`${row.orderDate}T12:00:00.000Z`);
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function roundMoney(value: number) {
  return Math.round(value * 10000) / 10000;
}

function optionalJsonString(value: unknown) {
  const text = readJsonString(value).trim();
  return text || null;
}

function optionalJsonNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return roundMoney(readJsonNumber(value));
}

function readPoPriceSourceKind(value: unknown): WalmartPoRow["priceSourceKind"] {
  return optionalJsonString(value) === "extended_line_amount"
    ? "extended_line_amount"
    : "unit_price";
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
