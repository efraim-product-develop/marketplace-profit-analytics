import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import {
  parseSalesWorkbook as parseGenericSalesWorkbook,
  type ParsedSalesRow,
  type ParsedSalesWorkbook,
  type SalesParseOptions
} from "@/server/sales/parser";
import { commitSalesImportPayload, encodeSalesRows } from "@/server/imports/committers/sales";
import { importDb } from "@/server/imports/db";
import type {
  ImportCommitContext,
  ImportCommitResult,
  ImportReportParser,
  ParsedImportIssue,
  ParsedImportPreviewRow,
  ParsedImportReport
} from "@/server/imports/types";
import {
  compactObject,
  readNumber as readJsonNumber,
  readString as readJsonString,
  toArray,
  toJsonValue,
  toRecord
} from "@/server/imports/utils";

const ITEM_SALES_HEADERS = ["item name", "sku", "gmv", "units sold", "orders"];
const OVERVIEW_HEADERS = ["date", "gmv", "units sold", "orders"];
const PURCHASE_ORDER_HEADERS = [
  "po#",
  "order#",
  "order date",
  "line#",
  "sku",
  "qty",
  "item cost",
  "status"
];
const WALMART_ORDER_HEADER_GROUPS = [
  ["po#", "po #", "order#", "order #", "order id", "purchase order id", "purchase order number"],
  ["order date", "purchase date", "date"],
  ["sku", "seller sku", "partner sku", "item sku"],
  ["qty", "quantity", "units", "qty ordered", "quantity ordered"],
  ["item cost", "item total", "line total", "gross sales", "price", "item price", "unit price"]
];
const WALMART_ORDER_ID_ALIASES = [
  "po#",
  "po #",
  "order#",
  "order #",
  "order id",
  "purchase order id",
  "purchase order number"
];
const WALMART_CUSTOMER_ORDER_ID_ALIASES = [
  "customer order id",
  "customer order#",
  "customer order #",
  "original customer order id"
];
const WALMART_ORDER_LINE_ID_ALIASES = ["line#", "line #", "line number", "order line id"];
const WALMART_ORDER_DATE_ALIASES = ["order date", "purchase date", "date"];
const WALMART_ORDER_SKU_ALIASES = ["sku", "seller sku", "partner sku", "item sku"];
const WALMART_ORDER_QUANTITY_ALIASES = [
  "qty",
  "quantity",
  "units",
  "qty ordered",
  "quantity ordered"
];
const WALMART_ORDER_LINE_TOTAL_ALIASES = [
  "item total",
  "line total",
  "gross sales",
  "product sales",
  "item revenue",
  "line amount"
];
const WALMART_ORDER_UNIT_PRICE_ALIASES = [
  "item cost",
  "price",
  "item price",
  "unit price",
  "unit cost"
];
const WALMART_ORDER_SHIPPING_ALIASES = ["shipping", "shipping cost", "shipping revenue", "shipping charge"];
const WALMART_ORDER_TAX_ALIASES = ["tax", "tax collected", "tax amount"];
const WALMART_ORDER_REFUND_ALIASES = ["refunds", "refund", "refund amount", "refund sales"];
const WALMART_ORDER_DISCOUNT_ALIASES = ["discount", "discount amount", "promo discount"];
const WALMART_ORDER_STATUS_ALIASES = ["status", "order status"];
const WALMART_ORDER_PRODUCT_NAME_ALIASES = ["item description", "product name", "item name"];
const WALMART_ORDER_ITEM_ID_ALIASES = ["upc", "item id", "item_id", "marketplace item id", "gtin"];
const WALMART_ORDER_FULFILLMENT_ALIASES = [
  "fulfillment entity",
  "fulfillment channel",
  "fulfillment type",
  "fulfilled by"
];
const ITEM_SALES_PREVIEW_LIMIT = 50;
const ITEM_SALES_BATCH_SIZE = 1000;
const ITEM_SALES_DUPLICATE_VERSION = "walmart-item-sales-daily-v3";

type WalmartDetectedReportType = "purchase_order" | "item_sales" | null;
type WorkbookReport = {
  sheet: XLSX.WorkSheet | null;
  rawRows: Array<Record<string, unknown>>;
  headers: Set<string>;
};
type WalmartItemSalesImportRow = {
  sku: string;
  itemId: string;
  baseItemId: string | null;
  itemName: string | null;
  brand: string | null;
  department: string | null;
  gmv: number;
  unitsSold: number;
  orders: number;
  authSales: number | null;
  cancelledSales: number | null;
  refundSales: number | null;
  gmvMinusCommission: number | null;
  aur: number;
  reportDate: string;
  reportMonth: string;
  marketplace: "walmart";
  sourceRow: number;
  sourceRows: number[];
};
type ItemSalesSkipSummary = {
  skippedBlankRows: number;
  skippedZeroSalesRows: number;
  skippedMissingItemIdRows: number;
  skippedSummaryRows: number;
  skippedInvalidNumericRows: number;
  skippedDuplicateRows: number;
  aggregatedDuplicateRows: number;
  aggregatedDuplicateGroups: number;
};
type ItemSalesParseResult = {
  rows: WalmartItemSalesImportRow[];
  issues: ParsedImportIssue[];
  rowCount: number;
  reportDate: string | null;
  reportMonth: string | null;
  orderDate: Date | null;
  summary: ItemSalesSkipSummary;
};
type ParsedItemSalesNumber = {
  status: "blank" | "invalid" | "valid";
  value: number | null;
};
type ItemSalesOptionalNumberKey =
  | "orders"
  | "authSales"
  | "cancelledSales"
  | "refundSales"
  | "gmvMinusCommission"
  | "aur";
type ItemSalesOptionalNumber = {
  key: ItemSalesOptionalNumberKey;
  code: string;
  label: string;
  parsed: ParsedItemSalesNumber;
};
const workbookReportCache = new WeakMap<Buffer, WorkbookReport>();

