import { calculateProfitRows, summarizeProfit } from "./engine.ts";
import {
  businessDateKey,
  getInclusiveOverlapDays,
  isDateWithinInclusiveRange,
  normalizePnlDateRange
} from "./calendar-dates.ts";
import {
  filterProductAttributedAdvertisingCosts,
  buildProductAttributionDiagnostics
} from "./product-attribution.ts";
import {
  getSettlementCommissionDiagnostic,
  isSettlementDerivedCommissionFee,
  prepareSettlementDerivedCommissionForDateRange
} from "./settlement-commission-allocation.ts";
import { SettlementPeriodAllocator } from "./settlement-period-allocator.ts";
import type {
  PnlDateRange,
  PnlSalesSourceSummary,
  PnlSettlementAllocationSummary,
  ProductAttributionDiagnostics,
  ProfitAdvertisingCostInput,
  ProfitFeeInput,
  ProfitLineInput,
  ProfitRefundInput,
  ProfitRow
} from "./types.ts";

const SETTLEMENT_ALLOCATION_METADATA_KEY = "settlementAllocation";
const WALMART_CONNECT_AD_SOURCE = "walmart_connect_item_performance";
const SETTLEMENT_SEM_AD_SOURCE = "walmart_seller_center_sem";
const SETTLEMENT_SOURCE = "walmart_payments_new";

const allocator = new SettlementPeriodAllocator();

export type DailyPnlGroupBy = "sellerSku" | "parentSku";
export type SellerCenterSemMode = "include" | "summaryOnly" | "exclude";

export type DailyPnlQualityStatus =
  | "Complete"
  | "Missing daily ads"
  | "Settlement dates incomplete"
  | "Missing COGS"
  | "Missing PO sales";

export type DailyPnlDiagnostic = {
  sales: {
    orderRowsIncluded: number;
    orderDateStart: string | null;
    orderDateEnd: string | null;
    gmvIncluded: number;
    obsoleteSalesRowsIgnored: number;
  };
  cogs: {
    orderLinesCosted: number;
    missingCogsCount: number;
    totalCogs: number;
  };
  commission: SettlementDiagnosticSection;
  fulfillment: SettlementDiagnosticSection;
  sem: SettlementDiagnosticSection;
  walmartConnect: {
    dailyAdRowsIncluded: number;
    totalSpend: number;
    earliestAdDate: string | null;
    latestAdDate: string | null;
    monthlyRowsIgnored: number;
  };
};

export type SettlementDiagnosticSection = {
  settlementTransactionsIncluded: number;
  originalAmount: number;
  allocatedAmount: number;
  details: Array<{
    originalAmount: number;
    settlementStart: string | null;
    settlementEnd: string | null;
    overlapDays: number;
    allocatedAmount: number;
    fallback: boolean;
  }>;
};

export type DailyPnlResult = {
  rows: ProfitRow[];
  summary: ReturnType<typeof summarizeProfit>;
  salesSource: PnlSalesSourceSummary;
  settlementAllocation: PnlSettlementAllocationSummary;
  attributionDiagnostics: ProductAttributionDiagnostics;
  missingDataSources: DailyPnlQualityStatus[];
  sourceMetadata: {
    businessTimeZone: "UTC";
    sourceGrain: "daily";
    expectedDates: string[];
    importedDates: string[];
    missingDates: string[];
    coverageComplete: boolean;
    obsoleteSalesRowsIgnored: number;
    monthlyWalmartConnectRowsIgnored: number;
    postingDateFallbackCount: number;
    settlementRowsWithMissingPeriodDates: number;
  };
  diagnostic: DailyPnlDiagnostic;
  advertisingCosts: ProfitAdvertisingCostInput[];
  feeAdjustments: ProfitFeeInput[];
  refundAdjustments: ProfitRefundInput[];
  lines: ProfitLineInput[];
  suppressedDetailLines: ProfitLineInput[];
};

