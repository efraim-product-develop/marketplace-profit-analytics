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
import { readNumber, toArray, toJsonValue, toRecord } from "../../imports/utils.ts";

const PAYMENTS_NEW_HEADERS = [
  "period start date",
  "period end date",
  "transaction posted timestamp",
  "transaction type",
  "amount",
  "amount type"
];
const PREVIEW_LIMIT = 50;
const CREATE_CHUNK_SIZE = 500;
const DUPLICATE_VERSION = "walmart-payments-new-v7-inherit-payment-summary-period";
const SEM_AD_SOURCE = "walmart_seller_center_sem";

type SettlementReportPeriod = {
  periodStartDate: string | null;
  periodEndDate: string | null;
};

type WalmartPaymentSettlementRow = {
  rowNumber: number;
  postedAt: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  periodDateSource: "row" | "payment_summary" | "missing";
  transactionType: string;
  transactionDescription: string;
  transactionReasonDescription: string | null;
  externalOrderId: string | null;
  externalLineId: string | null;
  sellerSku: string | null;
  itemName: string | null;
  amount: number;
  amountType: string;
  currency: string;
  feeType: string | null;
  target: "marketplace_fee" | "advertising_cost" | "refund" | "skip";
  skipReason: string | null;
  fulfillmentType: string | null;
  fulfillmentDetails: string | null;
  duplicateKey: string;
};

type SettlementParseSummary = {
  totalRows: number;
  validRows: number;
  skippedRows: number;
  feeRows: number;
  advertisingRows: number;
  refundRows: number;
  commissionFeeTotal: number;
  fulfillmentFeeTotal: number;
  returnFeeTotal: number;
  refundSalesTotal: number;
  storageFeeTotal: number;
  adjustmentTotal: number;
  otherFeeTotal: number;
  semAdvertisingTotal: number;
  skippedProductAndTaxRows: number;
  paymentSummaryPeriodStart: string | null;
  paymentSummaryPeriodEnd: string | null;
  inheritedPaymentSummaryPeriodRows: number;
  missingPeriodRows: number;
};

export const walmartSettlementImportParsers: ImportReportParser[] = [
  {
    importKind: "settlements",
    reportType: "walmart_payments_new",
    reportTypeLabel: "Walmart Payments New Report",
    detect(context) {
      const report = readWorkbook(context.buffer);

      if (!report.rawRows.length) {
        return 0;
      }

      return hasHeaders(report.headers, PAYMENTS_NEW_HEADERS) ? 100 : 0;
    },
    parse(context) {
      return parseWalmartPaymentsNewReport(context.buffer);
    },
    commit: commitWalmartPaymentsNewReport
  }
];

function parseWalmartPaymentsNewReport(buffer: Buffer): ParsedImportReport {
  const report = readWorkbook(buffer);
  const issues: ParsedImportIssue[] = [];
  const previewRows: ParsedImportPreviewRow[] = [];
  const rows: WalmartPaymentSettlementRow[] = [];
  const seenKeys = new Set<string>();
  const reportPeriod = getPaymentSummaryPeriod(report.rawRows);
  let skippedRows = 0;
  let skippedProductAndTaxRows = 0;

  report.rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const parsed = parseSettlementRow(rawRow, rowNumber, reportPeriod);

    if (!parsed) {
      skippedRows += 1;
      return;
    }

    if (parsed.target === "skip") {
      skippedRows += 1;

      if (parsed.skipReason === "product_or_tax") {
        skippedProductAndTaxRows += 1;
      }

      return;
    }

    if (seenKeys.has(parsed.duplicateKey)) {
      skippedRows += 1;
      issues.push({
        row: rowNumber,
        severity: "warning",
        code: "DUPLICATE_SETTLEMENT_ROW",
        message: "Duplicate settlement row inside the file was skipped.",
        rawData: rawRow
      });
      return;
    }

    seenKeys.add(parsed.duplicateKey);
    rows.push(parsed);

    if (previewRows.length < PREVIEW_LIMIT) {
      previewRows.push({
        rowNumber,
        status: "valid",
        normalizedData: previewSettlementRow(parsed)
      });
    }
  });

  const summary = summarizeSettlementRows(rows, {
    totalRows: report.rawRows.length,
    skippedRows,
    skippedProductAndTaxRows,
    paymentSummaryPeriodStart: reportPeriod.periodStartDate,
    paymentSummaryPeriodEnd: reportPeriod.periodEndDate
  });

  return {
    importKind: "settlements",
    reportType: "walmart_payments_new",
    reportTypeLabel: "Walmart Payments New Report",
    rowCount: report.rawRows.length,
    validCount: rows.length,
    rejectedCount: issues.filter((issue) => issue.severity !== "warning").length,
    issues,
    previewRows,
    summary,
    payload: toJsonValue({ rows }),
    duplicateVersion: DUPLICATE_VERSION
  };
}