export const walmartSalesImportParsers: ImportReportParser[] = [
  {
    importKind: "sales",
    reportType: "walmart_item_sales",
    reportTypeLabel: "Walmart Daily Item Sales Report",
    detect: (context) => detectWalmartReportType(context.buffer) === "item_sales" ? 100 : 0,
    parse: (context) => parseWalmartItemSalesImportReport(context.buffer, context.options),
    commit: commitWalmartItemSalesImportPayload
  },
  {
    importKind: "sales",
    reportType: "walmart_purchase_order",
    reportTypeLabel: "Walmart Order Report",
    detect: (context) => detectWalmartReportType(context.buffer) === "purchase_order" ? 100 : 0,
    parse: (context) =>
      salesWorkbookToImportReport({
        parsed: parseWalmartPurchaseOrderWorkbook(context.buffer, {
          reportMonth: context.options.reportMonth
        }),
        reportType: "walmart_purchase_order",
        reportTypeLabel: "Walmart Order Report"
      }),
    commit: commitSalesImportPayload
  }
];

export function parseWalmartSalesWorkbook(
  buffer: Buffer,
  options: SalesParseOptions = {}
): ParsedSalesWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find(
    (name) => normalizeHeader(name) === "po details"
  ) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          code: "WORKSHEET_NOT_FOUND",
          message: "The workbook did not contain a worksheet."
        }
      ],
      rowCount: 0
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null
  });
  const headers = getHeaders(rawRows);

  if (hasHeaders(headers, PURCHASE_ORDER_HEADERS) || hasHeaderAliasGroups(headers, WALMART_ORDER_HEADER_GROUPS)) {
    return parsePurchaseOrderReport(rawRows, options);
  }

  if (hasHeaders(headers, ITEM_SALES_HEADERS)) {
    return parseItemSalesReport(rawRows, options);
  }

  if (hasHeaders(headers, OVERVIEW_HEADERS) && !headers.has("sku")) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          code: "UNSUPPORTED_ACCOUNT_OVERVIEW",
          message:
            "Overview.csv is an account-level daily summary and is no longer used by this tool. Upload Walmart PO/order reports for sales and Walmart Payments New reports for refunds and fees."
        }
      ],
      rowCount: rawRows.length
    };
  }

  return parseGenericSalesWorkbook(buffer);
}

export function parseWalmartPurchaseOrderWorkbook(
  buffer: Buffer,
  options: SalesParseOptions = {}
) {
  const report = readWorkbookReport(buffer);

  if (!report.sheet) {
    return emptySalesWorkbook("WORKSHEET_NOT_FOUND", "The workbook did not contain a worksheet.");
  }

  return parsePurchaseOrderReport(report.rawRows, options);
}

export function parseWalmartItemSalesWorkbook(
  buffer: Buffer,
  options: SalesParseOptions = {}
) {
  const report = readWorkbookReport(buffer);

  if (!report.sheet) {
    return emptySalesWorkbook("WORKSHEET_NOT_FOUND", "The workbook did not contain a worksheet.");
  }

  return parseItemSalesReport(report.rawRows, options);
}

function parseWalmartItemSalesImportReport(
  buffer: Buffer,
  options: SalesParseOptions = {}
): ParsedImportReport {
  const report = readWorkbookReport(buffer);

  if (!report.sheet) {
    return unsupportedImportReport({
      reportType: "walmart_item_sales",
      reportTypeLabel: "Walmart Item Sales Report",
      code: "WORKSHEET_NOT_FOUND",
      message: "The workbook did not contain a worksheet."
    });
  }

  const parsed = parseOptimizedItemSalesRows(report.rawRows, options);
  const skippedRows = countSkippedItemSalesRows(parsed.summary);
  const totalGmv = parsed.rows.reduce((sum, row) => sum + row.gmv, 0);
  const totalUnits = parsed.rows.reduce((sum, row) => sum + row.unitsSold, 0);
  const totalOrders = parsed.rows.reduce((sum, row) => sum + row.orders, 0);
  const previewRows: ParsedImportPreviewRow[] = parsed.rows
    .slice(0, ITEM_SALES_PREVIEW_LIMIT)
    .map((row) => ({
      rowNumber: row.sourceRow,
      status: "valid" as const,
      normalizedData: compactObject({
        sku: row.sku,
        itemId: row.itemId,
        baseItemId: row.baseItemId,
        itemName: row.itemName,
        brand: row.brand,
        department: row.department,
        gmv: row.gmv,
        unitsSold: row.unitsSold,
        orders: row.orders,
        authSales: row.authSales,
        cancelledSales: row.cancelledSales,
        refundSales: row.refundSales,
        gmvMinusCommission: row.gmvMinusCommission,
        aur: row.aur,
        reportDate: row.reportDate,
        reportMonth: row.reportMonth,
        marketplace: row.marketplace,
        aggregatedRowCount: row.sourceRows.length,
        sourceRows: row.sourceRows
      })
    }));

  return {
    importKind: "sales",
    reportType: "walmart_item_sales",
    reportTypeLabel: "Walmart Item Sales Report",
    rowCount: parsed.rowCount,
    validCount: parsed.rows.length,
    rejectedCount: parsed.issues.length,
    issues: parsed.issues,
    previewRows,
    summary: {
      parserVersion: ITEM_SALES_DUPLICATE_VERSION,
      totalRowsRead: parsed.rowCount,
      skippedRows,
      validRows: parsed.rows.length,
      rowsToImport: parsed.rows.length,
      ...parsed.summary,
      totalGmv: roundMoney(totalGmv),
      totalUnits,
      totalOrders,
      importedRows: 0,
      updatedRows: 0,
      errors: parsed.issues.filter((issue) => issue.severity === "error").length
    },
    payload: toJsonValue({
      marketplace: "walmart",
      reportDate: parsed.reportDate,
      reportMonth: parsed.reportMonth,
      rows: parsed.rows.map(encodeWalmartItemSalesPayloadRow)
    }),
    duplicateVersion: ITEM_SALES_DUPLICATE_VERSION
  };
}

