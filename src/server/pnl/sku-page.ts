import {
  dateInputRangeToPnlDateRange,
  formatDateInput,
  getRollingPeriodDateRange,
  parseDateInput,
  parsePnlComparisonPeriod,
  type RollingPnlComparisonPeriod
} from "./periods.ts";
import type { PnlComparisonPeriod, ProfitRow, SkuPnlFilters } from "./types.ts";

export type SkuPnlSearchParams = {
  from?: string | string[];
  to?: string | string[];
  period?: string | string[];
  parent?: string | string[];
  brand?: string | string[];
  department?: string | string[];
  sku?: string | string[];
};

export type SkuPnlFormValues = {
  from: string;
  to: string;
  period: PnlComparisonPeriod;
  parent: string;
  brand: string;
  department: string;
};

export function parseSkuPnlSearchParams(
  searchParams?: SkuPnlSearchParams,
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
  const formValues: SkuPnlFormValues = {
    from,
    to,
    period,
    parent: parseTextValue(getSearchValue(searchParams?.parent)),
    brand: parseTextValue(getSearchValue(searchParams?.brand)),
    department: parseTextValue(getSearchValue(searchParams?.department))
  };
  const selectedSku = parseTextValue(getSearchValue(searchParams?.sku));
  const filters: SkuPnlFilters = {
    ...(from || to
      ? {
          dateRange: dateInputRangeToPnlDateRange(from, to)
        }
      : {}),
    ...(formValues.parent ? { parentSku: formValues.parent } : {}),
    ...(formValues.brand ? { brand: formValues.brand } : {}),
    ...(formValues.department ? { department: formValues.department } : {})
  };

  return {
    filters,
    formValues,
    selectedSku
  };
}

export function buildSkuPnlQueryString(
  values: SkuPnlFormValues,
  overrides: Partial<SkuPnlFormValues & { sku: string }> = {}
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

export function buildSkuPnlCsv(rows: ProfitRow[]) {
  const headers = [
    "Seller SKU",
    "Parent SKU",
    "Marketplace",
    "Brand",
    "Department",
    "Source",
    "Units",
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
  const body = rows.map((row) => [
    row.sellerSku ?? "",
    row.parentSku ?? "",
    row.marketplace,
    row.brand ?? "",
    row.department ?? "",
    getSkuPnlSourceLabel(row.salesSource),
    row.quantity,
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

  return [headers, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function getSkuPnlSourceLabel(source?: string) {
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

function getSearchValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseTextValue(value?: string) {
  return value?.trim().slice(0, 160) ?? "";
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