async function commitWalmartPaymentsNewReport(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const rows = decodeSettlementRows(payload);

  if (!rows.length) {
    return {
      importedCount: 0,
      summary: { importedRows: 0 }
    };
  }

  const sellerSkus = uniqueStrings(rows.map((row) => row.sellerSku));
  const parentSkuBySellerSku = await loadParentSkuMap(context.organizationId, sellerSkus);
  const feeRows = rows.filter((row) => row.target === "marketplace_fee" && row.feeType);
  const advertisingRows = rows.filter((row) => row.target === "advertising_cost");
  const refundRows = rows.filter((row) => row.target === "refund");
  const replacedRows = await deleteExistingSettlementRows(context, rows);
  let feeRowsCreated = 0;
  let advertisingRowsCreated = 0;
  let refundRowsCreated = 0;

  for (const chunk of chunkArray(feeRows, CREATE_CHUNK_SIZE)) {
    const result = await prisma.marketplaceFee.createMany({
      data: chunk.map((row) => ({
        organizationId: context.organizationId,
        orderId: null,
        orderItemId: null,
        marketplace: context.marketplace,
        sellerSku: row.sellerSku,
        feeType: row.feeType ?? "other_fee",
        feeAmount: row.amount,
        currency: row.currency,
        postedAt: new Date(row.postedAt),
        metadata: buildSettlementMetadata(row, context)
      }))
    });
    feeRowsCreated += result.count;
  }

  for (const chunk of chunkArray(advertisingRows, CREATE_CHUNK_SIZE)) {
    const result = await prisma.advertisingCost.createMany({
      data: chunk.map((row) => ({
        organizationId: context.organizationId,
        marketplace: context.marketplace,
        source: SEM_AD_SOURCE,
        sellerSku: row.sellerSku,
        parentSku: row.sellerSku ? parentSkuBySellerSku.get(row.sellerSku) ?? null : null,
        campaignId: null,
        campaignName: row.transactionDescription || "SEM Marketing",
        costDate: new Date(row.postedAt),
        amount: Math.abs(row.amount),
        currency: row.currency,
        metadata: buildSettlementMetadata(row, context)
      }))
    });
    advertisingRowsCreated += result.count;
  }

  for (const chunk of chunkArray(refundRows, CREATE_CHUNK_SIZE)) {
    const result = await prisma.refund.createMany({
      data: chunk.map((row) => ({
        organizationId: context.organizationId,
        orderId: null,
        orderItemId: null,
        marketplace: context.marketplace,
        sellerSku: row.sellerSku,
        externalOrderId: row.externalOrderId,
        externalLineId: row.externalLineId,
        refundAmount: Math.abs(row.amount),
        refundDate: new Date(row.postedAt),
        currency: row.currency,
        metadata: buildSettlementMetadata(row, context)
      }))
    });
    refundRowsCreated += result.count;
  }

  const importedCount = feeRowsCreated + advertisingRowsCreated + refundRowsCreated;

  return {
    importedCount,
    summary: {
      importedRows: importedCount,
      feeRowsCreated,
      advertisingRowsCreated,
      refundRowsCreated,
      replacedFeeRows: replacedRows.feeRowsDeleted,
      replacedAdvertisingRows: replacedRows.advertisingRowsDeleted,
      replacedRefundRows: replacedRows.refundRowsDeleted,
      semSource: SEM_AD_SOURCE
    }
  };
}