function parsePurchaseOrderReport(
  rawRows: Array<Record<string, unknown>>,
  options: SalesParseOptions
): ParsedSalesWorkbook {
  const rows: ParsedSalesRow[] = [];
  const errors: ParsedSalesWorkbook["errors"] = [];
  const seenLineKeys = new Set<string>();
  const reportMonth = options.reportMonth?.match(/^\d{4}-\d{2}$/)
    ? options.reportMonth
    : null;

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    const status = readAliasedText(rawRow, WALMART_ORDER_STATUS_ALIASES);
    const orderDate = readAliasedDate(rawRow, WALMART_ORDER_DATE_ALIASES);

    if (isCanceledStatus(status)) {
      return;
    }

    if (reportMonth && orderDate && formatReportMonth(orderDate) !== reportMonth) {
      return;
    }

    const orderId = readAliasedText(rawRow, WALMART_ORDER_ID_ALIASES);
    const customerOrderId = readAliasedText(rawRow, WALMART_CUSTOMER_ORDER_ID_ALIASES);
    const lineNumber = readAliasedText(rawRow, WALMART_ORDER_LINE_ID_ALIASES);
    const sellerSku = readAliasedText(rawRow, WALMART_ORDER_SKU_ALIASES);
    const quantity = readAliasedInteger(rawRow, WALMART_ORDER_QUANTITY_ALIASES);
    const lineTotal = readAliasedMoney(rawRow, WALMART_ORDER_LINE_TOTAL_ALIASES);
    const unitPriceValue = readAliasedMoney(rawRow, WALMART_ORDER_UNIT_PRICE_ALIASES);
    const shippingRevenue = readAliasedMoney(rawRow, WALMART_ORDER_SHIPPING_ALIASES) ?? 0;
    const taxCollected = readAliasedMoney(rawRow, WALMART_ORDER_TAX_ALIASES) ?? 0;
    const refundAmount = readAliasedMoney(rawRow, WALMART_ORDER_REFUND_ALIASES) ?? 0;
    const discountAmount = Math.abs(readAliasedMoney(rawRow, WALMART_ORDER_DISCOUNT_ALIASES) ?? 0);

    if (!orderId && !customerOrderId) {
      errors.push(
        rowError(sourceRow, "MISSING_ORDER_ID", "Missing Order ID or Customer Order ID.", rawRow)
      );
      return;
    }

    if (!orderDate) {
      errors.push(rowError(sourceRow, "INVALID_ORDER_DATE", "Missing or invalid order date.", rawRow));
      return;
    }

    if (!sellerSku) {
      errors.push(rowError(sourceRow, "MISSING_SELLER_SKU", "Missing SKU.", rawRow));
      return;
    }

    if (quantity === null || quantity <= 0) {
      errors.push(rowError(sourceRow, "INVALID_QUANTITY", "Missing or invalid quantity.", rawRow));
      return;
    }

    if (lineTotal === null && unitPriceValue === null) {
      errors.push(rowError(sourceRow, "INVALID_PRICE", "Missing or invalid price.", rawRow));
      return;
    }

    const externalOrderId = orderId || customerOrderId;
    const externalLineId = compactKey([
      externalOrderId,
      lineNumber || customerOrderId || String(sourceRow),
      sellerSku
    ]);
    const duplicateKey = compactKey([
      externalOrderId,
      lineNumber ? `line:${lineNumber}` : `sku:${sellerSku}`
    ]);

    if (seenLineKeys.has(duplicateKey)) {
      errors.push(
        rowError(
          sourceRow,
          "DUPLICATE_ORDER_LINE",
          "Skipped duplicate order line for the same order and line/SKU.",
          rawRow,
          "warning"
        )
      );
      return;
    }

    seenLineKeys.add(duplicateKey);

    const unitPrice = roundMoney(unitPriceValue ?? (lineTotal ?? 0) / quantity);
    const itemRevenue = roundMoney(lineTotal ?? unitPrice * quantity);
    const originalReferralFee = readAliasedMoney(rawRow, ["original referral fee", "referral fee"]) ?? 0;
    const referralFeeDiscount =
      readAliasedMoney(rawRow, ["reduced referral fee discount", "referral fee discount"]) ?? 0;
    const referralFee = Math.max(originalReferralFee - referralFeeDiscount, 0);

    rows.push({
      externalOrderId,
      orderDate,
      sellerSku,
      productName: readAliasedText(rawRow, WALMART_ORDER_PRODUCT_NAME_ALIASES) || undefined,
      marketplaceItemId: readAliasedText(rawRow, WALMART_ORDER_ITEM_ID_ALIASES) || undefined,
      fulfillmentChannel: readAliasedText(rawRow, WALMART_ORDER_FULFILLMENT_ALIASES) || undefined,
      quantity,
      unitPrice,
      itemRevenue,
      shippingRevenue,
      taxCollected,
      discountAmount,
      feeType: referralFee > 0 ? "referral_fee" : undefined,
      feeAmount: referralFee > 0 ? -Math.abs(referralFee) : 0,
      refundAmount: refundAmount !== 0 ? Math.abs(refundAmount) : undefined,
      refundDate: refundAmount !== 0 ? orderDate : undefined,
      currency: "USD",
      status: status || undefined,
      externalLineId,
      sourceRow,
      metadata: {
        reportType: "walmart_purchase_order",
        orderId: orderId || null,
        customerOrderId: customerOrderId || null,
        lineNumber: lineNumber || null,
        refundAmount: refundAmount !== 0 ? Math.abs(refundAmount) : null,
        upc: readAliasedText(rawRow, ["upc"]) || null,
        condition: readAliasedText(rawRow, ["condition"]) || null,
        fulfillmentEntity: readAliasedText(rawRow, ["fulfillment entity"]) || null,
        shippingMethod: readAliasedText(rawRow, ["shipping method"]) || null,
        shippingTier: readAliasedText(rawRow, ["shipping tier"]) || null,
        carrier: readAliasedText(rawRow, ["carrier"]) || null,
        replacementOrder: readAliasedText(rawRow, ["replacement order"]) || null,
        originalCustomerOrderId: readAliasedText(rawRow, ["original customer order id"]) || null,
        shipNodeId: readAliasedText(rawRow, ["ship node id"]) || null,
        shipNode: readAliasedText(rawRow, ["ship node"]) || null
      }
    });
  });

  return {
    rows,
    errors,
    rowCount: rawRows.length
  };
}