type DailySalesCoverage = {
  expectedDates: string[];
  importedDates: string[];
  missingDates: string[];
  coverageComplete: boolean;
};

export function calculateDailyPnl({
  lines,
  suppressedDetailLines = [],
  advertisingCosts = [],
  feeAdjustments = [],
  refundAdjustments = [],
  dateRange,
  groupBy,
  sellerCenterSemMode = "include"
}: {
  organizationId: string;
  marketplace: string;
  startDate?: Date;
  endDate?: Date;
  skuIds?: string[];
  parentIds?: string[];
  lines: ProfitLineInput[];
  suppressedDetailLines?: ProfitLineInput[];
  advertisingCosts?: ProfitAdvertisingCostInput[];
  feeAdjustments?: ProfitFeeInput[];
  refundAdjustments?: ProfitRefundInput[];
  dateRange: PnlDateRange;
  groupBy: DailyPnlGroupBy;
  sellerCenterSemMode?: SellerCenterSemMode;
}): DailyPnlResult {
  const normalizedRange = normalizePnlDateRange(dateRange);
  const dailyRange = normalizedRange ? { from: normalizedRange.from, to: normalizedRange.to } : dateRange;
  const dailyLines = lines.filter(
    (line) =>
      isSupportedDailySalesLine(line) &&
      Boolean(line.orderDate) &&
      isDateWithinInclusiveRange(line.orderDate, dailyRange)
  );
  const obsoleteSalesRowsIgnored = lines.filter(
    (line) =>
      !isSupportedDailySalesLine(line) &&
      Boolean(line.orderDate) &&
      isDateWithinInclusiveRange(line.orderDate, dailyRange)
  ).length;
  const coverage = buildDailySalesCoverage(dailyRange, dailyLines);
  const preparedFees = feeAdjustments
    .map((fee) => prepareDailyFee(fee, dailyRange))
    .filter((fee): fee is ProfitFeeInput => Boolean(fee));
  const preparedRefunds = refundAdjustments
    .map((refund) => prepareDailyRefund(refund, dailyRange))
    .filter((refund): refund is ProfitRefundInput => Boolean(refund));
  const adPreparation = prepareDailyAdvertisingCosts(advertisingCosts, dailyRange);
  const rowAdvertisingCosts = filterSellerCenterSemAdvertisingCosts(
    adPreparation.costs,
    sellerCenterSemMode === "exclude" || sellerCenterSemMode === "summaryOnly"
  );
  const summaryAdvertisingCosts = filterSellerCenterSemAdvertisingCosts(
    adPreparation.costs,
    sellerCenterSemMode === "exclude"
  );
  const rows = calculateProfitRows(
    dailyLines,
    groupBy,
    rowAdvertisingCosts,
    preparedFees,
    preparedRefunds
  );
  const summary =
    summaryAdvertisingCosts === rowAdvertisingCosts
      ? summarizeProfit(rows)
      : summarizeProfit(
          calculateProfitRows(
            dailyLines,
            groupBy,
            summaryAdvertisingCosts,
            preparedFees,
            preparedRefunds
          )
        );
  const settlementAllocation = summarizeSettlementAllocation([
    ...preparedFees,
    ...adPreparation.costs,
    ...preparedRefunds
  ]);
  const sourceMetadata = {
    businessTimeZone: "UTC" as const,
    sourceGrain: "daily" as const,
    expectedDates: coverage.expectedDates,
    importedDates: coverage.importedDates,
    missingDates: coverage.missingDates,
    coverageComplete: coverage.coverageComplete,
    obsoleteSalesRowsIgnored,
    monthlyWalmartConnectRowsIgnored: adPreparation.monthlyWalmartConnectRowsIgnored,
    postingDateFallbackCount: settlementAllocation.fallbackCount,
    settlementRowsWithMissingPeriodDates: settlementAllocation.missingPeriodMetadataCount
  };
  const attributionDiagnostics = buildProductAttributionDiagnostics({
    feeAdjustments: preparedFees,
    refundAdjustments: preparedRefunds,
    advertisingCosts: adPreparation.costs
  });
  const missingDataSources = buildMissingDataSources({
    summary,
    dailyLines,
    coverage,
    monthlyWalmartConnectRowsIgnored: adPreparation.monthlyWalmartConnectRowsIgnored,
    settlementAllocation
  });

  return {
    rows,
    summary,
    salesSource: buildDailySalesSourceSummary(dailyLines, suppressedDetailLines, obsoleteSalesRowsIgnored),
    settlementAllocation,
    missingDataSources,
    attributionDiagnostics,
    sourceMetadata,
    diagnostic: buildDiagnostic({
      lines: dailyLines,
      fees: preparedFees,
      ads: summaryAdvertisingCosts,
      obsoleteSalesRowsIgnored,
      monthlyWalmartConnectRowsIgnored: adPreparation.monthlyWalmartConnectRowsIgnored
    }),
    advertisingCosts: summaryAdvertisingCosts,
    feeAdjustments: preparedFees,
    refundAdjustments: preparedRefunds,
    lines: dailyLines,
    suppressedDetailLines
  };
}