async function deleteExistingSettlementRows(
  context: ImportCommitContext,
  rows: WalmartPaymentSettlementRow[]
) {
  const duplicateKeys = uniqueStrings(rows.map((row) => row.duplicateKey));
  let feeRowsDeleted = 0;
  let advertisingRowsDeleted = 0;
  let refundRowsDeleted = 0;

  for (const chunk of chunkArray(duplicateKeys, CREATE_CHUNK_SIZE)) {
    feeRowsDeleted += await prisma.$executeRaw`
      DELETE FROM "MarketplaceFee"
      WHERE "organizationId" = ${context.organizationId}
        AND "marketplace" = ${context.marketplace}
        AND "metadata"->>'source' = 'walmart_payments_new'
        AND "metadata"->>'duplicateKey' IN (${Prisma.join(chunk)})
    `;
    advertisingRowsDeleted += await prisma.$executeRaw`
      DELETE FROM "AdvertisingCost"
      WHERE "organizationId" = ${context.organizationId}
        AND "marketplace" = ${context.marketplace}
        AND "metadata"->>'source' = 'walmart_payments_new'
        AND "metadata"->>'duplicateKey' IN (${Prisma.join(chunk)})
    `;
    refundRowsDeleted += await prisma.$executeRaw`
      DELETE FROM "Refund"
      WHERE "organizationId" = ${context.organizationId}
        AND "marketplace" = ${context.marketplace}
        AND "metadata"->>'source' = 'walmart_payments_new'
        AND "metadata"->>'duplicateKey' IN (${Prisma.join(chunk)})
    `;
  }

  return { feeRowsDeleted, advertisingRowsDeleted, refundRowsDeleted };
}

function readWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = sheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: ""
      })
    : [];
  const headers = new Set<string>();

  for (const row of rawRows.slice(0, 1)) {
    for (const key of Object.keys(row)) {
      headers.add(normalizeHeader(key));
    }
  }

  return { rawRows, headers };
}

function parseSettlementRow(
  rawRow: Record<string, unknown>,
  rowNumber: number,
  reportPeriod: SettlementReportPeriod
): WalmartPaymentSettlementRow | null {
  const transactionType = readText(rawRow["Transaction Type"]);
  const amountType = readText(rawRow["Amount Type"]);
  const transactionDescription = readText(rawRow["Transaction Description"]);

  if (!transactionType || !amountType) {
    return null;
  }

  const amount = readMoney(rawRow.Amount);
  const postedAt = readDateString(rawRow["Transaction Posted Timestamp"]);

  if (amount === null || !postedAt) {
    return null;
  }

  const rowPeriodStartDate = readDateString(rawRow["Period Start Date"]);
  const rowPeriodEndDate = readDateString(rawRow["Period End Date"]);
  const inheritedPeriodStartDate =
    rowPeriodStartDate ?? (reportPeriod.periodStartDate && reportPeriod.periodEndDate ? reportPeriod.periodStartDate : null);
  const inheritedPeriodEndDate =
    rowPeriodEndDate ?? (reportPeriod.periodStartDate && reportPeriod.periodEndDate ? reportPeriod.periodEndDate : null);
  const periodDateSource =
    rowPeriodStartDate && rowPeriodEndDate
      ? "row"
      : inheritedPeriodStartDate && inheritedPeriodEndDate
        ? "payment_summary"
        : "missing";
  const externalOrderId = readOptionalText(rawRow["Purchase Order #"]);
  const externalLineId = readOptionalText(rawRow["Purchase Order line #"]);
  const sellerSku = readOptionalText(rawRow["Partner Item Id"]);
  const itemName = readOptionalText(rawRow["Partner Item Name"]);
  const transactionReasonDescription = readOptionalText(rawRow["Transaction Reason Description"]);
  const fulfillmentType = readOptionalText(rawRow["Fulfillment Type"]);
  const fulfillmentDetails = readOptionalText(rawRow["Fulfillment Details"]);
  const classification = classifySettlementRow({
    transactionType,
    amountType,
    transactionDescription,
    transactionReasonDescription,
    amount
  });
  const row: WalmartPaymentSettlementRow = {
    rowNumber,
    postedAt,
    periodStartDate: inheritedPeriodStartDate,
    periodEndDate: inheritedPeriodEndDate,
    periodDateSource,
    transactionType,
    transactionDescription,
    transactionReasonDescription,
    externalOrderId,
    externalLineId,
    sellerSku,
    itemName,
    amount,
    amountType,
    currency: readText(rawRow.Currency) || "USD",
    feeType: classification.feeType,
    target: classification.target,
    skipReason: classification.skipReason,
    fulfillmentType,
    fulfillmentDetails,
    duplicateKey: ""
  };

  row.duplicateKey = buildDuplicateKey(row);
  return row;
}

