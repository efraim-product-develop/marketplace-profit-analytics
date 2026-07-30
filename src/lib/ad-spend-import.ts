export const AD_SOURCE_CONNECT = "walmart_connect_item_performance";

export const adSpendReportTypes = [
  {
    value: AD_SOURCE_CONNECT,
    label: "Walmart Connect Item Performance"
  }
] as const;

export const adSpendReportMonths = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" }
] as const;

export type AdSpendReportType = (typeof adSpendReportTypes)[number]["value"];

export type AdSpendColumn =
  | "date"
  | "sku_id"
  | "item_id"
  | "item_name"
  | "campaign_name"
  | "campaign_type"
  | "ad_spend"
  | "clicks"
  | "impressions"
  | "orders"
  | "total_attributed_sales"
  | "units_sold"
  | "average_cpc"
  | "roas";

export type RawAdSpendImportRow = Partial<Record<AdSpendColumn, unknown>> & {
  rowNumber: number;
};

export type ValidatedAdSpendImportRow = {
  rowNumber: number;
  reportType: AdSpendReportType;
  reportMonth: string;
  reportDate: string;
  costDate: string;
  sku: string;
  itemId: string;
  itemName: string;
  campaignName: string;
  campaignType: string;
  spend: number;
  clicks: number;
  impressions: number;
  attributedOrders: number;
  attributedSales: number;
  attributedUnits: number;
  averageCpc: number;
  roas: number;
  currency: string;
  duplicateKey: string;
};

export type AdSpendRowValidationResult = {
  rowNumber: number;
  row?: ValidatedAdSpendImportRow;
  errors: string[];
  skipped?: boolean;
  skipReason?: string;
};

export type AdSpendReportPeriod = {
  date?: string;
  startDate?: string;
  endDate?: string;
  month: string;
  year: string;
};

type AdSpendReportConfig = {
  requiredColumns: AdSpendColumn[];
  columns: AdSpendColumn[];
  aliases: Record<AdSpendColumn, string[]>;
};

const sharedAliases: Record<AdSpendColumn, string[]> = {
  date: ["date", "report_date", "day", "performance_date"],
  sku_id: ["sku_id", "sku", "seller_sku", "item_sku", "partner_sku", "advertised_sku"],
  item_id: ["item_id", "itemid"],
  item_name: ["item_name"],
  campaign_name: ["campaign_name", "campaign"],
  campaign_type: ["campaign_type"],
  ad_spend: ["ad_spend", "spend", "sem_spend", "amount", "cost", "advertising_cost"],
  clicks: ["clicks"],
  impressions: ["impressions"],
  orders: ["orders", "attributed_orders"],
  total_attributed_sales: [
    "total_attributed_sales",
    "attributed_sales",
    "ad_sales",
    "advertising_sales",
    "sales"
  ],
  units_sold: ["units_sold", "attributed_units"],
  average_cpc: ["average_cpc", "cpc"],
  roas: ["roas"]
};

const reportConfigs: Record<AdSpendReportType, AdSpendReportConfig> = {
  [AD_SOURCE_CONNECT]: {
    requiredColumns: ["sku_id", "ad_spend"],
    columns: [
      "date",
      "sku_id",
      "item_id",
      "item_name",
      "campaign_name",
      "campaign_type",
      "ad_spend",
      "clicks",
      "impressions",
      "orders",
      "total_attributed_sales",
      "units_sold",
      "average_cpc",
      "roas"
    ],
    aliases: sharedAliases
  }
};

export function getAdSpendRequiredColumns(reportType: AdSpendReportType) {
  return reportConfigs[reportType].requiredColumns;
}

export function normalizeAdSpendHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function missingAdSpendColumns(headers: string[], reportType: AdSpendReportType) {
  const normalizedHeaders = new Set(headers.map(normalizeAdSpendHeader));
  const config = reportConfigs[reportType];

  return config.requiredColumns.filter((column) =>
    config.aliases[column].every((alias) => !normalizedHeaders.has(alias))
  );
}

export function normalizeRawAdSpendRow(
  row: Record<string, unknown>,
  rowNumber: number,
  reportType: AdSpendReportType
): RawAdSpendImportRow {
  const config = reportConfigs[reportType];
  const normalizedEntries = Object.entries(row).reduce<Record<string, unknown>>(
    (entries, [key, value]) => {
      entries[normalizeAdSpendHeader(key)] = value;
      return entries;
    },
    {}
  );

  return config.columns.reduce(
    (normalizedRow, column) => {
      normalizedRow[column] = readAliasedValue(normalizedEntries, config.aliases[column]) ?? "";
      return normalizedRow;
    },
    { rowNumber } as RawAdSpendImportRow
  );
}