function filterSellerCenterSemAdvertisingCosts(
  costs: ProfitAdvertisingCostInput[],
  shouldExclude: boolean
) {
  return shouldExclude ? filterProductAttributedAdvertisingCosts(costs) : costs;
}

export function isDailyCapableWalmartConnectCost(cost: ProfitAdvertisingCostInput) {
  if (cost.source !== WALMART_CONNECT_AD_SOURCE) {
    return true;
  }

  const metadata = cost.metadata ?? {};
  return (
    metadata.grain === "daily" ||
    metadata.reportGrain === "daily" ||
    typeof metadata.date === "string" ||
    typeof metadata.reportDate === "string"
  );
}

function buildDailySalesCoverage(
  dateRange: PnlDateRange,
  lines: ProfitLineInput[]
): DailySalesCoverage {
  const normalizedRange = normalizePnlDateRange(dateRange);

  if (!normalizedRange) {
    return {
      expectedDates: [],
      importedDates: [],
      missingDates: [],
      coverageComplete: false
    };
  }

  const expectedDates = getDateKeysInRange(normalizedRange.from, normalizedRange.to);
  const importedDateSet = new Set(
    lines.map((line) => businessDateKey(line.orderDate)).filter((date): date is string => Boolean(date))
  );
  const importedDates = expectedDates.filter((date) => importedDateSet.has(date));
  const missingDates = expectedDates.filter((date) => !importedDateSet.has(date));

  return {
    expectedDates,
    importedDates,
    missingDates,
    coverageComplete: missingDates.length === 0
  };
}