function parseItemSalesReport(
  rawRows: Array<Record<string, unknown>>,
  options: SalesParseOptions
): ParsedSalesWorkbook {
  const parsed = parseOptimizedItemSalesRows(rawRows, options);
  const rows = parsed.orderDate
    ? parsed.rows.map((row) => itemSalesImportRowToSalesRow(row, parsed.orderDate as Date))
    : [];

  return {
    rows,
    errors: parsed.issues.map((issue) => ({
      row: issue.row,
      code: issue.code,
      message: issue.message,
      rawData: issue.rawData
    })),
    rowCount: rawRows.length
  };
}

function parseOptimizedItemSalesRows(
  rawRows: Array<Record<string, unknown>>,
  options: SalesParseOptions
): ItemSalesParseResult {
  const orderDate = getDailyReportDate(options.reportDate);
  const summary = emptyItemSalesSkipSummary();

  if (!orderDate) {
    return {
      rows: [],
      issues: [
        {
          row: 0,
          code: "MISSING_REPORT_DATE",
          message: "Choose the Item Sales report date before importing a Walmart item sales report.",
          severity: "error"
        }
      ],
      rowCount: rawRows.length,
      reportDate: null,
      reportMonth: null,
      orderDate: null,
      summary
    };
  }

  const reportDate = formatReportDate(orderDate);
  const reportMonth = formatReportMonth(orderDate);
  const rows: WalmartItemSalesImportRow[] = [];
  const issues: ParsedImportIssue[] = [];
  const rowsByKey = new Map<string, WalmartItemSalesImportRow>();

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    const sku = readAliasedText(rawRow, ["sku"]);
    const itemId = readAliasedText(rawRow, ["item id"]);
    const baseItemId = readAliasedText(rawRow, ["base item id"]) || null;
    const itemName = readAliasedText(rawRow, ["item name"]) || null;
    const brand = readAliasedText(rawRow, ["brand"]) || null;
    const department = readAliasedText(rawRow, ["department"]) || null;
    const gmv = parseAliasedNumericValue(rawRow, ["gmv"]);
    const unitsSold = parseAliasedNumericValue(rawRow, ["units sold"]);

    if (isBlankItemSalesRow({ sku, itemId, itemName, baseItemId, gmv, unitsSold })) {
      summary.skippedBlankRows += 1;
      issues.push(itemSalesSkipIssue(sourceRow, "BLANK_ROW", "Skipped blank row.", rawRow));
      return;
    }

    const summaryCandidates = [sku, itemId, itemName, baseItemId].filter(
      (value): value is string => Boolean(value)
    );

    if (isItemSalesSummaryRow(rawRow, summaryCandidates)) {
      summary.skippedSummaryRows += 1;
      issues.push(
        itemSalesSkipIssue(sourceRow, "SUMMARY_ROW", "Skipped total or summary row.", rawRow)
      );
      return;
    }

    if (!sku) {
      summary.skippedBlankRows += 1;
      issues.push(itemSalesSkipIssue(sourceRow, "MISSING_SKU", "Skipped row with missing SKU.", rawRow));
      return;
    }

    if (!itemId) {
      summary.skippedMissingItemIdRows += 1;
      issues.push(
        itemSalesSkipIssue(
          sourceRow,
          "MISSING_ITEM_ID",
          "Skipped row with missing Item_id.",
          rawRow
        )
      );
      return;
    }

    if (gmv.status === "invalid") {
      summary.skippedInvalidNumericRows += 1;
      issues.push(itemSalesError(sourceRow, "INVALID_GMV", "Skipped row with invalid GMV.", rawRow));
      return;
    }

    if (unitsSold.status === "invalid") {
      summary.skippedInvalidNumericRows += 1;
      issues.push(
        itemSalesError(
          sourceRow,
          "INVALID_UNITS_SOLD",
          "Skipped row with invalid Units_Sold.",
          rawRow
        )
      );
      return;
    }

    if (gmv.status === "blank" || (gmv.value ?? 0) <= 0) {
      summary.skippedZeroSalesRows += 1;
      issues.push(
        itemSalesSkipIssue(sourceRow, "ZERO_OR_BLANK_GMV", "Skipped row with blank or zero GMV.", rawRow)
      );
      return;
    }

    if (unitsSold.status === "blank" || (unitsSold.value ?? 0) <= 0) {
      summary.skippedZeroSalesRows += 1;
      issues.push(
        itemSalesSkipIssue(
          sourceRow,
          "ZERO_OR_BLANK_UNITS",
          "Skipped row with blank or zero Units_Sold.",
          rawRow
        )
      );
      return;
    }

    const optionalNumbers = readItemSalesOptionalNumbers(rawRow);
    const invalidOptionalField = optionalNumbers.find((field) => field.parsed.status === "invalid");

    if (invalidOptionalField) {
      summary.skippedInvalidNumericRows += 1;
      issues.push(
        itemSalesError(
          sourceRow,
          `INVALID_${invalidOptionalField.code}`,
          `Skipped row with invalid ${invalidOptionalField.label}.`,
          rawRow
        )
      );
      return;
    }

    const units = Math.trunc(unitsSold.value ?? 0);
    const gmvValue = roundMoney(gmv.value ?? 0);
    const orders = Math.max(
      Math.trunc(optionalNumbers.find((field) => field.key === "orders")?.parsed.value ?? 0),
      0
    );
    const aur = roundMoney(
      optionalNumbers.find((field) => field.key === "aur")?.parsed.value ?? gmvValue / units
    );

    const normalizedRow: WalmartItemSalesImportRow = {
      sku,
      itemId,
      baseItemId,
      itemName,
      brand,
      department,
      gmv: gmvValue,
      unitsSold: units,
      orders,
      authSales: optionalItemSalesNumber(optionalNumbers, "authSales"),
      cancelledSales: optionalItemSalesNumber(optionalNumbers, "cancelledSales"),
      refundSales: optionalItemSalesNumber(optionalNumbers, "refundSales"),
      gmvMinusCommission: optionalItemSalesNumber(optionalNumbers, "gmvMinusCommission"),
      aur,
      reportDate,
      reportMonth,
      marketplace: "walmart",
      sourceRow,
      sourceRows: [sourceRow]
    };
    const rowKey = buildItemSalesUniqueKey(normalizedRow);
    const existingRow = rowsByKey.get(rowKey);

    if (existingRow) {
      if (existingRow.sourceRows.length === 1) {
        summary.aggregatedDuplicateGroups += 1;
      }

      summary.aggregatedDuplicateRows += 1;
      mergeItemSalesRows(existingRow, normalizedRow);
      return;
    }

    rowsByKey.set(rowKey, normalizedRow);
    rows.push(normalizedRow);
  });

  return {
    rows,
    issues,
    rowCount: rawRows.length,
    reportDate,
    reportMonth,
    orderDate,
    summary
  };
}