function classifySettlementRow({
  transactionType,
  amountType,
  transactionDescription,
  transactionReasonDescription,
  amount
}: {
  transactionType: string;
  amountType: string;
  transactionDescription: string;
  transactionReasonDescription: string | null;
  amount: number;
}): Pick<WalmartPaymentSettlementRow, "target" | "feeType" | "skipReason"> {
  const normalizedAmountType = normalizeClassifierText(amountType);
  const normalizedDescription = normalizeClassifierText(
    [transactionDescription, transactionReasonDescription].filter(Boolean).join(" ")
  );
  const normalizedTransactionType = normalizeClassifierText(transactionType);
  const isRefundTransaction =
    normalizedTransactionType.includes("refund") ||
    normalizedDescription.includes("wfs_refund");
  const isRefundSalesExcludedAmountType =
    normalizedAmountType.includes("product_tax") ||
    normalizedAmountType.includes("tax") ||
    normalizedAmountType.includes("promo") ||
    normalizedAmountType.includes("savings") ||
    normalizedAmountType.includes("commission") ||
    normalizedAmountType.includes("sem_marketing_fee");
  const isReturnServiceFee =
    normalizedDescription.includes("return_processing") ||
    normalizedDescription.includes("return_shipping");

  if (
    amount < 0 &&
    isRefundTransaction &&
    !isRefundSalesExcludedAmountType &&
    !isReturnServiceFee
  ) {
    return { target: "refund", feeType: null, skipReason: null };
  }

  if (normalizedAmountType.includes("sem_marketing_fee")) {
    return { target: "advertising_cost", feeType: null, skipReason: null };
  }

  if (normalizedAmountType.includes("commission_on_product")) {
    return { target: "marketplace_fee", feeType: "commission", skipReason: null };
  }

  if (
    normalizedAmountType.includes("product_price") ||
    normalizedAmountType.includes("product_tax") ||
    normalizedAmountType.includes("product_tax_withheld") ||
    normalizedAmountType.includes("promo_code") ||
    normalizedAmountType.includes("extra_savings") ||
    normalizedAmountType.includes("total_walmart_funded_savings") ||
    normalizedAmountType.includes("other_tax")
  ) {
    return { target: "skip", feeType: null, skipReason: "product_or_tax" };
  }

  if (
    normalizedDescription.includes("wfs_fulfillment_fee") ||
    normalizedAmountType.includes("wfs_fee_reimbursement")
  ) {
    return { target: "marketplace_fee", feeType: "fulfillment_fee", skipReason: null };
  }

  if (isReturnServiceFee) {
    return { target: "marketplace_fee", feeType: "return_fee", skipReason: null };
  }

  if (normalizedDescription.includes("storagefee") || normalizedDescription.includes("longtermstoragefee")) {
    return { target: "marketplace_fee", feeType: "storage_fee", skipReason: null };
  }

  if (normalizedDescription.includes("wfs_refund")) {
    return { target: "marketplace_fee", feeType: "adjustment", skipReason: null };
  }

  if (
    normalizedDescription.includes("lostinventory") ||
    normalizedDescription.includes("foundinventory") ||
    normalizedDescription.includes("damageinwarehouse") ||
    normalizedDescription.includes("excessrefundadjustment") ||
    normalizedTransactionType.includes("refund")
  ) {
    return { target: "marketplace_fee", feeType: "adjustment", skipReason: null };
  }

  if (
    normalizedDescription.includes("inbound") ||
    normalizedDescription.includes("prepservice") ||
    normalizedDescription.includes("inventorydisposal") ||
    normalizedAmountType.includes("wfs_inbound_fee") ||
    normalizedAmountType.includes("wfs_inventory_fee_reimbursement") ||
    normalizedAmountType.includes("item_fees") ||
    normalizedAmountType.includes("review_accelerator")
  ) {
    return { target: "marketplace_fee", feeType: "other_fee", skipReason: null };
  }

  if (normalizedAmountType.includes("fee") || normalizedAmountType.includes("reimbursement")) {
    return { target: "marketplace_fee", feeType: "other_fee", skipReason: null };
  }

  return { target: "skip", feeType: null, skipReason: "unsupported" };
}