function getDateKeysInRange(from: Date, to: Date) {
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function prepareDailyFee(fee: ProfitFeeInput, dateRange: PnlDateRange) {
  if (isSettlementDerivedCommissionFee(fee)) {
    return prepareSettlementDerivedCommissionForDateRange(fee, dateRange).fee;
  }

  if (!isSettlementMetadata(fee.metadata)) {
    return isDateWithinInclusiveRange(fee.postedAt, dateRange) ? fee : null;
  }

  if (isSingleDaySettlementMetadata(fee.metadata)) {
    return isDateWithinInclusiveRange(fee.postedAt, dateRange) ? fee : null;
  }

  const allocation = allocator.allocateForRange(
    {
      amount: fee.amount,
      settlementPeriodStart: readMetadataText(fee.metadata, "periodStartDate"),
      settlementPeriodEnd: readMetadataText(fee.metadata, "periodEndDate"),
      postingDate: fee.postedAt
    },
    dateRange
  );

  if (allocation.amount === 0) {
    return null;
  }

  return {
    ...fee,
    amount: allocation.amount,
    metadata: withSettlementAllocationMetadata(fee.metadata, allocation)
  };
}

function prepareDailyRefund(refund: ProfitRefundInput, dateRange: PnlDateRange) {
  if (!isSettlementMetadata(refund.metadata)) {
    return isDateWithinInclusiveRange(refund.refundDate, dateRange) ? refund : null;
  }

  if (isTransactionPostedSettlementMetadata(refund.metadata)) {
    return isDateWithinInclusiveRange(refund.refundDate, dateRange) ? refund : null;
  }

  const allocation = allocator.allocateForRange(
    {
      amount: refund.amount,
      settlementPeriodStart: readMetadataText(refund.metadata, "periodStartDate"),
      settlementPeriodEnd: readMetadataText(refund.metadata, "periodEndDate"),
      postingDate: refund.refundDate
    },
    dateRange
  );

  if (allocation.amount === 0) {
    return null;
  }

  return {
    ...refund,
    amount: allocation.amount,
    metadata: withSettlementAllocationMetadata(refund.metadata, allocation)
  };
}

function prepareDailyAdvertisingCosts(costs: ProfitAdvertisingCostInput[], dateRange: PnlDateRange) {
  const preparedCosts: ProfitAdvertisingCostInput[] = [];
  let monthlyWalmartConnectRowsIgnored = 0;

  for (const cost of costs) {
    if (cost.source === WALMART_CONNECT_AD_SOURCE && !isDailyCapableWalmartConnectCost(cost)) {
      if (doesMonthlyCostOverlapRange(cost, dateRange)) {
        monthlyWalmartConnectRowsIgnored += 1;
      }
      continue;
    }

    const prepared = prepareDailyAdvertisingCost(cost, dateRange);
    if (prepared) {
      preparedCosts.push(prepared);
    }
  }

  return { costs: preparedCosts, monthlyWalmartConnectRowsIgnored };
}

function prepareDailyAdvertisingCost(cost: ProfitAdvertisingCostInput, dateRange: PnlDateRange) {
  return isDateWithinInclusiveRange(cost.costDate, dateRange) ? cost : null;
}

function buildDailySalesSourceSummary(
  lines: ProfitLineInput[],
  suppressedDetailLines: ProfitLineInput[],
  obsoleteSalesRowsIgnored: number
): PnlSalesSourceSummary {
  const suppressedDetailGmv = roundMoney(
    suppressedDetailLines.reduce(
      (sum, line) => sum + line.itemRevenue + (line.shippingRevenue ?? 0) - (line.discountAmount ?? 0),
      0
    )
  );
  const note =
    "P&L sales use Walmart PO reports for sales, units, orders, SKU, product, fulfillment type, and order date. Product P&L includes only financial rows that can be attributed directly to a SKU or parent.";
  const hasPoReport = lines.some((line) => line.salesSource === "po_report");

  return {
    kind: hasPoReport ? "po_report" : "none",
    label: hasPoReport ? "Sales source: Walmart PO reports" : "Sales source: No PO sales rows",
    note,
    summaryMonthCount: obsoleteSalesRowsIgnored,
    suppressedDetailRowCount: suppressedDetailLines.length,
    suppressedDetailGmv
  };
}

function buildMissingDataSources({
  summary,
  dailyLines,
  coverage,
  monthlyWalmartConnectRowsIgnored,
  settlementAllocation
}: {
  summary: ReturnType<typeof summarizeProfit>;
  dailyLines: ProfitLineInput[];
  coverage: DailySalesCoverage;
  monthlyWalmartConnectRowsIgnored: number;
  settlementAllocation: PnlSettlementAllocationSummary;
}) {
  const statuses: DailyPnlQualityStatus[] = [];

  if (!coverage.coverageComplete) {
    statuses.push("Missing PO sales");
  }

  if (monthlyWalmartConnectRowsIgnored > 0) {
    statuses.push("Missing daily ads");
  }

  if (settlementAllocation.missingPeriodMetadataCount > 0) {
    statuses.push("Settlement dates incomplete");
  }

  if (summary.missingCogsUnits > 0) {
    statuses.push("Missing COGS");
  }

  return statuses.length ? statuses : (["Complete"] satisfies DailyPnlQualityStatus[]);
}

function isSupportedDailySalesLine(line: ProfitLineInput) {
  return line.salesSource === "po_report";
}

function buildDiagnostic({
  lines,
  fees,
  ads,
  obsoleteSalesRowsIgnored,
  monthlyWalmartConnectRowsIgnored
}: {
  lines: ProfitLineInput[];
  fees: ProfitFeeInput[];
  ads: ProfitAdvertisingCostInput[];
  obsoleteSalesRowsIgnored: number;
  monthlyWalmartConnectRowsIgnored: number;
}): DailyPnlDiagnostic {
  const lineDates = lines.map((line) => line.orderDate).filter((date): date is Date => Boolean(date));
  const connectAds = ads.filter((cost) => cost.source === WALMART_CONNECT_AD_SOURCE);
  const semAds = ads.filter((cost) => cost.source === SETTLEMENT_SEM_AD_SOURCE);
  const connectDates = connectAds.map((cost) => cost.costDate).filter((date): date is Date => Boolean(date));

  return {
    sales: {
      orderRowsIncluded: lines.length,
      orderDateStart: minDateKey(lineDates),
      orderDateEnd: maxDateKey(lineDates),
      gmvIncluded: roundMoney(
        lines.reduce(
          (sum, line) => sum + line.itemRevenue + (line.shippingRevenue ?? 0) - (line.discountAmount ?? 0),
          0
        )
      ),
      obsoleteSalesRowsIgnored
    },
    cogs: {
      orderLinesCosted: lines.filter((line) => !line.missingCogs).length,
      missingCogsCount: lines.filter((line) => line.missingCogs).length,
      totalCogs: roundMoney(lines.reduce((sum, line) => sum + (line.cogsTotal ?? 0), 0))
    },
    commission: buildSettlementDiagnosticSection(fees.filter(isCommissionFee)),
    fulfillment: buildSettlementDiagnosticSection(fees.filter(isFulfillmentFee)),
    sem: buildSettlementDiagnosticSection(semAds),
    walmartConnect: {
      dailyAdRowsIncluded: connectAds.length,
      totalSpend: roundMoney(connectAds.reduce((sum, cost) => sum + cost.amount, 0)),
      earliestAdDate: minDateKey(connectDates),
      latestAdDate: maxDateKey(connectDates),
      monthlyRowsIgnored: monthlyWalmartConnectRowsIgnored
    }
  };
}

function buildSettlementDiagnosticSection(rows: Array<ProfitFeeInput | ProfitAdvertisingCostInput>): SettlementDiagnosticSection {
  const details = rows.map((row) => {
    const allocation = readAllocationMetadata(row.metadata);
    const commissionDiagnostic = "feeType" in row ? getSettlementCommissionDiagnostic(row) : null;
    const settlementStart =
      commissionDiagnostic?.settlementStart ?? readMetadataText(row.metadata, "periodStartDate");
    const settlementEnd =
      commissionDiagnostic?.settlementEnd ?? readMetadataText(row.metadata, "periodEndDate");

    return {
      originalAmount: readOriginalAmount(row),
      settlementStart,
      settlementEnd,
      overlapDays:
        allocation?.overlapDayCount ??
        getInclusiveOverlapDays(settlementStart, settlementEnd, undefined),
      allocatedAmount: row.amount,
      fallback: allocation?.fallback === true || commissionDiagnostic?.fallback === true
    };
  });

  return {
    settlementTransactionsIncluded: rows.length,
    originalAmount: roundMoney(details.reduce((sum, row) => sum + Math.abs(row.originalAmount), 0)),
    allocatedAmount: roundMoney(rows.reduce((sum, row) => sum + Math.abs(row.amount), 0)),
    details: details.slice(0, 25)
  };
}

function readOriginalAmount(row: ProfitFeeInput | ProfitAdvertisingCostInput) {
  const metadataAmount = readMetadataNumber(row.metadata, "originalAmount");
  return metadataAmount ?? row.amount;
}

function summarizeSettlementAllocation(rows: Array<{ metadata?: Record<string, unknown> }>) {
  return rows.reduce(
    (summary, row) => {
      const allocation = readAllocationMetadata(row.metadata);

      if (!allocation) {
        return summary;
      }

      if (allocation.applied === true) {
        summary.allocatedCount += 1;
      }

      if (allocation.fallback === true) {
        summary.fallbackCount += 1;
      }

      if (allocation.missingPeriodMetadata === true) {
        summary.missingPeriodMetadataCount += 1;
      }

      return summary;
    },
    {
      allocatedCount: 0,
      fallbackCount: 0,
      missingPeriodMetadataCount: 0
    }
  );
}

function readAllocationMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.[SETTLEMENT_ALLOCATION_METADATA_KEY];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as {
        applied?: boolean;
        fallback?: boolean;
        missingPeriodMetadata?: boolean;
        dayCount?: number;
        overlapDayCount?: number;
      })
    : null;
}