function mergeItemSalesRows(target: WalmartItemSalesImportRow, incoming: WalmartItemSalesImportRow) {
  target.gmv = roundMoney(target.gmv + incoming.gmv);
  target.unitsSold += incoming.unitsSold;
  target.orders += incoming.orders;
  target.authSales = addNullableMoney(target.authSales, incoming.authSales);
  target.cancelledSales = addNullableMoney(target.cancelledSales, incoming.cancelledSales);
  target.refundSales = addNullableMoney(target.refundSales, incoming.refundSales);
  target.gmvMinusCommission = addNullableMoney(
    target.gmvMinusCommission,
    incoming.gmvMinusCommission
  );
  target.aur = target.unitsSold > 0 ? roundMoney(target.gmv / target.unitsSold) : 0;
  target.sourceRows.push(...incoming.sourceRows);
}

function addNullableMoney(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return null;
  }

  return roundMoney((left ?? 0) + (right ?? 0));
}

function itemSalesImportRowToSalesRow(
  row: WalmartItemSalesImportRow,
  orderDate: Date
): ParsedSalesRow {
  const commission = getItemSalesCommission(row);

  return {
    externalOrderId: buildItemSalesExternalOrderId(row),
    orderDate,
    sellerSku: row.sku,
    parentSku: row.baseItemId ?? undefined,
    productName: row.itemName ?? undefined,
    brand: row.brand ?? undefined,
    marketplaceItemId: row.itemId,
    quantity: row.unitsSold,
    unitPrice: row.aur,
    itemRevenue: row.gmv,
    shippingRevenue: 0,
    taxCollected: 0,
    discountAmount: 0,
    feeType: "item_sales_summary",
    feeAmount: 0,
    currency: "USD",
    status: "daily_summary",
    externalLineId: buildItemSalesExternalLineId(row),
    sourceRow: row.sourceRow || 0,
    metadata: {
      ...buildItemSalesMetadata(row),
      estimatedCommissionFromItemSales: commission
    }
  };
}

function emptyItemSalesSkipSummary(): ItemSalesSkipSummary {
  return {
    skippedBlankRows: 0,
    skippedZeroSalesRows: 0,
    skippedMissingItemIdRows: 0,
    skippedSummaryRows: 0,
    skippedInvalidNumericRows: 0,
    skippedDuplicateRows: 0,
    aggregatedDuplicateRows: 0,
    aggregatedDuplicateGroups: 0
  };
}

function countSkippedItemSalesRows(summary: ItemSalesSkipSummary) {
  return (
    summary.skippedBlankRows +
    summary.skippedZeroSalesRows +
    summary.skippedMissingItemIdRows +
    summary.skippedSummaryRows +
    summary.skippedInvalidNumericRows +
    summary.skippedDuplicateRows
  );
}

function itemSalesSkipIssue(
  row: number,
  code: string,
  message: string,
  _rawData: Record<string, unknown>
): ParsedImportIssue {
  return { row, code, message, severity: "warning" };
}

function itemSalesError(
  row: number,
  code: string,
  message: string,
  _rawData: Record<string, unknown>
): ParsedImportIssue {
  return { row, code, message, severity: "error" };
}

function readItemSalesOptionalNumbers(rawRow: Record<string, unknown>): ItemSalesOptionalNumber[] {
  return [
    {
      key: "orders",
      code: "ORDERS",
      label: "Orders",
      parsed: parseAliasedNumericValue(rawRow, ["orders"])
    },
    {
      key: "authSales",
      code: "AUTH_SALES",
      label: "Auth_Sales",
      parsed: parseAliasedNumericValue(rawRow, ["auth sales"])
    },
    {
      key: "cancelledSales",
      code: "CANCELLED_SALES",
      label: "Cancelled_Sales",
      parsed: parseAliasedNumericValue(rawRow, ["cancelled sales"])
    },
    {
      key: "refundSales",
      code: "REFUND_SALES",
      label: "Refund_Sales",
      parsed: parseAliasedNumericValue(rawRow, ["refund sales"])
    },
    {
      key: "gmvMinusCommission",
      code: "GMV_MINUS_COMMISSION",
      label: "GMV_Minus_Commission",
      parsed: parseAliasedNumericValue(rawRow, ["gmv minus commission"])
    },
    {
      key: "aur",
      code: "AUR",
      label: "AUR",
      parsed: parseAliasedNumericValue(rawRow, ["aur"])
    }
  ];
}

function optionalItemSalesNumber(
  numbers: ItemSalesOptionalNumber[],
  key: ItemSalesOptionalNumberKey
) {
  const parsed = numbers.find((field) => field.key === key)?.parsed;
  return parsed?.status === "valid" ? roundMoney(parsed.value ?? 0) : null;
}

function parseAliasedNumericValue(
  row: Record<string, unknown>,
  aliases: string[]
): ParsedItemSalesNumber {
  const value = readAliasedValue(row, aliases);

  if (value === null || value === undefined || value === "") {
    return { status: "blank", value: null };
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { status: "valid", value }
      : { status: "invalid", value: null };
  }

  const normalized = String(value).replace(/[$,%\s,]/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed)
    ? { status: "valid", value: parsed }
    : { status: "invalid", value: null };
}

function readAliasedText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function isBlankItemSalesRow({
  sku,
  itemId,
  itemName,
  baseItemId,
  gmv,
  unitsSold
}: {
  sku: string;
  itemId: string;
  itemName: string | null;
  baseItemId: string | null;
  gmv: ParsedItemSalesNumber;
  unitsSold: ParsedItemSalesNumber;
}) {
  return (
    !sku &&
    !itemId &&
    !itemName &&
    !baseItemId &&
    gmv.status === "blank" &&
    unitsSold.status === "blank"
  );
}

