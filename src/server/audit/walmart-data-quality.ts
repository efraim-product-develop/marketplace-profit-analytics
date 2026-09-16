import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.ts";
import { EffectiveCogsService } from "../cogs/effective-cogs.ts";
import { calculateProfitRows, summarizeProfit } from "../pnl/engine.ts";
import {
  buildProductAttributionDiagnostics,
  filterProductAttributableFees,
  filterProductAttributableRefunds,
  filterProductAttributedAdvertisingCosts
} from "../pnl/product-attribution.ts";
import type {
  ProductAttributionDiagnostics,
  ProfitAdvertisingCostInput,
  ProfitFeeInput,
  ProfitLineInput,
  ProfitRefundInput
} from "../pnl/types.ts";
import { getPoSalesSourceFromOrderItem } from "../sales/po-sales-source.ts";

export type AuditStatus = "Complete" | "Partial" | "Missing" | "Coverage Unknown";

export type AuditDateRange = {
  from: Date;
  to: Date;
};

export type AuditSourceChecklist = {
  poSales: AuditStatus;
  settlements: AuditStatus;
  cogs: AuditStatus;
  sellerCenterSem: AuditStatus;
  walmartConnect: AuditStatus;
};

export type WalmartDataQualityAudit = {
  marketplace: string;
  dateRange: AuditDateRange;
  expectedDates: string[];
  overallStatus: "P&L Data Ready" | "P&L Data Incomplete";
  missingReasons: string[];
  checklist: AuditSourceChecklist;
  poSales: PoSalesAudit;
  settlements: SettlementAudit;
  sellerCenterSem: AdvertisingCoverageAudit;
  walmartConnect: WalmartConnectCoverageAudit;
  cogs: CogsCoverageAudit;
  attribution: ProductAttributionAudit;
  marketplacePnl: MarketplacePnlAudit;
  productPnl: ProductPnlAudit;
};

export type PoSalesAudit = {
  status: AuditStatus;
  statusReason: string;
  earliestOrderDate: string | null;
  latestOrderDate: string | null;
  selectedCoverage: DateCoverage;
  rows: number;
  cancelledRows: number;
  duplicateUpsertedRows: number;
  importedRows: number;
  sales: number;
  units: number;
  orders: number;
  wfs: FulfillmentCoverage;
  sellerFulfilled: FulfillmentCoverage;
  unknownFulfillment: FulfillmentCoverage;
};

export type FulfillmentCoverage = {
  rows: number;
  salesRows: number;
  cancelledRows: number;
  sales: number;
  units: number;
  orders: number;
};

export type SettlementAudit = {
  status: AuditStatus;
  statusReason: string;
  relevantSettlements: SettlementPeriodRow[];
  refundTotal: number;
  marketplaceCommission: number;
  fulfillmentFees: number;
  otherWalmartFeesAndAdjustments: number;
  unsupportedFinancialRows: number;
  importedAt: string | null;
};

export type SettlementPeriodRow = {
  settlementPeriodStart: string | null;
  settlementPeriodEnd: string | null;
  payoutDate: string | null;
  payoutAmount: number;
  refundTotal: number;
  marketplaceCommission: number;
  fulfillmentFees: number;
  otherWalmartFeesAndAdjustments: number;
  unsupportedFinancialRows: number;
  importedAt: string;
  source: string;
};

export type AdvertisingCoverageAudit = {
  status: AuditStatus;
  statusReason: string;
  earliestDate: string | null;
  latestDate: string | null;
  selectedCoverage: DateCoverage;
  rows: number;
  spend: number;
  attributedSales: number;
  missingDates: string[];
  confirmedZeroSpendDates: string[];
};

export type WalmartConnectCoverageAudit = AdvertisingCoverageAudit & {
  skuAttributableSpend: number;
  unallocatedSpend: number;
  retiredMonthlyRows: number;
  retiredMonthlySpend: number;
};

export type CogsCoverageAudit = {
  status: AuditStatus;
  statusReason: string;
  skusSold: number;
  skusWithValidCogs: number;
  skusMissingCogs: number;
  unitsAffectedByMissingCogs: number;
  salesAffectedByMissingCogs: number;
  missingSkuRows: Array<{
    sellerSku: string;
    parentSku: string | null;
    units: number;
    sales: number;
  }>;
};

export type ProductAttributionAudit = {
  refunds: AttributionLine;
  marketplaceCommission: AttributionLine;
  fulfillmentFees: AttributionLine;
  walmartConnectAdvertising: AttributionLine;
  sellerCenterSem: {
    amount: number;
    note: string;
  };
  otherWalmartFeesAndAdjustments: {
    amount: number;
    note: string;
  };
  diagnostics: ProductAttributionDiagnostics;
};

export type AttributionLine = {
  total: number;
  skuAttributable: number;
  unallocated: number;
};

export type MarketplacePnlAudit = {
  grossSales: number;
  sales: number;
  refunds: number;
  cogs: number;
  marketplaceCommission: number;
  fulfillmentFees: number;
  sellerCenterSem: number;
  walmartConnectAdvertising: number;
  otherWalmartFeesAndAdjustments: number;
  profit: number;
  settlementPayout: number;
};

export type ProductPnlAudit = {
  grossSales: number;
  sales: number;
  refunds: number;
  cogs: number;
  marketplaceCommission: number;
  fulfillmentFees: number;
  walmartConnectAdvertising: number;
  profit: number;
};