function withSettlementAllocationMetadata(
  metadata: Record<string, unknown> | undefined,
  allocation: {
    applied: boolean;
    fallback: boolean;
    missingPeriodMetadata: boolean;
    dayCount: number;
    overlapDayCount: number;
  }
) {
  return {
    ...(metadata ?? {}),
    [SETTLEMENT_ALLOCATION_METADATA_KEY]: {
      applied: allocation.applied,
      fallback: allocation.fallback,
      missingPeriodMetadata: allocation.missingPeriodMetadata,
      dayCount: allocation.dayCount,
      overlapDayCount: allocation.overlapDayCount
    }
  };
}

function isSettlementMetadata(metadata: Record<string, unknown> | undefined) {
  return readMetadataText(metadata, "source") === SETTLEMENT_SOURCE;
}

function isTransactionPostedSettlementMetadata(metadata: Record<string, unknown> | undefined) {
  return readMetadataText(metadata, "reportingDateSource") === "transaction_posted_timestamp";
}

function isSingleDaySettlementMetadata(metadata: Record<string, unknown> | undefined) {
  const reportingDateSource = readMetadataText(metadata, "reportingDateSource");
  return (
    reportingDateSource === "transaction_posted_timestamp" ||
    reportingDateSource === "settlement_period_end_unmatched_fee" ||
    reportingDateSource === "transaction_posted_timestamp_missing_period_end"
  );
}

