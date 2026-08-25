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
    "Gross Sales",
    "Refunds",
    "Sales",
    "Marketplace Commission",
    "Fulfillment Fees",
    "COGS",
    "Missing COGS Units",
    "Walmart Connect Advertising",
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
    row.grossRevenue,
    row.salesRefunds,
    row.netRevenue,
    row.commissionFees,
    row.fulfillmentFees,
    row.cogs,
    row.missingCogsUnits,
    row.walmartConnectAdvertisingCost,
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
  if (source === "po_report") {
    return "PO Reports";
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

  return "Using Walmart PO reports for sales. Product P&L includes only attributable settlement refunds, commission, fulfillment fees, COGS, and SKU-attributed Walmart Connect ads.";
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
    row.grossRevenue,
    row.salesRefunds,
    row.netRevenue,
    row.commissionFees,
    row.fulfillmentFees,
    row.cogs,
    row.missingCogsUnits,
    row.walmartConnectAdvertisingCost,
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