export function validateAdSpendRows(
  rows: RawAdSpendImportRow[],
  reportPeriod: AdSpendReportPeriod,
  _reportType: AdSpendReportType
) {
  return validateConnectRows(rows, reportPeriod);
}

export function buildReportMonth({ date, startDate, month, year }: AdSpendReportPeriod) {
  const reportDate = parseDateOnly(date);
  if (reportDate) {
    return reportDate.slice(0, 7);
  }

  const reportStartDate = parseDateOnly(startDate);
  if (reportStartDate) {
    return reportStartDate.slice(0, 7);
  }

  if (!/^\d{4}$/.test(year) || !/^(0[1-9]|1[0-2])$/.test(month)) {
    return "";
  }

  return `${year}-${month}`;
}

function validateConnectRows(rows: RawAdSpendImportRow[], reportPeriod: AdSpendReportPeriod) {
  const selectedReportDate = parseDateOnly(reportPeriod.date);
  const selectedStartDate = parseDateOnly(reportPeriod.startDate);
  const selectedEndDate = parseDateOnly(reportPeriod.endDate);
  const hasSelectedRange = Boolean(selectedStartDate && selectedEndDate);
  const isSingleDaySelectedRange =
    hasSelectedRange && selectedStartDate === selectedEndDate;

  const validatedRows = rows.map((row) => {
    const common = readCommonFields(row);
    const errors = validateCommonOptionalNumbers(common);
    const rowReportDate = parseDateOnly(row.date);
    const reportDate =
      rowReportDate ||
      selectedReportDate ||
      (isSingleDaySelectedRange ? selectedStartDate : "");
    const reportMonth = reportDate ? reportDate.slice(0, 7) : buildReportMonth(reportPeriod);
    const costDate = reportDate ? `${reportDate}T00:00:00.000Z` : "";

    if (!reportDate) {
      errors.push(
        hasSelectedRange
          ? "Date is required in the file when the selected period covers more than one day."
          : "Choose a valid reporting period before previewing this advertising file."
      );
    }

    if (reportDate && hasSelectedRange && (reportDate < selectedStartDate || reportDate > selectedEndDate)) {
      return skippedRow(row.rowNumber, "Date is outside the selected reporting period.");
    }

    if (common.spend === null || common.spend === 0) {
      return skippedRow(row.rowNumber, "Ad Spend is blank or zero.");
    }

    const duplicateKey = buildConnectDuplicateKey({
      reportDate,
      sku: common.sku,
      campaignName: common.campaignName,
      itemId: common.itemId
    });

    if (errors.length || !reportDate) {
      return { rowNumber: row.rowNumber, errors };
    }

    return validRow(
      row.rowNumber,
      AD_SOURCE_CONNECT,
      reportMonth,
      reportDate,
      costDate,
      common,
      duplicateKey
    );
  }) satisfies AdSpendRowValidationResult[];

  return aggregateDuplicateValidRows(validatedRows, "Walmart Connect");
}

function readCommonFields(row: RawAdSpendImportRow) {
  return {
    sku: readText(row.sku_id),
    itemId: readText(row.item_id),
    itemName: readText(row.item_name),
    campaignName: readText(row.campaign_name),
    campaignType: readText(row.campaign_type),
    spend: parseMoney(row.ad_spend),
    clicks: parseOptionalInteger(row.clicks),
    impressions: parseOptionalInteger(row.impressions),
    attributedOrders: parseOptionalInteger(row.orders),
    attributedSales: parseOptionalMoney(row.total_attributed_sales),
    attributedUnits: parseOptionalInteger(row.units_sold),
    averageCpc: parseOptionalMoney(row.average_cpc),
    roas: parseOptionalDecimal(row.roas)
  };
}

function validateCommonOptionalNumbers(common: ReturnType<typeof readCommonFields>) {
  const errors: string[] = [];

  if (common.clicks === null) {
    errors.push("Clicks must be a valid whole number.");
  }

  if (common.impressions === null) {
    errors.push("Impressions must be a valid whole number.");
  }

  if (common.attributedOrders === null) {
    errors.push("Orders must be a valid whole number.");
  }

  if (common.attributedSales === null) {
    errors.push("Total Attributed Sales must be a valid number.");
  }

  if (common.attributedUnits === null) {
    errors.push("Units Sold must be a valid whole number.");
  }

  if (common.averageCpc === null) {
    errors.push("Average CPC must be a valid number.");
  }

  if (common.roas === null) {
    errors.push("ROAS must be a valid number.");
  }

  return errors;
}

