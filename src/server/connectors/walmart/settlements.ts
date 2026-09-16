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
const DUPLICATE_VERSION = "walmart-payments-new-v12-settlement-sem-posted-date";
const TRANSACTION_POSTED_REPORTING_DATE_SOURCE = "transaction_posted_timestamp";
const UNMATCHED_FEE_PERIOD_END_REPORTING_DATE_SOURCE =
  "settlement_period_end_unmatched_fee";
const UNMATCHED_FEE_POSTING_DATE_FALLBACK_SOURCE =
  "transaction_posted_timestamp_missing_period_end";

type SettlementReportPeriod = {
  periodStartDate: string | null;
  periodEndDate: string | null;
  totalPayable: number | null;
  postedAt: string | null;
  payoutDate: string | null;
  payoutDateSource: string | null;
  currency: string;
  transactionKey: string | null;
  transactionDescription: string | null;
};

type SettlementPayoutPayload = {
  settlementReference: string;
  settlementPeriodStart: string | null;
  settlementPeriodEnd: string | null;
  payoutAmount: number;
  payoutDate: string | null;
  payoutDateSource: string | null;
  currency: string;
  source: string;
  originalFileName: string;
  paymentSummaryTransactionPostedAt: string | null;
  paymentSummaryTransactionKey: string | null;
  paymentSummaryDescription: string | null;
};

type SettlementClassificationStatus = "classified" | "ignored" | "unsupported";
type SettlementFinancialDirection = "charge" | "credit" | "neutral";
type SettlementAttributionScope = "marketplace" | "product";
type SettlementFeePoLineMatchStatus =
  | "not_applicable"
  | "missing_reference"
  | "not_found"
  | "ambiguous"
  | "matched";
type SettlementReportingDateSource =
  | typeof TRANSACTION_POSTED_REPORTING_DATE_SOURCE
  | typeof UNMATCHED_FEE_PERIOD_END_REPORTING_DATE_SOURCE
  | typeof UNMATCHED_FEE_POSTING_DATE_FALLBACK_SOURCE;

export type SettlementFeePoLineLookupRow = {
  id: string;
  orderId: string;
  sellerSku: string;
  purchaseOrderNumber: string | null;
  purchaseOrderLineNumber: string | null;
};

type SettlementFeeCommitResolution = {
  orderId: string | null;
  orderItemId: string | null;
  sellerSku: string | null;
  reportingDate: string;
  reportingDateSource: SettlementReportingDateSource;
  matchStatus: SettlementFeePoLineMatchStatus;
  attributionScope: SettlementAttributionScope;
  productAttributionReliable: boolean;
};
type SettlementClassification = Pick<
  WalmartPaymentSettlementRow,
  | "target"
  | "feeType"
  | "skipReason"
  | "classificationStatus"
  | "adjustmentCategory"
  | "adjustmentCategoryLabel"
  | "attributionScope"
  | "productAttributionReliable"
>;

export type WalmartPaymentSettlementRow = {
  rowNumber: number;
  postedAt: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  periodDateSource: "row" | "payment_summary" | "missing";
  reportingDate: string;
  reportingDateSource: SettlementReportingDateSource;
  transactionKey: string | null;
  transactionType: string;
  transactionDescription: string;
  transactionReasonDescription: string | null;
  externalOrderId: string | null;
  externalLineId: string | null;
  customerOrderId: string | null;
  customerOrderLineId: string | null;
  sellerSku: string | null;
  itemName: string | null;
  amount: number;
  amountType: string;
  shipQuantity: number | null;
  currency: string;
  feeType: string | null;
  target: "marketplace_fee" | "refund" | "advertising" | "skip";
  skipReason: string | null;
  classificationStatus: SettlementClassificationStatus;
  financialDirection: SettlementFinancialDirection;
  adjustmentCategory: string | null;
  adjustmentCategoryLabel: string | null;
  attributionScope: SettlementAttributionScope;
  productAttributionReliable: boolean;
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
  semAdvertisingTotal: number;
  commissionFeeTotal: number;
  fulfillmentFeeTotal: number;
  returnFeeTotal: number;
  refundSalesTotal: number;
  storageFeeTotal: number;
  adjustmentTotal: number;
  otherFeeTotal: number;
  semRowsExcluded: number;
  semAdvertisingExcludedTotal: number;
  settlementSaleRowsSkipped: number;
  taxRowsSkipped: number;
  unsupportedFinancialRows: number;
  unsupportedFinancialTotal: number;
  unsupportedFinancialBreakdown: Array<{
    transactionType: string;
    amountType: string;
    description: string;
    transactionCount: number;
    signedAmount: number;
  }>;
  otherWalmartFeesChargesTotal: number;
  otherWalmartFeesCreditsTotal: number;
  otherWalmartFeesNetTotal: number;
  otherWalmartFeesCategoryBreakdown: Array<{
    category: string;
    categoryName: string;
    transactionCount: number;
    charges: number;
    credits: number;
    netAmount: number;
  }>;
  skippedProductAndTaxRows: number;
  paymentSummaryTotalPayable: number | null;
  paymentSummaryPostedAt: string | null;
  settlementPayoutAmount: number | null;
  settlementPayoutReference: string | null;
  settlementPayoutPeriodStart: string | null;
  settlementPayoutPeriodEnd: string | null;
  settlementPayoutDate: string | null;
  settlementPayoutDateSource: string | null;
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
      return parseWalmartPaymentsNewReport(context.buffer, context.fileName);
    },
    commit: commitWalmartPaymentsNewReport
  }
];