function isItemSalesSummaryRow(rawRow: Record<string, unknown>, values: string[]) {
  const summaryLabels = new Set(["total", "totals", "summary", "subtotal", "grand total"]);
  const candidateValues = values.length
    ? values
    : Object.values(rawRow)
      .filter((value) => typeof value === "string")
      .map(String);

  return candidateValues.some((value) => summaryLabels.has(normalizeHeader(value)));
}

function buildItemSalesExternalOrderId(row: WalmartItemSalesImportRow) {
  return `walmart-item-sales:${buildItemSalesUniqueKey(row)}`;
}

function buildItemSalesExternalLineId(row: WalmartItemSalesImportRow) {
  return `walmart-item-sales-line:${buildItemSalesUniqueKey(row)}`;
}

function buildItemSalesUniqueKey(row: WalmartItemSalesImportRow) {
  return compactKey([row.reportDate, row.sku, row.itemId]);
}

function getItemSalesCommission(row: WalmartItemSalesImportRow) {
  return row.gmvMinusCommission === null
    ? 0
    : roundMoney(row.gmv - row.gmvMinusCommission);
}

function buildItemSalesMetadata(row: WalmartItemSalesImportRow) {
  return compactObject({
    reportDate: row.reportDate,
    reportMonth: row.reportMonth,
    marketplace: row.marketplace,
    itemId: row.itemId,
    baseItemId: row.baseItemId,
    itemName: row.itemName,
    brand: row.brand,
    department: row.department,
    gmv: row.gmv,
    unitsSold: row.unitsSold,
    orders: row.orders,
    authSales: row.authSales,
    cancelledSales: row.cancelledSales,
    refundSales: row.refundSales,
    gmvMinusCommission: row.gmvMinusCommission,
    aur: row.aur,
    sourceGrain: "daily",
    aggregatedRowCount: row.sourceRows.length,
    sourceRows: row.sourceRows
  });
}