function summarizeSettlementRows(
  rows: WalmartPaymentSettlementRow[],
  skipped: {
    totalRows: number;
    skippedRows: number;
    skippedProductAndTaxRows: number;
    paymentSummaryPeriodStart: string | null;
    paymentSummaryPeriodEnd: string | null;
  }
): SettlementParseSummary {
  const feeRows = rows.filter((row) => row.target === "marketplace_fee");
  const advertisingRows = rows.filter((row) => row.target === "advertising_cost");
  const refundRows = rows.filter((row) => row.target === "refund");

  return {
    totalRows: skipped.totalRows,
    validRows: rows.length,
    skippedRows: skipped.skippedRows,
    feeRows: feeRows.length,
    advertisingRows: advertisingRows.length,
    refundRows: refundRows.length,
    commissionFeeTotal: positiveExpenseTotal(feeRows, "commission"),
    fulfillmentFeeTotal: positiveExpenseTotal(feeRows, "fulfillment_fee"),
    returnFeeTotal: positiveExpenseTotal(feeRows, "return_fee"),
    refundSalesTotal: roundMoney(refundRows.reduce((sum, row) => sum + Math.abs(row.amount), 0)),
    storageFeeTotal: positiveExpenseTotal(feeRows, "storage_fee"),
    adjustmentTotal: signedTotal(feeRows, "adjustment"),
    otherFeeTotal: positiveExpenseTotal(feeRows, "other_fee"),
    semAdvertisingTotal: roundMoney(advertisingRows.reduce((sum, row) => sum + Math.abs(row.amount), 0)),
    skippedProductAndTaxRows: skipped.skippedProductAndTaxRows,
    paymentSummaryPeriodStart: skipped.paymentSummaryPeriodStart,
    paymentSummaryPeriodEnd: skipped.paymentSummaryPeriodEnd,
    inheritedPaymentSummaryPeriodRows: rows.filter(
      (row) => row.periodDateSource === "payment_summary"
    ).length,
    missingPeriodRows: rows.filter((row) => row.periodDateSource === "missing").length
  };
}

function previewSettlementRow(row: WalmartPaymentSettlementRow) {
  return {
    postedAt: row.postedAt.slice(0, 10),
    periodStartDate: row.periodStartDate?.slice(0, 10) ?? null,
    periodEndDate: row.periodEndDate?.slice(0, 10) ?? null,
    periodDateSource: row.periodDateSource,
    target: row.target,
    feeType: row.feeType,
    sellerSku: row.sellerSku,
    amount: row.amount,
    amountType: row.amountType,
    description: row.transactionDescription,
    orderId: row.externalOrderId
  };
}

function decodeSettlementRows(payload: Prisma.JsonValue): WalmartPaymentSettlementRow[] {
  return toArray(toRecord(payload).rows)
    .map((value) => {
      const row = toRecord(value as Prisma.JsonValue);

      return {
        rowNumber: Math.trunc(readNumber(row.rowNumber)),
        postedAt: readStringValue(row.postedAt),
        periodStartDate: readNullableString(row.periodStartDate),
        periodEndDate: readNullableString(row.periodEndDate),
        periodDateSource: readPeriodDateSource(row.periodDateSource),
        transactionType: readStringValue(row.transactionType),
        transactionDescription: readStringValue(row.transactionDescription),
        transactionReasonDescription: readNullableString(row.transactionReasonDescription),
        externalOrderId: readNullableString(row.externalOrderId),
        externalLineId: readNullableString(row.externalLineId),
        sellerSku: readNullableString(row.sellerSku),
        itemName: readNullableString(row.itemName),
        amount: readNumber(row.amount),
        amountType: readStringValue(row.amountType),
        currency: readStringValue(row.currency) || "USD",
        feeType: readNullableString(row.feeType),
        target: readTarget(row.target),
        skipReason: readNullableString(row.skipReason),
        fulfillmentType: readNullableString(row.fulfillmentType),
        fulfillmentDetails: readNullableString(row.fulfillmentDetails),
        duplicateKey: readStringValue(row.duplicateKey)
      };
    })
    .filter((row) => row.postedAt && row.amount && row.target !== "skip");
}