function parseWalmartPaymentsNewReport(buffer: Buffer, originalFileName = ""): ParsedImportReport {
  const report = readWorkbook(buffer);
  const issues: ParsedImportIssue[] = [];
  const previewRows: ParsedImportPreviewRow[] = [];
  const rows: WalmartPaymentSettlementRow[] = [];
  const replacementKeys = new Set<string>();
  const seenKeys = new Set<string>();
  const reportPeriod = getPaymentSummaryPeriod(report.rawRows);
  let skippedRows = 0;
  let skippedProductAndTaxRows = 0;
  let settlementSaleRowsSkipped = 0;
  let taxRowsSkipped = 0;
  let semRowsExcluded = 0;
  let semAdvertisingExcludedTotal = 0;
  const unsupportedFinancialRows: WalmartPaymentSettlementRow[] = [];
  const settlementPayout = buildSettlementPayoutPayload(reportPeriod, originalFileName);

  report.rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const parsed = parseSettlementRow(rawRow, rowNumber, reportPeriod);

    if (!parsed) {
      skippedRows += 1;
      return;
    }

    replacementKeys.add(parsed.duplicateKey);

    if (parsed.target === "skip") {
      skippedRows += 1;

      if (parsed.skipReason === "product_or_tax") {
        skippedProductAndTaxRows += 1;
      }
      if (parsed.skipReason === "settlement_sale") {
        settlementSaleRowsSkipped += 1;
      }
      if (parsed.skipReason === "tax") {
        taxRowsSkipped += 1;
      }
      if (parsed.skipReason === "settlement_sem_excluded") {
        semRowsExcluded += 1;
        semAdvertisingExcludedTotal = roundMoney(semAdvertisingExcludedTotal + Math.abs(parsed.amount));
      }
      if (parsed.classificationStatus === "unsupported") {
        unsupportedFinancialRows.push(parsed);
        issues.push({
          row: rowNumber,
          severity: "warning",
          code: "UNSUPPORTED_SETTLEMENT_FINANCIAL_CATEGORY",
          message:
            "Unsupported Walmart settlement financial category. It was preserved in import history but excluded from active P&L until mapped.",
          rawData: rawRow
        });
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
    settlementSaleRowsSkipped,
    taxRowsSkipped,
    semRowsExcluded,
    semAdvertisingExcludedTotal,
    unsupportedFinancialRows,
    paymentSummaryPeriodStart: reportPeriod.periodStartDate,
    paymentSummaryPeriodEnd: reportPeriod.periodEndDate,
    paymentSummaryTotalPayable: reportPeriod.totalPayable,
    paymentSummaryPostedAt: reportPeriod.postedAt,
    settlementPayout
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
    payload: toJsonValue({ rows, replacementKeys: Array.from(replacementKeys), settlementPayout }),
    duplicateVersion: DUPLICATE_VERSION,
    allowDuplicateFileImport: true
  };
}

async function commitWalmartPaymentsNewReport(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const { rows, replacementKeys, settlementPayout } = decodeSettlementPayload(payload);

  if (!rows.length && !replacementKeys.length && !settlementPayout) {
    return {
      importedCount: 0,
      summary: { importedRows: 0 }
    };
  }

  const feeRows = rows.filter((row) => row.target === "marketplace_fee" && row.feeType);
  const advertisingRows = rows.filter((row) => row.target === "advertising");
  const refundRows = rows.filter((row) => row.target === "refund");
  const replacedRows = await deleteExistingSettlementRows(context, replacementKeys);
  const feeCommitResolutions = await getSettlementFeeCommitResolutions(context, feeRows);
  const feePoLineMatchSummary = summarizeFeePoLineMatches(feeCommitResolutions);
  let feeRowsCreated = 0;
  let advertisingRowsCreated = 0;
  let refundRowsCreated = 0;
  const payoutRowsUpserted = settlementPayout
    ? await upsertSettlementPayout(context, settlementPayout)
    : 0;

  for (const chunk of chunkArray(feeRows, CREATE_CHUNK_SIZE)) {
    const result = await prisma.marketplaceFee.createMany({
      data: chunk.map((row) => {
        const feeResolution = feeCommitResolutions.get(row.duplicateKey);

        return {
          organizationId: context.organizationId,
          orderId: feeResolution?.orderId ?? null,
          orderItemId: feeResolution?.orderItemId ?? null,
          marketplace: context.marketplace,
          sellerSku: feeResolution?.sellerSku ?? getPersistedFeeSellerSku(row),
          feeType: row.feeType ?? "other_fee",
          feeAmount: row.amount,
          currency: row.currency,
          postedAt: new Date(feeResolution?.reportingDate ?? row.reportingDate),
          metadata: buildSettlementMetadata(row, context, feeResolution)
        };
      })
    });
    feeRowsCreated += result.count;
  }

  for (const chunk of chunkArray(advertisingRows, CREATE_CHUNK_SIZE)) {
    const result = await prisma.advertisingCost.createMany({
      data: chunk.map((row) => ({
        organizationId: context.organizationId,
        marketplace: context.marketplace,
        source: "walmart_seller_center_sem",
        sellerSku: null,
        parentSku: null,
        campaignId: row.transactionKey,
        campaignName: row.transactionDescription || "Seller Center SEM",
        costDate: new Date(row.reportingDate),
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

  const importedCount =
    feeRowsCreated + advertisingRowsCreated + refundRowsCreated + payoutRowsUpserted;

  return {
    importedCount,
    summary: {
      importedRows: importedCount,
      feeRowsCreated,
      feeRowsLinkedToPoLines: feePoLineMatchSummary.matched,
      feeRowsMissingPoLineReference: feePoLineMatchSummary.missingReference,
      feeRowsWithoutPoLineMatch: feePoLineMatchSummary.notFound,
      feeRowsWithAmbiguousPoLineMatch: feePoLineMatchSummary.ambiguous,
      payoutRowsUpserted,
      advertisingRowsCreated,
      refundRowsCreated,
      replacedFeeRows: replacedRows.feeRowsDeleted,
      replacedAdvertisingRows: replacedRows.advertisingRowsDeleted,
      replacedRefundRows: replacedRows.refundRowsDeleted,
      semSource: "walmart_payments_new"
    }
  };
}

async function upsertSettlementPayout(
  context: ImportCommitContext,
  payout: SettlementPayoutPayload
) {
  await prisma.settlementPayout.upsert({
    where: {
      organizationId_marketplace_settlementReference: {
        organizationId: context.organizationId,
        marketplace: context.marketplace,
        settlementReference: payout.settlementReference
      }
    },
    create: {
      organizationId: context.organizationId,
      importRunId: context.importRunId,
      marketplace: context.marketplace,
      source: payout.source,
      settlementReference: payout.settlementReference,
      settlementPeriodStart: payout.settlementPeriodStart
        ? new Date(payout.settlementPeriodStart)
        : null,
      settlementPeriodEnd: payout.settlementPeriodEnd
        ? new Date(payout.settlementPeriodEnd)
        : null,
      payoutAmount: payout.payoutAmount,
      payoutDate: payout.payoutDate ? new Date(payout.payoutDate) : null,
      currency: payout.currency,
      originalFileName: context.originalFileName,
      importedAt: new Date(),
      metadata: buildSettlementPayoutMetadata(payout, context)
    },
    update: {
      importRunId: context.importRunId,
      source: payout.source,
      settlementPeriodStart: payout.settlementPeriodStart
        ? new Date(payout.settlementPeriodStart)
        : null,
      settlementPeriodEnd: payout.settlementPeriodEnd
        ? new Date(payout.settlementPeriodEnd)
        : null,
      payoutAmount: payout.payoutAmount,
      payoutDate: payout.payoutDate ? new Date(payout.payoutDate) : null,
      currency: payout.currency,
      originalFileName: context.originalFileName,
      importedAt: new Date(),
      metadata: buildSettlementPayoutMetadata(payout, context)
    }
  });

  return 1;
}

async function deleteExistingSettlementRows(
  context: ImportCommitContext,
  duplicateKeys: string[]
) {
  const keys = uniqueStrings(duplicateKeys);
  let feeRowsDeleted = 0;
  let advertisingRowsDeleted = 0;
  let refundRowsDeleted = 0;

  for (const chunk of chunkArray(keys, CREATE_CHUNK_SIZE)) {
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
  const customerOrderId = readOptionalText(rawRow["Customer Order #"]);
  const customerOrderLineId = readOptionalText(rawRow["Customer Order line #"]);
  const sellerSku = readOptionalText(rawRow["Partner Item Id"]);
  const itemName = readOptionalText(rawRow["Partner Item Name"]);
  const transactionReasonDescription = readOptionalText(rawRow["Transaction Reason Description"]);
  const fulfillmentType = readOptionalText(rawRow["Fulfillment Type"]);
  const fulfillmentDetails = readOptionalText(rawRow["Fulfillment Details"]);
  const transactionKey = readOptionalText(rawRow["Transaction Key"]);
  const classification = classifySettlementRow({
    transactionType,
    amountType,
    transactionDescription,
    transactionReasonDescription,
    amount
  });
  const reportingDate = resolveSettlementReportingDate({
    target: classification.target,
    postedAt,
    externalOrderId,
    externalLineId
  });
  const row: WalmartPaymentSettlementRow = {
    rowNumber,
    postedAt,
    periodStartDate: inheritedPeriodStartDate,
    periodEndDate: inheritedPeriodEndDate,
    periodDateSource,
    reportingDate: reportingDate.date,
    reportingDateSource: reportingDate.source,
    transactionKey,
    transactionType,
    transactionDescription,
    transactionReasonDescription,
    externalOrderId,
    externalLineId,
    customerOrderId,
    customerOrderLineId,
    sellerSku,
    itemName,
    amount,
    amountType,
    shipQuantity: readOptionalNumber(rawRow["Ship Qty"]),
    currency: readText(rawRow.Currency) || "USD",
    feeType: classification.feeType,
    target: classification.target,
    skipReason: classification.skipReason,
    classificationStatus: classification.classificationStatus,
    financialDirection: getFinancialDirection(amount),
    adjustmentCategory: classification.adjustmentCategory,
    adjustmentCategoryLabel: classification.adjustmentCategoryLabel,
    attributionScope: classification.attributionScope,
    productAttributionReliable: classification.productAttributionReliable,
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
  transactionReasonDescription
}: {
  transactionType: string;
  amountType: string;
  transactionDescription: string;
  transactionReasonDescription: string | null;
  amount: number;
}): SettlementClassification {
  const normalizedAmountType = normalizeClassifierText(amountType);
  const normalizedDescription = normalizeClassifierText(
    [transactionDescription, transactionReasonDescription].filter(Boolean).join(" ")
  );
  const normalizedTransactionType = normalizeClassifierText(transactionType);
  const isRefundTransaction =
    normalizedTransactionType.includes("refund") ||
    normalizedDescription.includes("wfs_refund");
  const isProductPrice = normalizedAmountType.includes("product_price");
  const isTax =
    normalizedAmountType.includes("product_tax") ||
    normalizedAmountType.includes("tax") ||
    normalizedAmountType.includes("other_tax");
  const isReturnServiceFee =
    normalizedDescription.includes("return_processing") ||
    normalizedDescription.includes("return_shipping");

  if (isRefundTransaction && isProductPrice) {
    return classified({
      target: "refund",
      category: "refund_product_price",
      categoryLabel: "Refund Product Price",
      attributionScope: "product",
      productAttributionReliable: true
    });
  }

  if (normalizedAmountType.includes("sem_marketing_fee")) {
    return classified({
      target: "advertising",
      feeType: "seller_center_sem",
      category: "seller_center_sem",
      categoryLabel: "Seller Center SEM",
      attributionScope: "marketplace",
      productAttributionReliable: false
    });
  }

  if (normalizedAmountType.includes("commission_on_product")) {
    return classified({
      target: "marketplace_fee",
      feeType: "commission",
      category: "marketplace_commission",
      categoryLabel: "Marketplace Commission",
      attributionScope: "product",
      productAttributionReliable: true
    });
  }

  if (isTax) {
    return ignored("tax", "tax", "Tax");
  }

  if (normalizedTransactionType.includes("sale") && isProductPrice) {
    return ignored("settlement_sale", "settlement_sale", "Settlement Sale");
  }

  if (
    isProductPrice ||
    normalizedAmountType.includes("promo_code") ||
    normalizedAmountType.includes("extra_savings") ||
    normalizedAmountType.includes("total_walmart_funded_savings")
  ) {
    return unsupported("unsupported_product_or_promo_financial", "Product / Promotion / Funded Savings");
  }

  if (
    normalizedDescription.includes("wfs_fulfillment_fee") ||
    normalizedAmountType.includes("wfs_fee_reimbursement")
  ) {
    return classified({
      target: "marketplace_fee",
      feeType: "fulfillment_fee",
      category: "wfs_fulfillment_fee",
      categoryLabel: "WFS Fulfillment Fee",
      attributionScope: "product",
      productAttributionReliable: true
    });
  }

  if (isRefundTransaction && normalizedAmountType.includes("shipping")) {
    return classified({
      target: "marketplace_fee",
      feeType: "shipping_fee",
      category: "refunded_shipping",
      categoryLabel: "Refunded Shipping",
      attributionScope: "marketplace",
      productAttributionReliable: false
    });
  }

  if (isReturnServiceFee) {
    return classifiedOtherFee("return_fee", "return_related_fee", "Return-Related Fees");
  }

  if (
    normalizedDescription.includes("long_term_storage") ||
    normalizedDescription.includes("longtermstoragefee")
  ) {
    return classifiedOtherFee("storage_fee", "wfs_long_term_storage_fee", "WFS Long-Term Storage Fee");
  }

  if (
    normalizedDescription.includes("storage_fee") ||
    normalizedDescription.includes("storagefee")
  ) {
    return classifiedOtherFee("storage_fee", "wfs_storage_fee", "WFS Storage Fee");
  }

  if (normalizedDescription.includes("wfs_refund")) {
    return classifiedOtherFee("adjustment", "wfs_refund", "WFS Refund");
  }

  if (normalizedDescription.includes("lost_inventory") || normalizedDescription.includes("lostinventory")) {
    return classifiedOtherFee("adjustment", "wfs_lost_inventory", "WFS Lost Inventory");
  }

  if (normalizedDescription.includes("found_inventory") || normalizedDescription.includes("foundinventory")) {
    return classifiedOtherFee("adjustment", "wfs_found_inventory", "WFS Found Inventory");
  }

  if (
    normalizedDescription.includes("damage_in_warehouse") ||
    normalizedDescription.includes("damageinwarehouse")
  ) {
    return classifiedOtherFee("adjustment", "wfs_damage_in_warehouse", "WFS Damage in Warehouse");
  }

  if (
    normalizedDescription.includes("excess_refund_adjustment") ||
    normalizedDescription.includes("excessrefundadjustment")
  ) {
    return classifiedOtherFee("adjustment", "excess_refund_adjustment", "Excess Refund Adjustment");
  }

  if (isRefundTransaction) {
    return unsupported("unsupported_refund_amount_type", "Unsupported Refund Amount Type");
  }

  if (
    normalizedDescription.includes("inventory_transfer") ||
    normalizedAmountType.includes("inventory_transfer")
  ) {
    return classifiedOtherFee("other_fee", "wfs_inventory_transfer_fee", "WFS Inventory Transfer Fee");
  }

  if (
    normalizedDescription.includes("inbound_transportation") ||
    normalizedDescription.includes("inbound") ||
    normalizedAmountType.includes("wfs_inbound_fee")
  ) {
    return classifiedOtherFee("other_fee", "wfs_inbound_transportation_fee", "WFS Inbound Transportation Fee");
  }

  if (
    normalizedDescription.includes("prep_service") ||
    normalizedDescription.includes("prepservice")
  ) {
    return classifiedOtherFee("other_fee", "wfs_prep_service_fee", "WFS Prep Service Fee");
  }

  if (
    normalizedDescription.includes("inventory_disposal") ||
    normalizedDescription.includes("inventorydisposal")
  ) {
    return classifiedOtherFee("other_fee", "wfs_inventory_disposal_fee", "WFS Inventory Disposal Fee");
  }

  if (normalizedAmountType.includes("review_accelerator") || normalizedDescription.includes("review_accelerator")) {
    return classifiedOtherFee("other_fee", "review_accelerator", "Review Accelerator");
  }

  if (normalizedAmountType.includes("wfs_inventory_fee_reimbursement")) {
    return classifiedOtherFee("adjustment", "wfs_inventory_fee_reimbursement", "WFS Inventory Fee/Reimbursement");
  }

  if (normalizedAmountType.includes("item_fees")) {
    return classifiedOtherFee("other_fee", "item_fees", "Item Fees");
  }

  return unsupported("unsupported_financial", "Unsupported Financial Transaction");
}

function classified({
  target,
  feeType = null,
  category,
  categoryLabel,
  attributionScope,
  productAttributionReliable
}: {
  target: WalmartPaymentSettlementRow["target"];
  feeType?: string | null;
  category: string;
  categoryLabel: string;
  attributionScope: SettlementAttributionScope;
  productAttributionReliable: boolean;
}): SettlementClassification {
  return {
    target,
    feeType,
    skipReason: null,
    classificationStatus: "classified",
    adjustmentCategory: category,
    adjustmentCategoryLabel: categoryLabel,
    attributionScope,
    productAttributionReliable
  };
}

function classifiedOtherFee(feeType: string, category: string, categoryLabel: string) {
  return classified({
    target: "marketplace_fee",
    feeType,
    category,
    categoryLabel,
    attributionScope: "marketplace",
    productAttributionReliable: false
  });
}

function ignored(skipReason: string, category: string, categoryLabel: string): SettlementClassification {
  return {
    target: "skip",
    feeType: null,
    skipReason,
    classificationStatus: "ignored",
    adjustmentCategory: category,
    adjustmentCategoryLabel: categoryLabel,
    attributionScope: "marketplace",
    productAttributionReliable: false
  };
}

function unsupported(skipReason: string, categoryLabel: string): SettlementClassification {
  return {
    target: "skip",
    feeType: null,
    skipReason,
    classificationStatus: "unsupported",
    adjustmentCategory: skipReason,
    adjustmentCategoryLabel: categoryLabel,
    attributionScope: "marketplace",
    productAttributionReliable: false
  };
}

function summarizeSettlementRows(
  rows: WalmartPaymentSettlementRow[],
  skipped: {
    totalRows: number;
    skippedRows: number;
    skippedProductAndTaxRows: number;
    settlementSaleRowsSkipped: number;
    taxRowsSkipped: number;
    semRowsExcluded: number;
    semAdvertisingExcludedTotal: number;
    unsupportedFinancialRows: WalmartPaymentSettlementRow[];
    paymentSummaryPeriodStart: string | null;
    paymentSummaryPeriodEnd: string | null;
    paymentSummaryTotalPayable: number | null;
    paymentSummaryPostedAt: string | null;
    settlementPayout: SettlementPayoutPayload | null;
  }
): SettlementParseSummary {
  const feeRows = rows.filter((row) => row.target === "marketplace_fee");
  const advertisingRows = rows.filter((row) => row.target === "advertising");
  const refundRows = rows.filter((row) => row.target === "refund");
  const otherWalmartFeeRows = feeRows.filter((row) => isOtherWalmartFee(row));

  return {
    totalRows: skipped.totalRows,
    validRows: rows.length,
    skippedRows: skipped.skippedRows,
    feeRows: feeRows.length,
    advertisingRows: advertisingRows.length,
    refundRows: refundRows.length,
    semAdvertisingTotal: roundMoney(
      advertisingRows.reduce((sum, row) => sum + Math.abs(row.amount), 0)
    ),
    commissionFeeTotal: positiveExpenseTotal(feeRows, "commission"),
    fulfillmentFeeTotal: positiveExpenseTotal(feeRows, "fulfillment_fee"),
    returnFeeTotal: positiveExpenseTotal(feeRows, "return_fee"),
    refundSalesTotal: roundMoney(refundRows.reduce((sum, row) => sum + Math.abs(row.amount), 0)),
    storageFeeTotal: positiveExpenseTotal(feeRows, "storage_fee"),
    adjustmentTotal: signedTotal(feeRows, "adjustment"),
    otherFeeTotal: positiveExpenseTotal(feeRows, "other_fee"),
    semRowsExcluded: skipped.semRowsExcluded,
    semAdvertisingExcludedTotal: roundMoney(skipped.semAdvertisingExcludedTotal),
    settlementSaleRowsSkipped: skipped.settlementSaleRowsSkipped,
    taxRowsSkipped: skipped.taxRowsSkipped,
    unsupportedFinancialRows: skipped.unsupportedFinancialRows.length,
    unsupportedFinancialTotal: roundMoney(
      skipped.unsupportedFinancialRows.reduce((sum, row) => sum + row.amount, 0)
    ),
    unsupportedFinancialBreakdown: summarizeUnsupportedRows(skipped.unsupportedFinancialRows),
    otherWalmartFeesChargesTotal: summarizeOtherWalmartFees(otherWalmartFeeRows).charges,
    otherWalmartFeesCreditsTotal: summarizeOtherWalmartFees(otherWalmartFeeRows).credits,
    otherWalmartFeesNetTotal: summarizeOtherWalmartFees(otherWalmartFeeRows).net,
    otherWalmartFeesCategoryBreakdown: summarizeOtherWalmartFeeCategories(otherWalmartFeeRows),
    skippedProductAndTaxRows: skipped.skippedProductAndTaxRows,
    paymentSummaryPeriodStart: skipped.paymentSummaryPeriodStart,
    paymentSummaryPeriodEnd: skipped.paymentSummaryPeriodEnd,
    paymentSummaryTotalPayable: skipped.paymentSummaryTotalPayable,
    paymentSummaryPostedAt: skipped.paymentSummaryPostedAt,
    settlementPayoutAmount: skipped.settlementPayout?.payoutAmount ?? null,
    settlementPayoutReference: skipped.settlementPayout?.settlementReference ?? null,
    settlementPayoutPeriodStart: skipped.settlementPayout?.settlementPeriodStart ?? null,
    settlementPayoutPeriodEnd: skipped.settlementPayout?.settlementPeriodEnd ?? null,
    settlementPayoutDate: skipped.settlementPayout?.payoutDate ?? null,
    settlementPayoutDateSource: skipped.settlementPayout?.payoutDateSource ?? null,
    inheritedPaymentSummaryPeriodRows: rows.filter(
      (row) => row.periodDateSource === "payment_summary"
    ).length,
    missingPeriodRows: rows.filter((row) => row.periodDateSource === "missing").length
  };
}

function previewSettlementRow(row: WalmartPaymentSettlementRow) {
  return {
    postedAt: row.postedAt.slice(0, 10),
    pnlReportingDate: row.reportingDate.slice(0, 10),
    reportingDateSource: row.reportingDateSource,
    periodStartDate: row.periodStartDate?.slice(0, 10) ?? null,
    periodEndDate: row.periodEndDate?.slice(0, 10) ?? null,
    periodDateSource: row.periodDateSource,
    target: row.target,
    feeType: row.feeType,
    classificationStatus: row.classificationStatus,
    financialDirection: row.financialDirection,
    adjustmentCategory: row.adjustmentCategory,
    adjustmentCategoryLabel: row.adjustmentCategoryLabel,
    attributionScope: row.attributionScope,
    productAttributionReliable: row.productAttributionReliable,
    skipReason: row.skipReason,
    sellerSku: row.sellerSku,
    amount: row.amount,
    amountType: row.amountType,
    shipQuantity: row.shipQuantity,
    description: row.transactionDescription,
    orderId: row.externalOrderId
  };
}

function decodeSettlementPayload(payload: Prisma.JsonValue) {
  const record = toRecord(payload);
  const settlementPayout = decodeSettlementPayout(record.settlementPayout);
  const rows = toArray(record.rows)
    .map((value) => {
      const row = toRecord(value as Prisma.JsonValue);

      return {
        rowNumber: Math.trunc(readNumber(row.rowNumber)),
        postedAt: readStringValue(row.postedAt),
        periodStartDate: readNullableString(row.periodStartDate),
        periodEndDate: readNullableString(row.periodEndDate),
        periodDateSource: readPeriodDateSource(row.periodDateSource),
        reportingDate: readStringValue(row.reportingDate) || readStringValue(row.postedAt),
        reportingDateSource: readReportingDateSource(row.reportingDateSource),
        transactionKey: readNullableString(row.transactionKey),
        transactionType: readStringValue(row.transactionType),
        transactionDescription: readStringValue(row.transactionDescription),
        transactionReasonDescription: readNullableString(row.transactionReasonDescription),
        externalOrderId: readNullableString(row.externalOrderId),
        externalLineId: readNullableString(row.externalLineId),
        customerOrderId: readNullableString(row.customerOrderId),
        customerOrderLineId: readNullableString(row.customerOrderLineId),
        sellerSku: readNullableString(row.sellerSku),
        itemName: readNullableString(row.itemName),
        amount: readNumber(row.amount),
        amountType: readStringValue(row.amountType),
        shipQuantity: readNullableNumber(row.shipQuantity),
        currency: readStringValue(row.currency) || "USD",
        feeType: readNullableString(row.feeType),
        target: readTarget(row.target),
        skipReason: readNullableString(row.skipReason),
        classificationStatus: readClassificationStatus(row.classificationStatus),
        financialDirection: readFinancialDirection(row.financialDirection),
        adjustmentCategory: readNullableString(row.adjustmentCategory),
        adjustmentCategoryLabel: readNullableString(row.adjustmentCategoryLabel),
        attributionScope: readAttributionScope(row.attributionScope),
        productAttributionReliable: readBoolean(row.productAttributionReliable),
        fulfillmentType: readNullableString(row.fulfillmentType),
        fulfillmentDetails: readNullableString(row.fulfillmentDetails),
        duplicateKey: readStringValue(row.duplicateKey)
      };
    })
    .filter((row) => row.postedAt && row.amount && row.target !== "skip");
  const replacementKeys = uniqueStrings(
    toArray(record.replacementKeys)
      .map((value) => readStringValue(value))
      .filter(Boolean)
  );

  return {
    rows,
    replacementKeys: replacementKeys.length ? replacementKeys : uniqueStrings(rows.map((row) => row.duplicateKey)),
    settlementPayout
  };
}

function decodeSettlementPayout(value: unknown): SettlementPayoutPayload | null {
  const record = toRecord(value as Prisma.JsonValue);
  const payoutAmount = readOptionalNumber(record.payoutAmount);
  const settlementReference = readNullableString(record.settlementReference);

  if (payoutAmount === null || !settlementReference) {
    return null;
  }

  return {
    settlementReference,
    settlementPeriodStart: readNullableString(record.settlementPeriodStart),
    settlementPeriodEnd: readNullableString(record.settlementPeriodEnd),
    payoutAmount,
    payoutDate: readNullableString(record.payoutDate),
    payoutDateSource: readNullableString(record.payoutDateSource),
    currency: readStringValue(record.currency) || "USD",
    source: readStringValue(record.source) || "walmart_payments_new",
    originalFileName: readStringValue(record.originalFileName),
    paymentSummaryTransactionPostedAt: readNullableString(record.paymentSummaryTransactionPostedAt),
    paymentSummaryTransactionKey: readNullableString(record.paymentSummaryTransactionKey),
    paymentSummaryDescription: readNullableString(record.paymentSummaryDescription)
  };
}

function buildSettlementMetadata(
  row: WalmartPaymentSettlementRow,
  context: ImportCommitContext,
  feeResolution?: SettlementFeeCommitResolution
): Prisma.InputJsonValue {
  const reportingDate = feeResolution?.reportingDate ?? row.reportingDate;
  const reportingDateSource = feeResolution?.reportingDateSource ?? row.reportingDateSource;
  const attributionScope = feeResolution?.attributionScope ?? row.attributionScope;
  const productAttributionReliable =
    feeResolution?.productAttributionReliable ?? row.productAttributionReliable;

  return toJsonValue({
    source: "walmart_payments_new",
    importRunId: context.importRunId,
    originalFileName: context.originalFileName,
    sourceRow: row.rowNumber,
    reportingDateSource,
    pnlReportingDate: reportingDate,
    transactionPostedTimestamp: row.postedAt,
    auditSettlementPeriodStartDate: row.periodStartDate,
    auditSettlementPeriodEndDate: row.periodEndDate,
    periodDateSource: row.periodDateSource,
    transactionReference: row.transactionKey,
    settlementReference: buildSettlementReference(row, context.originalFileName),
    transactionKey: row.transactionKey,
    transactionType: row.transactionType,
    transactionDescription: row.transactionDescription,
    transactionReasonDescription: row.transactionReasonDescription,
    amountType: row.amountType,
    originalSellerSku: row.sellerSku,
    partnerItemId: row.sellerSku,
    externalOrderId: row.externalOrderId,
    externalLineId: row.externalLineId,
    purchaseOrderNumber: row.externalOrderId,
    purchaseOrderLineNumber: row.externalLineId,
    customerOrderNumber: row.customerOrderId,
    customerOrderLineNumber: row.customerOrderLineId,
    itemName: row.itemName,
    fulfillmentType: row.fulfillmentType,
    fulfillmentDetails: row.fulfillmentDetails,
    shipQuantity: row.shipQuantity,
    originalAmount: row.amount,
    amountSignConvention: "negative_expense_positive_credit",
    classificationStatus: row.classificationStatus,
    financialDirection: row.financialDirection,
    adjustmentCategory: row.adjustmentCategory,
    adjustmentCategoryLabel: row.adjustmentCategoryLabel,
    attributionScope,
    productAttributionReliable,
    poLineMatchStatus: feeResolution?.matchStatus,
    matchedOrderId: feeResolution?.orderId,
    matchedOrderItemId: feeResolution?.orderItemId,
    duplicateKey: row.duplicateKey
  });
}

function buildSettlementPayoutMetadata(
  payout: SettlementPayoutPayload,
  context: ImportCommitContext
): Prisma.InputJsonValue {
  return toJsonValue({
    source: payout.source,
    importRunId: context.importRunId,
    originalFileName: context.originalFileName,
    authoritativePayoutField: "PaymentSummary.Total Payable",
    periodStartField: "PaymentSummary.Period Start Date",
    periodEndField: "PaymentSummary.Period End Date",
    paymentSummaryTransactionPostedAt: payout.paymentSummaryTransactionPostedAt,
    paymentSummaryTransactionKey: payout.paymentSummaryTransactionKey,
    paymentSummaryDescription: payout.paymentSummaryDescription,
    payoutDateSource: payout.payoutDateSource,
    settlementReference: payout.settlementReference
  });
}

async function getSettlementFeeCommitResolutions(
  context: ImportCommitContext,
  feeRows: WalmartPaymentSettlementRow[]
) {
  const linkableRows = feeRows.filter(shouldLinkSettlementFeeToPoLine);
  const purchaseOrderNumbers = uniqueStrings(
    linkableRows.map((row) => row.externalOrderId).filter(Boolean)
  );
  const orderItems: SettlementFeePoLineLookupRow[] = [];

  for (const purchaseOrderChunk of chunkArray(purchaseOrderNumbers, CREATE_CHUNK_SIZE)) {
    orderItems.push(
      ...(await prisma.salesOrderItem.findMany({
        where: {
          organizationId: context.organizationId,
          marketplace: context.marketplace,
          purchaseOrderNumber: { in: purchaseOrderChunk }
        },
        select: {
          id: true,
          orderId: true,
          sellerSku: true,
          purchaseOrderNumber: true,
          purchaseOrderLineNumber: true
        }
      }))
    );
  }

  return resolveSettlementFeeOrderLineMatches(feeRows, orderItems);
}

export function resolveSettlementFeeOrderLineMatches(
  feeRows: WalmartPaymentSettlementRow[],
  orderItems: SettlementFeePoLineLookupRow[]
) {
  const orderItemsByPoSku = new Map<string, SettlementFeePoLineLookupRow[]>();

  for (const orderItem of orderItems) {
    const poSkuKey = buildPoSkuMatchKey(
      orderItem.purchaseOrderNumber,
      orderItem.sellerSku
    );

    if (!poSkuKey) {
      continue;
    }

    const existing = orderItemsByPoSku.get(poSkuKey) ?? [];
    existing.push(orderItem);
    orderItemsByPoSku.set(poSkuKey, existing);
  }

  return new Map(
    feeRows.map((row) => [
      row.duplicateKey,
      resolveSettlementFeeCommitResolution(row, orderItemsByPoSku)
    ])
  );
}

function summarizeFeePoLineMatches(
  resolutions: Map<string, SettlementFeeCommitResolution>
) {
  const summary = {
    matched: 0,
    missingReference: 0,
    notFound: 0,
    ambiguous: 0,
    notApplicable: 0
  };

  for (const resolution of resolutions.values()) {
    if (resolution.matchStatus === "matched") {
      summary.matched += 1;
    } else if (resolution.matchStatus === "missing_reference") {
      summary.missingReference += 1;
    } else if (resolution.matchStatus === "not_found") {
      summary.notFound += 1;
    } else if (resolution.matchStatus === "ambiguous") {
      summary.ambiguous += 1;
    } else {
      summary.notApplicable += 1;
    }
  }

  return summary;
}

function resolveSettlementFeeCommitResolution(
  row: WalmartPaymentSettlementRow,
  orderItemsByPoSku: Map<string, SettlementFeePoLineLookupRow[]>
): SettlementFeeCommitResolution {
  if (!shouldLinkSettlementFeeToPoLine(row)) {
    return {
      orderId: null,
      orderItemId: null,
      sellerSku: getPersistedFeeSellerSku(row),
      ...resolveUnmatchedFeeReportingDate(row),
      matchStatus: "not_applicable",
      attributionScope: row.attributionScope,
      productAttributionReliable: row.productAttributionReliable
    };
  }

  const poSkuKey = buildPoSkuMatchKey(row.externalOrderId, row.sellerSku);

  if (!poSkuKey) {
    return buildUnmatchedLinkableFeeResolution(row, "missing_reference");
  }

  const matches = orderItemsByPoSku.get(poSkuKey) ?? [];

  if (matches.length !== 1) {
    return buildUnmatchedLinkableFeeResolution(
      row,
      matches.length > 1 ? "ambiguous" : "not_found"
    );
  }

  const [match] = matches;

  return {
    orderId: match.orderId,
    orderItemId: match.id,
    sellerSku: row.sellerSku ?? match.sellerSku,
    reportingDate: row.postedAt,
    reportingDateSource: TRANSACTION_POSTED_REPORTING_DATE_SOURCE,
    matchStatus: "matched",
    attributionScope: "product",
    productAttributionReliable: true
  };
}

function buildUnmatchedLinkableFeeResolution(
  row: WalmartPaymentSettlementRow,
  matchStatus: SettlementFeePoLineMatchStatus
): SettlementFeeCommitResolution {
  return {
    orderId: null,
    orderItemId: null,
    sellerSku: null,
    ...resolveUnmatchedFeeReportingDate(row),
    matchStatus,
    attributionScope: "marketplace",
    productAttributionReliable: false
  };
}

function resolveUnmatchedFeeReportingDate(row: WalmartPaymentSettlementRow): Pick<
  SettlementFeeCommitResolution,
  "reportingDate" | "reportingDateSource"
> {
  return {
    reportingDate: row.postedAt,
    reportingDateSource: TRANSACTION_POSTED_REPORTING_DATE_SOURCE
  };
}

function getPersistedFeeSellerSku(row: WalmartPaymentSettlementRow) {
  if (!row.productAttributionReliable || row.attributionScope !== "product") {
    return null;
  }

  return row.sellerSku;
}

function shouldLinkSettlementFeeToPoLine(row: WalmartPaymentSettlementRow) {
  return row.feeType === "commission" || row.feeType === "fulfillment_fee";
}

function buildPoSkuMatchKey(
  purchaseOrderNumber: string | null | undefined,
  sellerSku: string | null | undefined
) {
  const orderNumber = purchaseOrderNumber?.trim().toLowerCase();
  const sku = sellerSku?.trim().toLowerCase();

  if (!orderNumber || !sku) {
    return null;
  }

  return `${orderNumber}::${sku}`;
}

function resolveSettlementReportingDate({
  target,
  postedAt,
  externalOrderId,
  externalLineId
}: {
  target: WalmartPaymentSettlementRow["target"];
  postedAt: string;
  externalOrderId: string | null;
  externalLineId: string | null;
}): { date: string; source: SettlementReportingDateSource } {
  if (
    target !== "marketplace_fee" ||
    hasSpecificOrderLineReference(externalOrderId, externalLineId)
  ) {
    return {
      date: postedAt,
      source: TRANSACTION_POSTED_REPORTING_DATE_SOURCE
    };
  }

  return {
    date: postedAt,
    source: TRANSACTION_POSTED_REPORTING_DATE_SOURCE
  };
}

function hasSpecificOrderLineReference(
  externalOrderId: string | null,
  externalLineId: string | null
) {
  return Boolean(externalOrderId?.trim() && externalLineId?.trim());
}

function getFinancialDirection(amount: number): SettlementFinancialDirection {
  if (amount < 0) {
    return "charge";
  }

  if (amount > 0) {
    return "credit";
  }

  return "neutral";
}

function isOtherWalmartFee(row: WalmartPaymentSettlementRow) {
  return (
    row.target === "marketplace_fee" &&
    row.feeType !== "commission" &&
    row.feeType !== "fulfillment_fee"
  );
}

function summarizeOtherWalmartFees(rows: WalmartPaymentSettlementRow[]) {
  const charges = roundMoney(
    rows
      .filter((row) => row.financialDirection === "charge")
      .reduce((sum, row) => sum + Math.abs(row.amount), 0)
  );
  const credits = roundMoney(
    rows
      .filter((row) => row.financialDirection === "credit")
      .reduce((sum, row) => sum + Math.abs(row.amount), 0)
  );

  return {
    charges,
    credits,
    net: roundMoney(charges - credits)
  };
}

function summarizeOtherWalmartFeeCategories(rows: WalmartPaymentSettlementRow[]) {
  const categories = new Map<
    string,
    {
      category: string;
      categoryName: string;
      transactionCount: number;
      charges: number;
      credits: number;
      netAmount: number;
    }
  >();

  for (const row of rows) {
    const category = row.adjustmentCategory ?? row.feeType ?? "other_walmart_fee";
    const existing =
      categories.get(category) ??
      {
        category,
        categoryName: row.adjustmentCategoryLabel ?? humanizeClassifierText(category),
        transactionCount: 0,
        charges: 0,
        credits: 0,
        netAmount: 0
      };
    const expenseAmount = -row.amount;

    existing.transactionCount += 1;
    existing.netAmount = roundMoney(existing.netAmount + expenseAmount);

    if (row.financialDirection === "charge") {
      existing.charges = roundMoney(existing.charges + Math.abs(row.amount));
    } else if (row.financialDirection === "credit") {
      existing.credits = roundMoney(existing.credits + Math.abs(row.amount));
    }

    categories.set(category, existing);
  }

  return Array.from(categories.values()).sort((a, b) => Math.abs(b.netAmount) - Math.abs(a.netAmount));
}

function summarizeUnsupportedRows(rows: WalmartPaymentSettlementRow[]) {
  const unsupported = new Map<
    string,
    {
      transactionType: string;
      amountType: string;
      description: string;
      transactionCount: number;
      signedAmount: number;
    }
  >();

  for (const row of rows) {
    const key = [
      row.transactionType,
      row.amountType,
      row.transactionDescription,
      row.transactionReasonDescription ?? ""
    ].join("::");
    const existing =
      unsupported.get(key) ??
      {
        transactionType: row.transactionType,
        amountType: row.amountType,
        description: row.transactionDescription,
        transactionCount: 0,
        signedAmount: 0
      };

    existing.transactionCount += 1;
    existing.signedAmount = roundMoney(existing.signedAmount + row.amount);
    unsupported.set(key, existing);
  }

  return Array.from(unsupported.values()).sort((a, b) => Math.abs(b.signedAmount) - Math.abs(a.signedAmount));
}

function getPaymentSummaryPeriod(rawRows: Array<Record<string, unknown>>): SettlementReportPeriod {
  const summaryRow = rawRows.find(
    (row) =>
      normalizeClassifierText(readText(row["Transaction Type"])).replace(/_/g, "") ===
      "paymentsummary"
  );

  if (!summaryRow) {
    return {
      periodStartDate: null,
      periodEndDate: null,
      totalPayable: null,
      postedAt: null,
      payoutDate: null,
      payoutDateSource: null,
      currency: "USD",
      transactionKey: null,
      transactionDescription: null
    };
  }

  const payoutDate = readFirstDateString(summaryRow, [
    "Payout Date",
    "Payment Date",
    "Deposit Date",
    "Settlement Deposit Date"
  ]);

  return {
    periodStartDate: readDateString(summaryRow["Period Start Date"]),
    periodEndDate: readDateString(summaryRow["Period End Date"]),
    totalPayable: readMoney(summaryRow["Total Payable"]),
    postedAt: readDateString(summaryRow["Transaction Posted Timestamp"]),
    payoutDate: payoutDate.value,
    payoutDateSource: payoutDate.source,
    currency: readText(summaryRow.Currency) || "USD",
    transactionKey: readOptionalText(summaryRow["Transaction Key"]),
    transactionDescription: readOptionalText(summaryRow["Transaction Description"])
  };
}

function buildSettlementPayoutPayload(
  reportPeriod: SettlementReportPeriod,
  originalFileName: string
): SettlementPayoutPayload | null {
  if (reportPeriod.totalPayable === null) {
    return null;
  }

  return {
    settlementReference: buildPayoutReference(reportPeriod, originalFileName),
    settlementPeriodStart: reportPeriod.periodStartDate,
    settlementPeriodEnd: reportPeriod.periodEndDate,
    payoutAmount: reportPeriod.totalPayable,
    payoutDate: reportPeriod.payoutDate,
    payoutDateSource: reportPeriod.payoutDateSource,
    currency: reportPeriod.currency,
    source: "walmart_payments_new",
    originalFileName,
    paymentSummaryTransactionPostedAt: reportPeriod.postedAt,
    paymentSummaryTransactionKey: reportPeriod.transactionKey,
    paymentSummaryDescription: reportPeriod.transactionDescription
  };
}

function buildPayoutReference(
  reportPeriod: SettlementReportPeriod,
  originalFileName: string
) {
  if (reportPeriod.transactionKey) {
    return `walmart_payments_new:${reportPeriod.transactionKey.trim().toLowerCase()}`;
  }

  return [
    "walmart_payments_new",
    reportPeriod.periodStartDate?.slice(0, 10) ?? "missing-start",
    reportPeriod.periodEndDate?.slice(0, 10) ?? "missing-end",
    reportPeriod.currency,
    String(reportPeriod.totalPayable ?? "missing-payable"),
    reportPeriod.periodStartDate && reportPeriod.periodEndDate
      ? ""
      : originalFileName || "missing-file"
  ]
    .filter(Boolean)
    .map((value) => value.trim().toLowerCase())
    .join("::");
}

function buildSettlementReference(row: WalmartPaymentSettlementRow, originalFileName: string) {
  return [
    originalFileName,
    row.periodStartDate?.slice(0, 10) ?? "",
    row.periodEndDate?.slice(0, 10) ?? "",
    row.transactionKey ?? row.duplicateKey
  ]
    .filter(Boolean)
    .join("::");
}

function buildDuplicateKey(row: WalmartPaymentSettlementRow) {
  return [
    row.transactionKey ?? "",
    row.postedAt,
    row.transactionType,
    row.amountType,
    row.transactionDescription,
    row.transactionReasonDescription ?? "",
    row.externalOrderId ?? "",
    row.externalLineId ?? "",
    row.customerOrderId ?? "",
    row.customerOrderLineId ?? "",
    row.sellerSku ?? "",
    row.currency,
    row.target,
    row.feeType ?? "",
    row.adjustmentCategory ?? "",
    row.fulfillmentType ?? "",
    row.fulfillmentDetails ?? ""
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

function humanizeClassifierText(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

function readOptionalNumber(value: unknown) {
  const parsed = readMoney(value);
  return parsed === null ? null : parsed;
}

function readNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const valueAsNumber = readNumber(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
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

function readFirstDateString(
  row: Record<string, unknown>,
  fields: string[]
): { value: string | null; source: string | null } {
  for (const field of fields) {
    const value = readDateString(row[field]);

    if (value) {
      return { value, source: field };
    }
  }

  return { value: null, source: null };
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

  if (
    text === "marketplace_fee" ||
    text === "refund" ||
    text === "advertising"
  ) {
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

function readReportingDateSource(value: unknown): SettlementReportingDateSource {
  if (value === UNMATCHED_FEE_PERIOD_END_REPORTING_DATE_SOURCE) {
    return UNMATCHED_FEE_PERIOD_END_REPORTING_DATE_SOURCE;
  }

  if (value === UNMATCHED_FEE_POSTING_DATE_FALLBACK_SOURCE) {
    return UNMATCHED_FEE_POSTING_DATE_FALLBACK_SOURCE;
  }

  return TRANSACTION_POSTED_REPORTING_DATE_SOURCE;
}

function readClassificationStatus(value: unknown): SettlementClassificationStatus {
  const text = readStringValue(value);

  if (text === "classified" || text === "ignored" || text === "unsupported") {
    return text;
  }

  return "classified";
}

function readFinancialDirection(value: unknown): SettlementFinancialDirection {
  const text = readStringValue(value);

  if (text === "charge" || text === "credit" || text === "neutral") {
    return text;
  }

  return "neutral";
}

function readAttributionScope(value: unknown): SettlementAttributionScope {
  const text = readStringValue(value);

  if (text === "product" || text === "marketplace") {
    return text;
  }

  return "marketplace";
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  return readStringValue(value).toLowerCase() === "true";
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
