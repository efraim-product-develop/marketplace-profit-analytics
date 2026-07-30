import type {
  ParentPnlMonthlyComparisonRow,
  PnlComparisonPeriod,
  PnlSalesSourceSummary,
  ProfitRow
} from "./types.ts";
import {
  dateInputRangeToPnlDateRange,
  formatDateInput,
  getRollingPeriodDateRange,
  parseDateInput,
  parsePnlComparisonPeriod,
  type RollingPnlComparisonPeriod
} from "./periods.ts";

export type ParentPnlSearchParams = {
  from?: string | string[];
  to?: string | string[];
  period?: string | string[];
  parent?: string | string[];
  sku?: string | string[];
};

export type ParentPnlFormValues = {
  from: string;
  to: string;
  period: PnlComparisonPeriod;
  parent: string;
};

export function parseParentPnlSearchParams(
  searchParams?: ParentPnlSearchParams,
  referenceDate = new Date()
) {
  const requestedFrom = parseDateInput(getSearchValue(searchParams?.from));
  const requestedTo = parseDateInput(getSearchValue(searchParams?.to));
  const period = parsePnlComparisonPeriod(getSearchValue(searchParams?.period));
  const rollingRange =
    period === "custom"
      ? null
      : getRollingPeriodDateRange(period as RollingPnlComparisonPeriod, referenceDate);
  const from = rollingRange ? formatDateInput(rollingRange.from) : requestedFrom;
  const to = rollingRange ? formatDateInput(rollingRange.to) : requestedTo;
  const formValues: ParentPnlFormValues = {
    from,
    to,
    period,
    parent: parseTextValue(getSearchValue(searchParams?.parent))
  };
  const dateRange = dateInputRangeToPnlDateRange(from, to);

  return {
    filters: {
      ...(from || to ? { dateRange } : {}),
      comparisonPeriod: formValues.period,
      ...(formValues.parent ? { parentSku: formValues.parent } : {})
    },
    formValues,
    selectedSku: parseTextValue(getSearchValue(searchParams?.sku))
  };
}

export function buildParentPnlQueryString(
  values: ParentPnlFormValues,
  overrides: Partial<ParentPnlFormValues & { sku: string }> = {}
) {
  const params = new URLSearchParams();
  const merged = { ...values, ...overrides };

  for (const [key, value] of Object.entries(merged)) {
    if (value) {
      params.set(key, value);
    }
  }

  return params.toString();
}

export function buildParentPnlCsv(
  rows: ProfitRow[],
  skuRows: ProfitRow[],
  monthlyRows: ParentPnlMonthlyComparisonRow[]
) {
  const headers = [
    "Section",
    "Period",
    "Date Range",
    "Parent SKU",
    "Seller SKU",
    "Marketplace",
    "Source",
    "Units",
    "Orders",
    "Net Revenue",
    "Refund Sales",
    "Refund Adjustments",
    "Marketplace Commission",
    "Fulfillment Fees",
    "COGS",
    "Missing COGS Units",
    "Walmart Connect Advertising",
    "SEM Advertising",
    "Total Advertising",
    "Profit",
    "Profit Margin %",
    "Profit / Unit"
  ];
  const monthlyBody = monthlyRows.map((row) => [
    "Period comparison",
    row.label,
    row.dateLabel,
    "",
    "",
    "",
    getParentPnlSourceLabel(row.salesSource.kind),
    row.units,
    row.orderCount,
    row.netRevenue,
    row.salesRefunds,
    row.refunds,
    row.commissionFees,
    row.fulfillmentFees,
    row.cogs,
    row.missingCogsUnits,
    row.walmartConnectAdvertisingCost,
    row.semAdvertisingCost,
    row.advertisingCost,
    row.netProfit,
    row.netMarginPercent,
    row.profitPerUnit
  ]);
  const parentBody = rows.map((row) => profitRowCsvValues("Parent rollup", row, ""));
  const skuBody = skuRows.map((row) => profitRowCsvValues("SKU detail", row, ""));

  return [headers, ...monthlyBody, ...parentBody, ...skuBody]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

export function getParentPnlSourceLabel(source?: string) {
  if (source === "item_sales_daily_summary") {
    return "Item Sales";
  }

  if (source === "item_sales_monthly_summary") {
    return "Legacy Item Sales";
  }

  if (source === "po_order_detail") {
    return "PO Audit";
  }

  if (source === "mixed") {
    return "Mixed";
  }

  return "No Sales";
}

export function getParentPnlReconciliationLabel(
  salesSource: PnlSalesSourceSummary,
  missingCogsUnits = 0
) {
  if (missingCogsUnits > 0) {
    return `Needs COGS review on ${missingCogsUnits.toLocaleString("en-US")} units.`;
  }

  if (salesSource.kind === "none") {
    return "No sales rows in this period yet.";
  }

  return "Using daily Walmart Item Sales as the sales source.";
}

function profitRowCsvValues(section: string, row: ProfitRow, period: string) {
  return [
    section,
    period,
    "",
    row.parentSku ?? "",
    row.sellerSku ?? "",
    row.marketplace,
    getParentPnlSourceLabel(row.salesSource),
    row.quantity,
    "",
    row.netRevenue,
    row.salesRefunds,
    row.refunds,
    row.commissionFees,
    row.fulfillmentFees,
    row.cogs,
    row.missingCogsUnits,
    row.walmartConnectAdvertisingCost,
    row.semAdvertisingCost,
    row.advertisingCost,
    row.netProfit,
    row.netMarginPercent,
    row.profitPerUnit
  ];
}

function getSearchValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseTextValue(value?: string) {
  return value?.trim().slice(0, 160) ?? "";
}

function formatMoneyForLabel(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