export type DateCoverage = {
  expectedDates: string[];
  coveredDates: string[];
  missingDates: string[];
  status: AuditStatus;
  coverageComplete: boolean;
};

type AuditOrderItem = Prisma.SalesOrderItemGetPayload<{
  select: {
    marketplace: true;
    orderId: true;
    sellerSku: true;
    parentSku: true;
    quantity: true;
    itemRevenue: true;
    shippingRevenue: true;
    discountAmount: true;
    taxCollected: true;
    cogsTotal: true;
    poOrderStatus: true;
    poFulfillmentType: true;
    order: {
      select: {
        orderDate: true;
        status: true;
      };
    };
  };
}>;

type SettlementFeeRow = Prisma.MarketplaceFeeGetPayload<Record<string, never>>;
type SettlementRefundRow = Prisma.RefundGetPayload<Record<string, never>>;
type AdvertisingCostRow = Prisma.AdvertisingCostGetPayload<Record<string, never>>;

const WALMART_PO_REPORT_TYPE = "walmart_po_order_sales";
const WALMART_SETTLEMENT_REPORT_TYPE = "walmart_payments_new";
const SEM_SOURCES = new Set(["walmart_seller_center_sem", "seller_center_sem"]);
const WALMART_CONNECT_SOURCE = "walmart_connect_item_performance";