function validRow(
  rowNumber: number,
  reportType: AdSpendReportType,
  reportMonth: string,
  reportDate: string,
  costDate: string,
  common: ReturnType<typeof readCommonFields>,
  duplicateKey: string
): AdSpendRowValidationResult {
  return {
    rowNumber,
    errors: [],
    row: {
      rowNumber,
      reportType,
      reportMonth,
      reportDate,
      costDate,
      sku: common.sku,
      itemId: common.itemId,
      itemName: common.itemName,
      campaignName: common.campaignName,
      campaignType: common.campaignType,
      spend: common.spend ?? 0,
      clicks: common.clicks ?? 0,
      impressions: common.impressions ?? 0,
      attributedOrders: common.attributedOrders ?? 0,
      attributedSales: common.attributedSales ?? 0,
      attributedUnits: common.attributedUnits ?? 0,
      averageCpc: common.averageCpc ?? 0,
      roas: common.roas ?? 0,
      currency: "USD",
      duplicateKey
    }
  };
}

function skippedRow(rowNumber: number, skipReason: string): AdSpendRowValidationResult {
  return {
    rowNumber,
    errors: [],
    skipped: true,
    skipReason
  };
}

export function buildConnectDuplicateKey({
  reportDate,
  sku,
  campaignName,
  itemId
}: {
  reportDate: string;
  sku: string;
  campaignName: string;
  itemId: string;
}) {
  return [reportDate, sku, campaignName, itemId]
    .map((value) => value.trim().toLowerCase())
    .join("::");
}

function parseDateOnly(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 86_400_000).toISOString().slice(0, 10);
  }

  const text = readText(value);

  if (!text) {
    return "";
  }

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }

  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function readAliasedValue(row: Record<string, unknown>, aliasesToTry: string[]) {
  const alias = aliasesToTry.find((candidate) => candidate in row);
  return alias ? row[alias] : undefined;
}

function readText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseMoney(value: unknown) {
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

function parseOptionalMoney(value: unknown) {
  const text = readText(value);

  if (!text) {
    return 0;
  }

  return parseMoney(value);
}

function parseOptionalInteger(value: unknown) {
  const text = readText(value);

  if (!text) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[,\s]/g, ""));

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseOptionalDecimal(value: unknown) {
  const text = readText(value);

  if (!text) {
    return 0;
  }

  const parsed = Number(text.replace(/[,\s%]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregateDuplicateValidRows(
  rows: AdSpendRowValidationResult[],
  label: string
): AdSpendRowValidationResult[] {
  const outputRows: AdSpendRowValidationResult[] = [];
  const outputIndexByKey = new Map<string, number>();

  for (const result of rows) {
    if (!result.row) {
      outputRows.push(result);
      continue;
    }

    const existingIndex = outputIndexByKey.get(result.row.duplicateKey);

    if (existingIndex === undefined) {
      outputIndexByKey.set(result.row.duplicateKey, outputRows.length);
      outputRows.push(result);
      continue;
    }

    const existingResult = outputRows[existingIndex];

    if (existingResult.row) {
      existingResult.row = mergeAdSpendRows(existingResult.row, result.row);
    }

    outputRows.push(
      skippedRow(
        result.rowNumber,
        `Combined with row ${existingResult.rowNumber} for the same ${label} key.`
      )
    );
  }

  return outputRows;
}

function mergeAdSpendRows(
  first: ValidatedAdSpendImportRow,
  next: ValidatedAdSpendImportRow
): ValidatedAdSpendImportRow {
  const spend = first.spend + next.spend;
  const clicks = first.clicks + next.clicks;
  const impressions = first.impressions + next.impressions;
  const attributedOrders = first.attributedOrders + next.attributedOrders;
  const attributedSales = first.attributedSales + next.attributedSales;
  const attributedUnits = first.attributedUnits + next.attributedUnits;

  return {
    ...first,
    itemId: first.itemId || next.itemId,
    itemName: first.itemName || next.itemName,
    campaignName: first.campaignName || next.campaignName,
    campaignType: first.campaignType || next.campaignType,
    spend,
    clicks,
    impressions,
    attributedOrders,
    attributedSales,
    attributedUnits,
    averageCpc: clicks > 0 ? spend / clicks : first.averageCpc || next.averageCpc,
    roas: spend > 0 ? attributedSales / spend : first.roas || next.roas
  };
}