function isCommissionFee(fee: ProfitFeeInput | ProfitAdvertisingCostInput): fee is ProfitFeeInput {
  return "feeType" in fee && fee.feeType.toLowerCase().includes("commission");
}

function isFulfillmentFee(fee: ProfitFeeInput | ProfitAdvertisingCostInput): fee is ProfitFeeInput {
  return "feeType" in fee && fee.feeType.toLowerCase().includes("fulfillment");
}

function doesMonthlyCostOverlapRange(cost: ProfitAdvertisingCostInput, dateRange: PnlDateRange) {
  const reportMonth = readMetadataText(cost.metadata, "reportMonth");

  if (!reportMonth || !/^\d{4}-\d{2}$/.test(reportMonth)) {
    return isDateWithinInclusiveRange(cost.costDate, dateRange);
  }

  return getInclusiveOverlapDays(`${reportMonth}-01`, getReportMonthEnd(reportMonth), dateRange) > 0;
}

function getReportMonthEnd(reportMonth: string) {
  const [yearText, monthText] = reportMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  return new Date(Date.UTC(year, month, 0));
}

function minDateKey(dates: Date[]) {
  if (!dates.length) {
    return null;
  }

  return businessDateKey(new Date(Math.min(...dates.map((date) => date.getTime()))));
}

function maxDateKey(dates: Date[]) {
  if (!dates.length) {
    return null;
  }

  return businessDateKey(new Date(Math.max(...dates.map((date) => date.getTime()))));
}

function readMetadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() || null : null;
}

function readMetadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