export async function getWalmartDataQualityAudit({
  organizationId,
  marketplace,
  dateRange
}: {
  organizationId: string;
  marketplace: string;
  dateRange: AuditDateRange;
}): Promise<WalmartDataQualityAudit> {
  const normalizedRange = normalizeDateRange(dateRange);
  const expectedDates = getDateStringsInRange(normalizedRange);
  const [
    selectedItems,
    allOrderDates,
    salesImportRuns,
    settlementImportRuns,
    settlementPayouts,
    marketplaceFees,
    refunds,
    advertisingCosts,
    costRecords,
    parentSkuRows
  ] = await Promise.all([
    prisma.salesOrderItem.findMany({
      where: {
        organizationId,
        marketplace,
        order: { orderDate: { gte: normalizedRange.from, lte: normalizedRange.to } }
      },
      select: {
        marketplace: true,
        orderId: true,
        sellerSku: true,
        parentSku: true,
        quantity: true,
        itemRevenue: true,
        shippingRevenue: true,
        discountAmount: true,
        taxCollected: true,
        cogsTotal: true,
        poOrderStatus: true,
        poFulfillmentType: true,
        order: {
          select: {
            orderDate: true,
            status: true
          }
        }
      }
    }),
    prisma.salesOrder.findMany({
      where: { organizationId, marketplace },
      select: { orderDate: true },
      orderBy: { orderDate: "asc" }
    }),
    prisma.importRun.findMany({
      where: {
        organizationId,
        marketplace,
        importKind: "sales",
        reportType: WALMART_PO_REPORT_TYPE
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.importRun.findMany({
      where: {
        organizationId,
        marketplace,
        importKind: "settlements",
        reportType: WALMART_SETTLEMENT_REPORT_TYPE
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.settlementPayout.findMany({
      where: {
        organizationId,
        marketplace,
        OR: [
          {
            AND: [
              { settlementPeriodStart: { lte: normalizedRange.to } },
              { settlementPeriodEnd: { gte: normalizedRange.from } }
            ]
          },
          { payoutDate: { gte: normalizedRange.from, lte: normalizedRange.to } }
        ]
      },
      orderBy: [
        { settlementPeriodStart: "asc" },
        { importedAt: "asc" }
      ]
    }),
    prisma.marketplaceFee.findMany({
      where: {
        organizationId,
        marketplace,
        OR: [
          { postedAt: { gte: normalizedRange.from, lte: normalizedRange.to } },
          {
            AND: [
              { postedAt: null },
              { createdAt: { lte: normalizedRange.to } }
            ]
          }
        ]
      }
    }),
    prisma.refund.findMany({
      where: {
        organizationId,
        marketplace,
        OR: [
          { refundDate: { gte: normalizedRange.from, lte: normalizedRange.to } },
          {
            AND: [
              { refundDate: null },
              { createdAt: { lte: normalizedRange.to } }
            ]
          }
        ]
      }
    }),
    prisma.advertisingCost.findMany({
      where: {
        organizationId,
        marketplace,
        costDate: { gte: normalizedRange.from, lte: normalizedRange.to }
      }
    }),
    prisma.costRecord.findMany({
      where: {
        organizationId,
        marketplace,
        effectiveDate: { lte: normalizedRange.to }
      },
      orderBy: [{ sellerSku: "asc" }, { effectiveDate: "desc" }]
    }),
    prisma.listing.findMany({
      where: { organizationId, marketplace },
      select: { sellerSku: true, parentSku: true }
    })
  ]);
  const parentSkuBySellerSku = new Map(parentSkuRows.map((row) => [row.sellerSku, row.parentSku]));
  const supportedItems = selectedItems.filter(isSupportedPoAuditItem);
  const cancelledItems = selectedItems.filter(isCancelledAuditItem);
  const profitLines = buildProfitLines(supportedItems, parentSkuBySellerSku);
  const settlementFees = marketplaceFees.filter(isActiveSettlementFee);
  const settlementRefunds = refunds.filter(isSettlementRefund);
  const feeInputs = settlementFees.map((fee) => mapFeeInput(fee, parentSkuBySellerSku));
  const refundInputs = settlementRefunds.map((refund) => mapRefundInput(refund, parentSkuBySellerSku));
  const adInputs = advertisingCosts.map(mapAdvertisingInput);
  const productFees = filterProductAttributableFees(feeInputs);
  const productRefunds = filterProductAttributableRefunds(refundInputs);
  const productAds = filterProductAttributedAdvertisingCosts(adInputs);
  const marketplaceSummary = summarizeProfit(
    calculateProfitRows(profitLines, "parentSku", adInputs, feeInputs, refundInputs)
  );
  const productSummary = summarizeProfit(
    calculateProfitRows(profitLines, "parentSku", productAds, productFees, productRefunds)
  );
  const poSales = buildPoSalesAudit({
    expectedDates,
    dateRange: normalizedRange,
    selectedItems,
    supportedItems,
    cancelledItems,
    allOrderDates,
    importRuns: salesImportRuns
  });
  const settlements = buildSettlementAudit({
    expectedDates,
    dateRange: normalizedRange,
    payouts: settlementPayouts,
    importRuns: settlementImportRuns,
    feeInputs,
    refundInputs
  });
  const sellerCenterSem = buildSellerCenterSemAudit(expectedDates, adInputs);
  const walmartConnect = buildWalmartConnectAudit(expectedDates, advertisingCosts.map(mapAdvertisingInput));
  const cogs = buildCogsAudit({
    lines: profitLines,
    costRecords: costRecords.map((record) => ({
      marketplace: record.marketplace,
      sellerSku: record.sellerSku,
      effectiveDate: record.effectiveDate,
      unitCost: record.unitCost
    }))
  });
  const attribution = buildProductAttributionAudit({
    feeInputs,
    refundInputs,
    advertisingCosts: adInputs
  });
  const checklist = {
    poSales: poSales.status,
    settlements: settlements.status,
    cogs: cogs.status,
    sellerCenterSem: sellerCenterSem.status,
    walmartConnect: walmartConnect.status
  };
  const missingReasons = buildReadinessReasons({
    poSales,
    settlements,
    cogs,
    sellerCenterSem,
    walmartConnect
  });

  return {
    marketplace,
    dateRange: normalizedRange,
    expectedDates,
    overallStatus: missingReasons.length ? "P&L Data Incomplete" : "P&L Data Ready",
    missingReasons,
    checklist,
    poSales,
    settlements,
    sellerCenterSem,
    walmartConnect,
    cogs,
    attribution,
    marketplacePnl: {
      grossSales: roundMoney(marketplaceSummary.grossRevenue),
      sales: roundMoney(marketplaceSummary.netRevenue),
      refunds: roundMoney(marketplaceSummary.salesRefunds),
      cogs: roundMoney(marketplaceSummary.cogs),
      marketplaceCommission: roundMoney(marketplaceSummary.commissionFees),
      fulfillmentFees: roundMoney(marketplaceSummary.fulfillmentFees),
      sellerCenterSem: roundMoney(marketplaceSummary.semAdvertisingCost),
      walmartConnectAdvertising: roundMoney(marketplaceSummary.walmartConnectAdvertisingCost),
      otherWalmartFeesAndAdjustments: roundMoney(
        marketplaceSummary.marketplaceFees -
          marketplaceSummary.commissionFees -
          marketplaceSummary.fulfillmentFees
      ),
      profit: roundMoney(marketplaceSummary.netProfit),
      settlementPayout: roundMoney(
        settlementPayouts.reduce((sum, payout) => sum + toNumber(payout.payoutAmount), 0)
      )
    },
    productPnl: {
      grossSales: roundMoney(productSummary.grossRevenue),
      sales: roundMoney(productSummary.netRevenue),
      refunds: roundMoney(productSummary.salesRefunds),
      cogs: roundMoney(productSummary.cogs),
      marketplaceCommission: roundMoney(productSummary.commissionFees),
      fulfillmentFees: roundMoney(productSummary.fulfillmentFees),
      walmartConnectAdvertising: roundMoney(productSummary.walmartConnectAdvertisingCost),
      profit: roundMoney(productSummary.netProfit)
    }
  };
}

export function buildDateCoverage({
  expectedDates,
  coveredDates,
  confirmedZeroDates = [],
  canProveCompleteness = true
}: {
  expectedDates: string[];
  coveredDates: string[];
  confirmedZeroDates?: string[];
  canProveCompleteness?: boolean;
}): DateCoverage {
  const covered = new Set([...coveredDates, ...confirmedZeroDates]);
  const missingDates = expectedDates.filter((date) => !covered.has(date));
  const uniqueCoveredDates = [...new Set(coveredDates)].sort();

  if (!expectedDates.length) {
    return {
      expectedDates,
      coveredDates: uniqueCoveredDates,
      missingDates: [],
      status: "Coverage Unknown",
      coverageComplete: false
    };
  }

  if (!uniqueCoveredDates.length && !confirmedZeroDates.length) {
    return {
      expectedDates,
      coveredDates: uniqueCoveredDates,
      missingDates,
      status: "Missing",
      coverageComplete: false
    };
  }

  if (!canProveCompleteness) {
    return {
      expectedDates,
      coveredDates: uniqueCoveredDates,
      missingDates,
      status: "Coverage Unknown",
      coverageComplete: false
    };
  }

  if (!missingDates.length) {
    return {
      expectedDates,
      coveredDates: uniqueCoveredDates,
      missingDates,
      status: "Complete",
      coverageComplete: true
    };
  }

  return {
    expectedDates,
    coveredDates: uniqueCoveredDates,
    missingDates,
    status: "Partial",
    coverageComplete: false
  };
}

export function buildReadinessStatus(checklist: AuditSourceChecklist) {
  return Object.values(checklist).every((status) => status === "Complete")
    ? "P&L Data Ready"
    : "P&L Data Incomplete";
}

function buildPoSalesAudit({
  expectedDates,
  dateRange,
  selectedItems,
  supportedItems,
  cancelledItems,
  allOrderDates,
  importRuns
}: {
  expectedDates: string[];
  dateRange: AuditDateRange;
  selectedItems: AuditOrderItem[];
  supportedItems: AuditOrderItem[];
  cancelledItems: AuditOrderItem[];
  allOrderDates: Array<{ orderDate: Date }>;
  importRuns: Array<{ summary: Prisma.JsonValue; status: string }>;
}): PoSalesAudit {
  const selectedDates = supportedItems.map((item) => formatDateKey(item.order.orderDate));
  const hasOverlappingImport = importRuns.some((run) =>
    importRunOverlapsDateRange(run.summary, dateRange)
  );
  const selectedCoverage = buildDateCoverage({
    expectedDates,
    coveredDates: selectedDates,
    canProveCompleteness: false
  });
  const earliestOrderDate = allOrderDates[0]?.orderDate ?? null;
  const latestOrderDate = allOrderDates.at(-1)?.orderDate ?? null;
  const status = classifyPoCoverage({
    hasRows: supportedItems.length > 0,
    hasOverlappingImport,
    earliestOrderDate,
    latestOrderDate,
    dateRange
  });
  const fulfillment = buildFulfillmentAudit(supportedItems, cancelledItems);
  const importedRows = sumImportSummaryNumber(importRuns, "importedRows");
  const duplicateUpsertedRows =
    sumImportSummaryNumber(importRuns, "duplicateUpsertedRows") +
    sumImportSummaryNumber(importRuns, "updatedRows");

  return {
    status,
    statusReason: getPoStatusReason(status),
    earliestOrderDate: earliestOrderDate ? formatDateKey(earliestOrderDate) : null,
    latestOrderDate: latestOrderDate ? formatDateKey(latestOrderDate) : null,
    selectedCoverage,
    rows: selectedItems.length,
    cancelledRows: cancelledItems.length,
    duplicateUpsertedRows,
    importedRows,
    sales: roundMoney(supportedItems.reduce((sum, item) => sum + toNumber(item.itemRevenue), 0)),
    units: supportedItems.reduce((sum, item) => sum + item.quantity, 0),
    orders: new Set(supportedItems.map((item) => item.orderId)).size,
    wfs: fulfillment.wfs,
    sellerFulfilled: fulfillment.sellerFulfilled,
    unknownFulfillment: fulfillment.unknown
  };
}

function classifyPoCoverage({
  hasRows,
  hasOverlappingImport,
  earliestOrderDate,
  latestOrderDate,
  dateRange
}: {
  hasRows: boolean;
  hasOverlappingImport: boolean;
  earliestOrderDate: Date | null;
  latestOrderDate: Date | null;
  dateRange: AuditDateRange;
}): AuditStatus {
  if (!hasRows && !hasOverlappingImport) {
    return "Missing";
  }

  if (
    earliestOrderDate &&
    latestOrderDate &&
    (dateRange.from < startOfUtcDay(earliestOrderDate) ||
      dateRange.to > endOfUtcDay(latestOrderDate))
  ) {
    return "Partial";
  }

  return "Coverage Unknown";
}

function getPoStatusReason(status: AuditStatus) {
  if (status === "Missing") {
    return "No PO sales rows or overlapping PO import metadata were found for this period.";
  }

  if (status === "Partial") {
    return "The selected period extends beyond the earliest/latest imported PO order dates.";
  }

  return "PO rows exist, but current PO import metadata does not prove every calendar day in the selected period was included in an uploaded report.";
}

function buildFulfillmentAudit(
  supportedItems: AuditOrderItem[],
  cancelledItems: AuditOrderItem[]
) {
  const buckets = {
    wfs: createFulfillmentCoverage(),
    sellerFulfilled: createFulfillmentCoverage(),
    unknown: createFulfillmentCoverage()
  };

  for (const item of supportedItems) {
    const bucket = buckets[getFulfillmentBucket(item)];
    bucket.rows += 1;
    bucket.salesRows += 1;
    bucket.sales = roundMoney(bucket.sales + toNumber(item.itemRevenue));
    bucket.units += item.quantity;
    bucket.orders += 1;
  }

  for (const item of cancelledItems) {
    const bucket = buckets[getFulfillmentBucket(item)];
    bucket.rows += 1;
    bucket.cancelledRows += 1;
  }

  return buckets;
}

export function buildSettlementAudit({
  expectedDates,
  dateRange,
  payouts,
  importRuns,
  feeInputs,
  refundInputs
}: {
  expectedDates: string[];
  dateRange: AuditDateRange;
  payouts: Array<{
    settlementPeriodStart: Date | null;
    settlementPeriodEnd: Date | null;
    payoutDate: Date | null;
    payoutAmount: unknown;
    importedAt: Date;
    source: string;
  }>;
  importRuns: Array<{ summary: Prisma.JsonValue; importedAt: Date | null; createdAt: Date }>;
  feeInputs: ProfitFeeInput[];
  refundInputs: ProfitRefundInput[];
}): SettlementAudit {
  const coveredDates = getCoveredDatesFromSettlementPeriods(payouts);
  const hasMissingPeriodMetadata = payouts.some(
    (payout) => !payout.settlementPeriodStart || !payout.settlementPeriodEnd
  );
  const coverage = buildDateCoverage({
    expectedDates,
    coveredDates,
    canProveCompleteness: !hasMissingPeriodMetadata
  });
  const status = payouts.length ? coverage.status : "Missing";
  const feeSummary = summarizeFinancialInputs(feeInputs, refundInputs);
  const unsupportedFinancialRows = sumImportSummaryNumber(importRuns, "unsupportedFinancialRows");
  const importedAt = getLatestImportDate(importRuns);

  return {
    status,
    statusReason: getSettlementStatusReason(status, hasMissingPeriodMetadata),
    relevantSettlements: payouts.map((payout) =>
      buildSettlementPeriodRow({
        payout,
        feeInputs,
        refundInputs,
        unsupportedFinancialRows
      })
    ),
    refundTotal: roundMoney(feeSummary.salesRefunds),
    marketplaceCommission: roundMoney(feeSummary.commissionFees),
    fulfillmentFees: roundMoney(feeSummary.fulfillmentFees),
    otherWalmartFeesAndAdjustments: roundMoney(
      feeSummary.marketplaceFees - feeSummary.commissionFees - feeSummary.fulfillmentFees
    ),
    unsupportedFinancialRows,
    importedAt
  };
}

function buildSettlementPeriodRow({
  payout,
  feeInputs,
  refundInputs,
  unsupportedFinancialRows
}: {
  payout: {
    settlementPeriodStart: Date | null;
    settlementPeriodEnd: Date | null;
    payoutDate: Date | null;
    payoutAmount: unknown;
    importedAt: Date;
    source: string;
  };
  feeInputs: ProfitFeeInput[];
  refundInputs: ProfitRefundInput[];
  unsupportedFinancialRows: number;
}): SettlementPeriodRow {
  const periodRange =
    payout.settlementPeriodStart && payout.settlementPeriodEnd
      ? {
          from: startOfUtcDay(payout.settlementPeriodStart),
          to: endOfUtcDay(payout.settlementPeriodEnd)
        }
      : null;
  const periodFees = periodRange
    ? feeInputs.filter((fee) => dateFallsInRange(fee.postedAt, periodRange))
    : feeInputs;
  const periodRefunds = periodRange
    ? refundInputs.filter((refund) => dateFallsInRange(refund.refundDate, periodRange))
    : refundInputs;
  const feeSummary = summarizeFinancialInputs(periodFees, periodRefunds);

  return {
    settlementPeriodStart: payout.settlementPeriodStart
      ? formatDateKey(payout.settlementPeriodStart)
      : null,
    settlementPeriodEnd: payout.settlementPeriodEnd
      ? formatDateKey(payout.settlementPeriodEnd)
      : null,
    payoutDate: payout.payoutDate ? formatDateKey(payout.payoutDate) : null,
    payoutAmount: roundMoney(toNumber(payout.payoutAmount)),
    refundTotal: roundMoney(feeSummary.salesRefunds),
    marketplaceCommission: roundMoney(feeSummary.commissionFees),
    fulfillmentFees: roundMoney(feeSummary.fulfillmentFees),
    otherWalmartFeesAndAdjustments: roundMoney(
      feeSummary.marketplaceFees - feeSummary.commissionFees - feeSummary.fulfillmentFees
    ),
    unsupportedFinancialRows,
    importedAt: payout.importedAt.toISOString(),
    source: payout.source
  };
}

function summarizeFinancialInputs(feeInputs: ProfitFeeInput[], refundInputs: ProfitRefundInput[]) {
  return summarizeProfit(calculateProfitRows([], "parentSku", [], feeInputs, refundInputs));
}

function getSettlementStatusReason(status: AuditStatus, hasMissingPeriodMetadata: boolean) {
  if (status === "Complete") {
    return "Imported settlement periods cover every date in the selected range.";
  }

  if (status === "Partial") {
    return "Some selected dates are not covered by imported settlement periods.";
  }

  if (hasMissingPeriodMetadata) {
    return "Some settlement payout rows are missing period dates, so coverage cannot be proven.";
  }

  return "No overlapping settlement period was found for the selected range.";
}

export function buildSellerCenterSemAudit(
  expectedDates: string[],
  advertisingCosts: ProfitAdvertisingCostInput[]
): AdvertisingCoverageAudit {
  const semRows = advertisingCosts.filter((cost) => SEM_SOURCES.has(cost.source));
  const confirmedZeroSpendDates = getConfirmedZeroDates(semRows);
  const coverage = buildDateCoverage({
    expectedDates,
    coveredDates: semRows
      .map((row) => row.costDate)
      .filter((date): date is Date => Boolean(date))
      .map(formatDateKey),
    confirmedZeroDates: confirmedZeroSpendDates
  });
  const dates = semRows.map((row) => row.costDate).filter((date): date is Date => Boolean(date));

  return {
    status: coverage.status,
    statusReason: getDailyAdCoverageReason(coverage, "Seller Center SEM"),
    earliestDate: minDateString(dates),
    latestDate: maxDateString(dates),
    selectedCoverage: coverage,
    rows: semRows.length,
    spend: roundMoney(semRows.reduce((sum, row) => sum + row.amount, 0)),
    attributedSales: roundMoney(
      semRows.reduce((sum, row) => sum + readMetadataNumber(row.metadata, "attributedSales"), 0)
    ),
    missingDates: coverage.missingDates,
    confirmedZeroSpendDates
  };
}

export function buildWalmartConnectAudit(
  expectedDates: string[],
  advertisingCosts: ProfitAdvertisingCostInput[]
): WalmartConnectCoverageAudit {
  const connectRows = advertisingCosts.filter((cost) => cost.source === WALMART_CONNECT_SOURCE);
  const dailyRows = connectRows.filter(isDailyWalmartConnectCost);
  const retiredRows = connectRows.filter((cost) => !isDailyWalmartConnectCost(cost));
  const productRows = filterProductAttributedAdvertisingCosts(dailyRows);
  const confirmedZeroSpendDates = getConfirmedZeroDates(dailyRows);
  const coverage = buildDateCoverage({
    expectedDates,
    coveredDates: dailyRows
      .map((row) => row.costDate)
      .filter((date): date is Date => Boolean(date))
      .map(formatDateKey),
    confirmedZeroDates: confirmedZeroSpendDates
  });
  const dates = dailyRows.map((row) => row.costDate).filter((date): date is Date => Boolean(date));
  const spend = roundMoney(dailyRows.reduce((sum, row) => sum + row.amount, 0));
  const skuAttributableSpend = roundMoney(productRows.reduce((sum, row) => sum + row.amount, 0));

  return {
    status: coverage.status,
    statusReason:
      retiredRows.length && !dailyRows.length
        ? "Only retired monthly/cumulative Walmart Connect rows exist for this period; they do not count as daily P&L coverage."
        : getDailyAdCoverageReason(coverage, "Walmart Connect"),
    earliestDate: minDateString(dates),
    latestDate: maxDateString(dates),
    selectedCoverage: coverage,
    rows: dailyRows.length,
    spend,
    attributedSales: roundMoney(
      dailyRows.reduce((sum, row) => sum + readMetadataNumber(row.metadata, "attributedSales"), 0)
    ),
    missingDates: coverage.missingDates,
    confirmedZeroSpendDates,
    skuAttributableSpend,
    unallocatedSpend: roundMoney(spend - skuAttributableSpend),
    retiredMonthlyRows: retiredRows.length,
    retiredMonthlySpend: roundMoney(retiredRows.reduce((sum, row) => sum + row.amount, 0))
  };
}

export function buildCogsAudit({
  lines,
  costRecords
}: {
  lines: ProfitLineInput[];
  costRecords: Array<{
    marketplace: string | null;
    sellerSku: string;
    effectiveDate: Date;
    unitCost: unknown;
  }>;
}): CogsCoverageAudit {
  const service = new EffectiveCogsService(costRecords);
  const results = service.getEffectiveCogsForOrderLines(
    lines.map((line, index) => ({
      id: `${line.sellerSku}:${line.orderId ?? index}`,
      marketplace: line.marketplace,
      sellerSku: line.sellerSku,
      orderDate: line.orderDate ?? new Date(0),
      quantity: line.quantity,
      cogsUnit: null
    }))
  );
  const soldSkus = new Set(lines.map((line) => line.sellerSku));
  const missingBySku = new Map<string, { parentSku: string | null; units: number; sales: number }>();
  const validSkus = new Set<string>();

  lines.forEach((line, index) => {
    const result = results.get(`${line.sellerSku}:${line.orderId ?? index}`);

    if (!result || result.missingCogs) {
      const existing = missingBySku.get(line.sellerSku) ?? {
        parentSku: line.parentSku ?? null,
        units: 0,
        sales: 0
      };
      existing.units += line.quantity;
      existing.sales = roundMoney(existing.sales + line.itemRevenue);
      missingBySku.set(line.sellerSku, existing);
      return;
    }

    validSkus.add(line.sellerSku);
  });

  const missingSkuRows = Array.from(missingBySku.entries())
    .map(([sellerSku, row]) => ({
      sellerSku,
      parentSku: row.parentSku,
      units: row.units,
      sales: roundMoney(row.sales)
    }))
    .sort((a, b) => b.sales - a.sales);
  const status = !lines.length
    ? "Coverage Unknown"
    : missingSkuRows.length
      ? "Partial"
      : "Complete";

  return {
    status,
    statusReason:
      status === "Complete"
        ? "Every sold SKU in this period has an effective COGS record for the PO order date."
        : status === "Partial"
          ? "Some sold SKUs do not have effective COGS for the PO order date."
          : "No PO sales rows were found, so COGS coverage for this period cannot be evaluated.",
    skusSold: soldSkus.size,
    skusWithValidCogs: validSkus.size,
    skusMissingCogs: missingSkuRows.length,
    unitsAffectedByMissingCogs: missingSkuRows.reduce((sum, row) => sum + row.units, 0),
    salesAffectedByMissingCogs: roundMoney(missingSkuRows.reduce((sum, row) => sum + row.sales, 0)),
    missingSkuRows
  };
}

export function buildProductAttributionAudit({
  feeInputs,
  refundInputs,
  advertisingCosts
}: {
  feeInputs: ProfitFeeInput[];
  refundInputs: ProfitRefundInput[];
  advertisingCosts: ProfitAdvertisingCostInput[];
}): ProductAttributionAudit {
  const diagnostics = buildProductAttributionDiagnostics({
    feeAdjustments: feeInputs,
    refundAdjustments: refundInputs,
    advertisingCosts
  });
  const totalConnect = roundMoney(
    advertisingCosts
      .filter((cost) => cost.source === WALMART_CONNECT_SOURCE)
      .reduce((sum, cost) => sum + cost.amount, 0)
  );

  return {
    refunds: {
      total: roundMoney(diagnostics.attributableRefunds + diagnostics.unallocatedRefunds),
      skuAttributable: diagnostics.attributableRefunds,
      unallocated: diagnostics.unallocatedRefunds
    },
    marketplaceCommission: {
      total: roundMoney(diagnostics.attributableCommission + diagnostics.unallocatedCommission),
      skuAttributable: diagnostics.attributableCommission,
      unallocated: diagnostics.unallocatedCommission
    },
    fulfillmentFees: {
      total: roundMoney(
        diagnostics.attributableFulfillmentFees + diagnostics.unallocatedFulfillmentFees
      ),
      skuAttributable: diagnostics.attributableFulfillmentFees,
      unallocated: diagnostics.unallocatedFulfillmentFees
    },
    walmartConnectAdvertising: {
      total: totalConnect,
      skuAttributable: diagnostics.attributableWalmartConnectAdvertising,
      unallocated: diagnostics.unallocatedWalmartConnectAdvertising
    },
    sellerCenterSem: {
      amount: diagnostics.sellerCenterSemAdvertising,
      note: "Marketplace-level only - campaign report contains no SKU/item attribution."
    },
    otherWalmartFeesAndAdjustments: {
      amount: diagnostics.marketplaceOnlyOtherWalmartFees,
      note: "Marketplace-level by default under the current product P&L rules."
    },
    diagnostics
  };
}

function buildReadinessReasons({
  poSales,
  settlements,
  cogs,
  sellerCenterSem,
  walmartConnect
}: {
  poSales: PoSalesAudit;
  settlements: SettlementAudit;
  cogs: CogsCoverageAudit;
  sellerCenterSem: AdvertisingCoverageAudit;
  walmartConnect: WalmartConnectCoverageAudit;
}) {
  const reasons: string[] = [];

  addCoverageReason(reasons, "PO Sales", poSales.status, poSales.statusReason);
  addCoverageReason(reasons, "Settlement", settlements.status, settlements.statusReason);
  addCoverageReason(reasons, "COGS", cogs.status, cogs.statusReason);
  addCoverageReason(reasons, "Seller Center SEM", sellerCenterSem.status, sellerCenterSem.statusReason);
  addCoverageReason(reasons, "Walmart Connect", walmartConnect.status, walmartConnect.statusReason);

  return reasons;
}

function addCoverageReason(
  reasons: string[],
  label: string,
  status: AuditStatus,
  detail: string
) {
  if (status === "Complete") {
    return;
  }

  reasons.push(`${label}: ${status} - ${detail}`);
}

function buildProfitLines(
  items: AuditOrderItem[],
  parentSkuBySellerSku: Map<string, string | null>
): ProfitLineInput[] {
  return items.map((item) => ({
    marketplace: item.marketplace,
    salesSource: "po_report",
    orderId: item.orderId,
    orderDate: item.order.orderDate,
    sellerSku: item.sellerSku,
    parentSku: item.parentSku ?? parentSkuBySellerSku.get(item.sellerSku) ?? undefined,
    quantity: item.quantity,
    itemRevenue: toNumber(item.itemRevenue),
    shippingRevenue: toNumber(item.shippingRevenue),
    discountAmount: toNumber(item.discountAmount),
    taxCollected: toNumber(item.taxCollected),
    cogsTotal: toNumber(item.cogsTotal),
    missingCogs: toNumber(item.cogsTotal) === 0 && item.quantity > 0
  }));
}

function mapFeeInput(
  fee: SettlementFeeRow,
  parentSkuBySellerSku: Map<string, string | null>
): ProfitFeeInput {
  return {
    marketplace: fee.marketplace,
    sellerSku: fee.sellerSku,
    parentSku: fee.sellerSku ? parentSkuBySellerSku.get(fee.sellerSku) ?? undefined : undefined,
    feeType: fee.feeType,
    amount: toNumber(fee.feeAmount),
    postedAt: fee.postedAt,
    metadata: toRecord(fee.metadata)
  };
}

function mapRefundInput(
  refund: SettlementRefundRow,
  parentSkuBySellerSku: Map<string, string | null>
): ProfitRefundInput {
  return {
    marketplace: refund.marketplace,
    sellerSku: refund.sellerSku,
    parentSku: refund.sellerSku
      ? parentSkuBySellerSku.get(refund.sellerSku) ?? undefined
      : undefined,
    amount: toNumber(refund.refundAmount),
    refundDate: refund.refundDate,
    metadata: toRecord(refund.metadata)
  };
}

function mapAdvertisingInput(cost: AdvertisingCostRow): ProfitAdvertisingCostInput {
  return {
    marketplace: cost.marketplace,
    sellerSku: cost.sellerSku,
    parentSku: cost.parentSku,
    source: cost.source,
    amount: toNumber(cost.amount),
    costDate: cost.costDate,
    metadata: toRecord(cost.metadata)
  };
}

function isSupportedPoAuditItem(item: AuditOrderItem) {
  return getSalesSourceFromAuditItem(item) === "po_report";
}

function isCancelledAuditItem(item: AuditOrderItem) {
  return getSalesSourceFromAuditItem(item) === "none" && item.quantity === 0;
}

function getSalesSourceFromAuditItem(item: AuditOrderItem) {
  return getPoSalesSourceFromOrderItem({
    orderStatus: item.order.status,
    poOrderStatus: getDirectPoOrderStatus(item),
    lineMetadata: []
  });
}

function isSettlementRefund(refund: SettlementRefundRow) {
  return readMetadataText(toRecord(refund.metadata), "source") === WALMART_SETTLEMENT_REPORT_TYPE;
}

function isActiveSettlementFee(fee: SettlementFeeRow) {
  const metadata = toRecord(fee.metadata);

  if (readMetadataText(metadata, "source") !== WALMART_SETTLEMENT_REPORT_TYPE) {
    return false;
  }

  return readMetadataText(metadata, "target") !== "ignored";
}

function getFulfillmentBucket(item: AuditOrderItem): "wfs" | "sellerFulfilled" | "unknown" {
  const fulfillmentType = (
    getDirectPoFulfillmentType(item) ??
    ""
  ).toLowerCase();

  if (fulfillmentType.includes("wfs")) {
    return "wfs";
  }

  if (
    fulfillmentType.includes("seller") ||
    fulfillmentType.includes("merchant") ||
    fulfillmentType.includes("partner")
  ) {
    return "sellerFulfilled";
  }

  return "unknown";
}

function getDirectPoOrderStatus(item: AuditOrderItem) {
  const value = (item as AuditOrderItem & { poOrderStatus?: unknown }).poOrderStatus;
  return typeof value === "string" ? value : null;
}

function getDirectPoFulfillmentType(item: AuditOrderItem) {
  const value = (item as AuditOrderItem & { poFulfillmentType?: unknown }).poFulfillmentType;
  return typeof value === "string" ? value : null;
}

function createFulfillmentCoverage(): FulfillmentCoverage {
  return {
    rows: 0,
    salesRows: 0,
    cancelledRows: 0,
    sales: 0,
    units: 0,
    orders: 0
  };
}

function getCoveredDatesFromSettlementPeriods(
  payouts: Array<{ settlementPeriodStart: Date | null; settlementPeriodEnd: Date | null }>
) {
  const dates = new Set<string>();

  for (const payout of payouts) {
    if (!payout.settlementPeriodStart || !payout.settlementPeriodEnd) {
      continue;
    }

    for (const date of getDateStringsInRange({
      from: startOfUtcDay(payout.settlementPeriodStart),
      to: endOfUtcDay(payout.settlementPeriodEnd)
    })) {
      dates.add(date);
    }
  }

  return Array.from(dates);
}

function getDailyAdCoverageReason(coverage: DateCoverage, label: string) {
  if (coverage.status === "Complete") {
    return `${label} has daily rows or confirmed zero-spend coverage for every date in the selected range.`;
  }

  if (coverage.status === "Partial") {
    return `${label} is missing daily coverage for ${coverage.missingDates.length} selected date(s).`;
  }

  return `No active daily ${label} rows were found for the selected range.`;
}

function getConfirmedZeroDates(rows: ProfitAdvertisingCostInput[]) {
  return uniqueStrings(
    rows
      .flatMap((row) => {
        const value = row.metadata?.confirmedZeroSpendDates;

        return Array.isArray(value) ? value : [];
      })
      .filter((value): value is string => typeof value === "string")
  );
}

function isDailyWalmartConnectCost(cost: ProfitAdvertisingCostInput) {
  const metadata = cost.metadata ?? {};

  return (
    metadata.grain === "daily" ||
    metadata.reportGrain === "daily" ||
    typeof metadata.date === "string" ||
    typeof metadata.reportDate === "string"
  );
}

function importRunOverlapsDateRange(summary: Prisma.JsonValue, dateRange: AuditDateRange) {
  const record = toRecord(summary);
  const earliest = parseDateString(readMetadataText(record, "earliestOrderDate"));
  const latest = parseDateString(readMetadataText(record, "latestOrderDate"));

  if (!earliest || !latest) {
    return false;
  }

  return earliest <= dateRange.to && latest >= dateRange.from;
}

function sumImportSummaryNumber(
  runs: Array<{ summary: Prisma.JsonValue }>,
  key: string
) {
  return runs.reduce((sum, run) => sum + readMetadataNumber(toRecord(run.summary), key), 0);
}

function getLatestImportDate(runs: Array<{ importedAt?: Date | null; createdAt: Date }>) {
  const latest = runs
    .map((run) => run.importedAt ?? run.createdAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return latest ? latest.toISOString() : null;
}

function normalizeDateRange(dateRange: AuditDateRange) {
  return {
    from: startOfUtcDay(dateRange.from),
    to: endOfUtcDay(dateRange.to)
  };
}

export function getDateStringsInRange(dateRange: AuditDateRange) {
  const dates: string[] = [];
  let cursor = startOfUtcDay(dateRange.from);
  const end = startOfUtcDay(dateRange.to);

  while (cursor <= end) {
    dates.push(formatDateKey(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
  }

  return dates;
}

function minDateString(dates: Date[]) {
  return dates.length
    ? formatDateKey(new Date(Math.min(...dates.map((date) => date.getTime()))))
    : null;
}

function maxDateString(dates: Date[]) {
  return dates.length
    ? formatDateKey(new Date(Math.max(...dates.map((date) => date.getTime()))))
    : null;
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function parseDateString(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateFallsInRange(date: Date | null | undefined, dateRange: AuditDateRange) {
  if (!date) {
    return false;
  }

  return date >= dateRange.from && date <= dateRange.to;
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }

  return Number(value ?? 0);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readMetadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