function buildSettlementMetadata(
  row: WalmartPaymentSettlementRow,
  context: ImportCommitContext
): Prisma.InputJsonValue {
  return toJsonValue({
    source: "walmart_payments_new",
    importRunId: context.importRunId,
    originalFileName: context.originalFileName,
    sourceRow: row.rowNumber,
    periodStartDate: row.periodStartDate,
    periodEndDate: row.periodEndDate,
    periodDateSource: row.periodDateSource,
    transactionType: row.transactionType,
    transactionDescription: row.transactionDescription,
    transactionReasonDescription: row.transactionReasonDescription,
    amountType: row.amountType,
    externalOrderId: row.externalOrderId,
    externalLineId: row.externalLineId,
    itemName: row.itemName,
    fulfillmentType: row.fulfillmentType,
    fulfillmentDetails: row.fulfillmentDetails,
    originalAmount: row.amount,
    amountSignConvention: "negative_expense_positive_credit",
    duplicateKey: row.duplicateKey
  });
}

function getPaymentSummaryPeriod(rawRows: Array<Record<string, unknown>>): SettlementReportPeriod {
  const summaryRow = rawRows.find(
    (row) =>
      normalizeClassifierText(readText(row["Transaction Type"])).replace(/_/g, "") ===
      "paymentsummary"
  );

  if (!summaryRow) {
    return { periodStartDate: null, periodEndDate: null };
  }

  return {
    periodStartDate: readDateString(summaryRow["Period Start Date"]),
    periodEndDate: readDateString(summaryRow["Period End Date"])
  };
}

async function loadParentSkuMap(organizationId: string, sellerSkus: string[]) {
  const parentSkuBySellerSku = new Map<string, string | null>();

  if (!sellerSkus.length) {
    return parentSkuBySellerSku;
  }

  const [listings, products] = await Promise.all([
    prisma.listing.findMany({
      where: { organizationId, sellerSku: { in: sellerSkus } },
      select: { sellerSku: true, parentSku: true }
    }),
    prisma.product.findMany({
      where: { organizationId, internalSku: { in: sellerSkus } },
      select: { internalSku: true, parentSku: true }
    })
  ]);

  for (const product of products) {
    if (product.internalSku) {
      parentSkuBySellerSku.set(product.internalSku, product.parentSku);
    }
  }

  for (const listing of listings) {
    parentSkuBySellerSku.set(listing.sellerSku, listing.parentSku);
  }

  return parentSkuBySellerSku;
}

function buildDuplicateKey(row: WalmartPaymentSettlementRow) {
  return [
    row.postedAt,
    row.transactionType,
    row.amountType,
    row.transactionDescription,
    row.externalOrderId ?? "",
    row.externalLineId ?? "",
    row.sellerSku ?? "",
    String(row.amount)
  ]
    .map((value) => value.trim().toLowerCase())
    .join("::");
}

function hasHeaders(headers: Set<string>, requiredHeaders: string[]) {
  return requiredHeaders.every((header) => headers.has(normalizeHeader(header)));
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function normalizeClassifierText(value: string) {
  return value.trim().toLowerCase().replace(/[\s/-]+/g, "_");
}

function readText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function readOptionalText(value: unknown) {
  const text = readText(value);
  return text ? text : null;
}

function readMoney(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = readText(value);

  if (!text) {
    return null;
  }

  const parsed = Number(text.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readDateString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
    ).toISOString();
  }

  const text = readText(value);

  if (!text) {
    return null;
  }

  const usDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (usDate) {
    const [, month, day, year] = usDate;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readStringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function readNullableString(value: unknown) {
  const text = readStringValue(value).trim();
  return text ? text : null;
}

function readTarget(value: unknown): WalmartPaymentSettlementRow["target"] {
  const text = readStringValue(value);

  if (text === "marketplace_fee" || text === "advertising_cost" || text === "refund") {
    return text;
  }

  return "skip";
}

function readPeriodDateSource(value: unknown): WalmartPaymentSettlementRow["periodDateSource"] {
  const text = readStringValue(value);

  if (text === "row" || text === "payment_summary" || text === "missing") {
    return text;
  }

  return "missing";
}

function positiveExpenseTotal(rows: WalmartPaymentSettlementRow[], feeType: string) {
  return roundMoney(
    rows
      .filter((row) => row.feeType === feeType)
      .reduce((sum, row) => sum + Math.abs(row.amount), 0)
  );
}

function signedTotal(rows: WalmartPaymentSettlementRow[], feeType: string) {
  return roundMoney(
    rows
      .filter((row) => row.feeType === feeType)
      .reduce((sum, row) => sum + row.amount, 0)
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