async function commitWalmartItemSalesImportPayload(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const importRun = await importDb.importRun.findUnique({
    where: { id: context.importRunId },
    include: { issues: true }
  });
  const rows = decodeWalmartItemSalesRows(payload);

  if (!rows.length) {
    return {
      importedCount: 0,
      summary: {
        importedRows: 0,
        updatedRows: 0,
        errors: importRun?.issues.filter((issue) => issue.severity === "error").length ?? 0
      }
    };
  }

  const salesImport = await prisma.salesImport.create({
    data: {
      organizationId: context.organizationId,
      marketplace: "walmart",
      source: "walmart_item_sales_import",
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

  let importedRows = 0;
  let updatedRows = 0;

  for (const rowChunk of chunkArray(rows, ITEM_SALES_BATCH_SIZE)) {
    await prisma.$transaction(async (tx) => {
      const externalOrderIds = rowChunk.map(buildItemSalesExternalOrderId);
      const existingOrders = await tx.salesOrder.findMany({
        where: {
          organizationId: context.organizationId,
          marketplace: "walmart",
          externalOrderId: { in: externalOrderIds }
        },
        select: { externalOrderId: true }
      });
      const existingOrderIds = new Set(existingOrders.map((order) => order.externalOrderId));
      updatedRows += existingOrderIds.size;
      importedRows += rowChunk.length - existingOrderIds.size;

      const { productsBySku, listingsBySku } = await ensureItemSalesProductsAndListings(
        tx,
        context.organizationId,
        rowChunk
      );
      const orderDate = getDailyReportDate(rowChunk[0]?.reportDate) ?? new Date();

      await tx.salesOrder.updateMany({
        where: {
          organizationId: context.organizationId,
          marketplace: "walmart",
          externalOrderId: { in: externalOrderIds }
        },
        data: {
          importId: salesImport.id,
          orderDate,
          status: "daily_summary",
          currency: "USD"
        }
      });

      await tx.salesOrder.createMany({
        data: rowChunk.map((row) => ({
          organizationId: context.organizationId,
          importId: salesImport.id,
          marketplace: "walmart",
          externalOrderId: buildItemSalesExternalOrderId(row),
          orderDate,
          status: "daily_summary",
          currency: "USD"
        })),
        skipDuplicates: true
      });

      const orders = await tx.salesOrder.findMany({
        where: {
          organizationId: context.organizationId,
          marketplace: "walmart",
          externalOrderId: { in: externalOrderIds }
        },
        select: { id: true, externalOrderId: true }
      });
      const ordersByExternalId = new Map(
        orders.map((order) => [order.externalOrderId, order.id])
      );
      const orderIds = orders.map((order) => order.id);

      if (orderIds.length) {
        await tx.marketplaceFee.deleteMany({
          where: { organizationId: context.organizationId, orderId: { in: orderIds } }
        });
        await tx.salesOrderItem.deleteMany({
          where: { organizationId: context.organizationId, orderId: { in: orderIds } }
        });
      }

      const itemRows = rowChunk.flatMap((row) => {
        const orderId = ordersByExternalId.get(buildItemSalesExternalOrderId(row));

        if (!orderId) {
          return [];
        }

        const product = productsBySku.get(row.sku);
        const listing = listingsBySku.get(row.sku);
        const itemId = randomUUID();

        return [
          {
            itemId,
            row,
            data: {
              id: itemId,
              organizationId: context.organizationId,
              orderId,
              productId: product?.id,
              listingId: listing?.id,
              marketplace: "walmart",
              sellerSku: row.sku,
              parentSku: row.baseItemId,
              externalLineId: buildItemSalesExternalLineId(row),
              sourceRow: row.sourceRow || undefined,
              quantity: row.unitsSold,
              unitPrice: row.aur,
              itemRevenue: row.gmv,
              shippingRevenue: 0,
              taxCollected: 0,
              discountAmount: 0
            }
          }
        ];
      });

      if (itemRows.length) {
        await tx.salesOrderItem.createMany({
          data: itemRows.map((item) => item.data)
        });
        await tx.marketplaceFee.createMany({
          data: itemRows.map((item) => {
            return {
              organizationId: context.organizationId,
              orderId: item.data.orderId,
              orderItemId: item.itemId,
              marketplace: "walmart",
              sellerSku: item.row.sku,
              feeType: "item_sales_summary",
              feeAmount: 0,
              currency: "USD",
              postedAt: orderDate,
              metadata: toJsonValue(buildItemSalesMetadata(item.row))
            };
          })
        });
      }
    }, { maxWait: 10000, timeout: 60000 });
  }

  const importedCount = importedRows + updatedRows;

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
      errors: importRun?.issues.filter((issue) => issue.severity === "error").length ?? 0
    }
  };
}

function encodeWalmartItemSalesPayloadRow(row: WalmartItemSalesImportRow) {
  return {
    sku: row.sku,
    itemId: row.itemId,
    baseItemId: row.baseItemId,
    itemName: row.itemName,
    brand: row.brand,
    department: row.department,
    gmv: row.gmv,
    unitsSold: row.unitsSold,
    orders: row.orders,
    authSales: row.authSales,
    cancelledSales: row.cancelledSales,
    refundSales: row.refundSales,
    gmvMinusCommission: row.gmvMinusCommission,
    aur: row.aur,
    reportDate: row.reportDate,
    reportMonth: row.reportMonth,
    marketplace: row.marketplace,
    sourceRow: row.sourceRow,
    sourceRows: row.sourceRows
  };
}

function decodeWalmartItemSalesRows(payload: Prisma.JsonValue): WalmartItemSalesImportRow[] {
  const record = toRecord(payload);

  return toArray(record.rows)
    .map((value) => {
      const row = toRecord(value as Prisma.JsonValue);
      const reportDate = readJsonString(row.reportDate);
      const reportMonth = readJsonString(row.reportMonth);
      const sourceRow = Math.trunc(optionalJsonNumber(row.sourceRow) ?? 0);
      const sourceRows = toArray(row.sourceRows)
        .map((value) => (typeof value === "number" ? Math.trunc(value) : Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0);

      return {
        sku: readJsonString(row.sku),
        itemId: readJsonString(row.itemId),
        baseItemId: optionalJsonString(row.baseItemId),
        itemName: optionalJsonString(row.itemName),
        brand: optionalJsonString(row.brand),
        department: optionalJsonString(row.department),
        gmv: readJsonNumber(row.gmv),
        unitsSold: Math.trunc(readJsonNumber(row.unitsSold)),
        orders: Math.trunc(readJsonNumber(row.orders)),
        authSales: optionalJsonNumber(row.authSales),
        cancelledSales: optionalJsonNumber(row.cancelledSales),
        refundSales: optionalJsonNumber(row.refundSales),
        gmvMinusCommission: optionalJsonNumber(row.gmvMinusCommission),
        aur: readJsonNumber(row.aur),
        reportDate,
        reportMonth,
        marketplace: "walmart" as const,
        sourceRow,
        sourceRows: sourceRows.length ? sourceRows : sourceRow > 0 ? [sourceRow] : []
      };
    })
    .filter((row) => row.sku && row.itemId && row.reportDate && row.reportMonth && row.gmv > 0 && row.unitsSold > 0);
}

async function ensureItemSalesProductsAndListings(
  tx: Prisma.TransactionClient,
  organizationId: string,
  rows: WalmartItemSalesImportRow[]
) {
  const parentRows = getRepresentativeItemSalesRows(rows, (row) => row.baseItemId ?? "");
  const skuRows = getRepresentativeItemSalesRows(rows, (row) => row.sku);

  if (parentRows.length) {
    await tx.product.createMany({
      data: parentRows
        .filter((row) => row.baseItemId)
        .map((row) => ({
          organizationId,
          internalSku: row.baseItemId,
          title: row.itemName,
          brand: row.brand
        })),
      skipDuplicates: true
    });
  }

  if (skuRows.length) {
    await tx.product.createMany({
      data: skuRows.map((row) => ({
        organizationId,
        internalSku: row.sku,
        parentSku: row.baseItemId,
        title: row.itemName,
        brand: row.brand
      })),
      skipDuplicates: true
    });
  }

  const products = await tx.product.findMany({
    where: {
      organizationId,
      internalSku: { in: skuRows.map((row) => row.sku) }
    },
    select: { id: true, internalSku: true, parentSku: true }
  });
  const productsBySku = new Map(
    products.flatMap((product) =>
      product.internalSku ? [[product.internalSku, product]] as const : []
    )
  );

  if (skuRows.length) {
    await tx.listing.createMany({
      data: skuRows.map((row) => ({
        organizationId,
        productId: productsBySku.get(row.sku)?.id,
        marketplace: "walmart",
        sellerSku: row.sku,
        parentSku: row.baseItemId,
        marketplaceItemId: row.itemId,
        title: row.itemName
      })),
      skipDuplicates: true
    });
  }

  const listings = await tx.listing.findMany({
    where: {
      organizationId,
      marketplace: "walmart",
      sellerSku: { in: skuRows.map((row) => row.sku) }
    },
    select: { id: true, sellerSku: true, parentSku: true }
  });
  const listingsBySku = new Map(listings.map((listing) => [listing.sellerSku, listing]));

  return { productsBySku, listingsBySku };
}

function getRepresentativeItemSalesRows(
  rows: WalmartItemSalesImportRow[],
  getKey: (row: WalmartItemSalesImportRow) => string
) {
  const rowsByKey = new Map<string, WalmartItemSalesImportRow>();

  for (const row of rows) {
    const key = getKey(row);

    if (key && !rowsByKey.has(key)) {
      rowsByKey.set(key, row);
    }
  }

  return Array.from(rowsByKey.values());
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

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function salesWorkbookToImportReport({
  parsed,
  reportType,
  reportTypeLabel
}: {
  parsed: ParsedSalesWorkbook;
  reportType: string;
  reportTypeLabel: string;
}): ParsedImportReport {
  const summary = summarizeSalesRows(parsed.rows);
  const issues = parsed.errors.map((error) => ({
    row: error.row,
    code: error.code,
    message: error.message,
    severity: error.severity ?? ("error" as const),
    rawData: error.rawData
  }));
  const previewRows: ParsedImportPreviewRow[] = [
    ...parsed.rows.map((row) => ({
      rowNumber: row.sourceRow,
      status: "valid" as const,
      normalizedData: compactObject({
        orderDate: row.orderDate.toISOString(),
        orderId: row.externalOrderId,
        sellerSku: row.sellerSku,
        parentSku: row.parentSku,
        units: row.quantity,
        sales: row.itemRevenue,
        shipping: row.shippingRevenue,
        tax: row.taxCollected,
        refunds: row.refundAmount,
        fees: row.feeAmount,
        status: row.status
      })
    })),
    ...issues.map((issue) => ({
      rowNumber: issue.row,
      status: "error" as const,
      message: issue.message,
      rawData: issue.rawData
    }))
  ].sort((a, b) => a.rowNumber - b.rowNumber);

  return {
    importKind: "sales",
    reportType,
    reportTypeLabel,
    rowCount: parsed.rowCount,
    validCount: parsed.rows.length,
    rejectedCount: issues.length,
    issues,
    previewRows,
    summary,
    payload: toJsonValue({ rows: encodeSalesRows(parsed.rows) })
  };
}

function summarizeSalesRows(rows: ParsedSalesRow[]) {
  const orderIds = new Set(rows.map((row) => row.externalOrderId));
  const totalSales = rows.reduce((sum, row) => sum + row.itemRevenue, 0);
  const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalFees = rows.reduce((sum, row) => sum + row.feeAmount, 0);
  const totalShipping = rows.reduce((sum, row) => sum + row.shippingRevenue, 0);
  const totalTax = rows.reduce((sum, row) => sum + row.taxCollected, 0);
  const totalRefunds = rows.reduce((sum, row) => sum + (row.refundAmount ?? 0), 0);
  const importedOrderCount = rows.reduce(
    (sum, row) => sum + readMetadataOrderCount(row.metadata),
    0
  );

  return {
    totalSales: roundMoney(totalSales),
    totalUnits,
    totalOrders: importedOrderCount || orderIds.size,
    totalShipping: roundMoney(totalShipping),
    totalTax: roundMoney(totalTax),
    totalFees: roundMoney(totalFees),
    totalRefunds: roundMoney(totalRefunds)
  };
}

function readMetadataOrderCount(metadata?: Record<string, unknown>) {
  const orders = metadata?.orders;

  if (typeof orders === "number" && Number.isFinite(orders)) {
    return orders;
  }

  if (typeof orders === "string") {
    const parsed = Number(orders);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function detectWalmartReportType(buffer: Buffer): WalmartDetectedReportType {
  const report = readWorkbookReport(buffer);

  if (!report.sheet) {
    return null;
  }

  if (
    hasHeaders(report.headers, PURCHASE_ORDER_HEADERS) ||
    hasHeaderAliasGroups(report.headers, WALMART_ORDER_HEADER_GROUPS)
  ) {
    return "purchase_order";
  }

  if (hasHeaders(report.headers, ITEM_SALES_HEADERS)) {
    return "item_sales";
  }

  return null;
}

function readWorkbookReport(buffer: Buffer) {
  const cached = workbookReportCache.get(buffer);

  if (cached) {
    return cached;
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames.find(
    (name) => normalizeHeader(name) === "po details"
  ) ?? workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

  if (!sheet) {
    const emptyReport: WorkbookReport = {
      sheet: null,
      rawRows: [] as Array<Record<string, unknown>>,
      headers: new Set<string>()
    };
    workbookReportCache.set(buffer, emptyReport);
    return emptyReport;
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null
  });

  const report: WorkbookReport = {
    sheet,
    rawRows,
    headers: getHeaders(rawRows)
  };
  workbookReportCache.set(buffer, report);
  return report;
}

function emptySalesWorkbook(code: string, message: string): ParsedSalesWorkbook {
  return {
    rows: [],
    errors: [{ row: 0, code, message }],
    rowCount: 0
  };
}

function unsupportedImportReport({
  reportType,
  reportTypeLabel,
  code,
  message
}: {
  reportType: string;
  reportTypeLabel: string;
  code: string;
  message: string;
}): ParsedImportReport {
  return {
    importKind: "sales",
    reportType,
    reportTypeLabel,
    rowCount: 0,
    validCount: 0,
    rejectedCount: 1,
    issues: [{ row: 0, code, message }],
    previewRows: [{ rowNumber: 0, status: "error", message }],
    summary: {},
    payload: toJsonValue({ rows: [] })
  };
}

function getHeaders(rows: Array<Record<string, unknown>>) {
  const firstRow = rows[0] ?? {};
  return new Set(Object.keys(firstRow).map(normalizeHeader));
}

function hasHeaders(headers: Set<string>, required: string[]) {
  return required.every((header) => headers.has(header));
}

function hasHeaderAliasGroups(headers: Set<string>, requiredGroups: string[][]) {
  return requiredGroups.every((aliases) =>
    aliases.some((alias) => headers.has(normalizeHeader(alias)))
  );
}

function rowError(
  row: number,
  code: string,
  message: string,
  rawData: Record<string, unknown>,
  severity?: "error" | "warning"
) {
  return { row, code, message, rawData, severity };
}

function readText(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

function readInteger(row: Record<string, unknown>, key: string) {
  const value = readNumber(row, key);
  return value === null ? null : Math.trunc(value);
}

function readAliasedInteger(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedNumber(row, aliases);
  return value === null ? null : Math.trunc(value);
}

function readMoney(row: Record<string, unknown>, key: string) {
  const value = readNumber(row, key);
  return value === null ? null : roundMoney(value);
}

function readAliasedMoney(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedNumber(row, aliases);
  return value === null ? null : roundMoney(value);
}

function readDate(row: Record<string, unknown>, key: string) {
  const value = row[key];

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function readAliasedDate(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)) : null;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function readNumber(row: Record<string, unknown>, key: string) {
  const value = row[key];

  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readAliasedNumber(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);

  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readAliasedValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const key = Object.keys(row).find((candidate) =>
    normalizedAliases.includes(normalizeHeader(candidate))
  );

  return key ? row[key] : null;
}

function isCanceledStatus(status: string) {
  return status.toLowerCase().includes("cancel");
}

function getReportMonthEndDate(reportMonth?: string) {
  const match = reportMonth?.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function getDailyReportDate(reportDate?: string) {
  const match = reportDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function formatReportDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatReportMonth(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function compactKey(parts: string[]) {
  return parts
    .filter(Boolean)
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

function roundMoney(value: number) {
  return Math.round(value * 10000) / 10000;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
