import * as XLSX from "xlsx";

type AdvertisingColumn =
  | "costDate"
  | "sellerSku"
  | "parentSku"
  | "amount"
  | "campaignId"
  | "campaignName"
  | "currency";

export type ParsedAdvertisingCostRow = {
  costDate: Date;
  sellerSku?: string;
  parentSku?: string;
  amount: number;
  campaignId?: string;
  campaignName?: string;
  currency: string;
  sourceRow: number;
};

export type AdvertisingParseError = {
  row: number;
  code: string;
  message: string;
  rawData?: Record<string, unknown>;
};

export type ParsedAdvertisingWorkbook = {
  rows: ParsedAdvertisingCostRow[];
  errors: AdvertisingParseError[];
  rowCount: number;
};

const headerAliases: Record<AdvertisingColumn, string[]> = {
  costDate: ["date", "cost date", "spend date", "campaign date"],
  sellerSku: ["seller sku", "seller_sku", "sku", "item sku"],
  parentSku: ["parent sku", "parent_sku", "parent"],
  amount: ["amount", "spend", "ad spend", "sem spend", "cost"],
  campaignId: ["campaign id", "campaign_id"],
  campaignName: ["campaign", "campaign name", "campaign_name"],
  currency: ["currency", "currency code"]
};

export function parseAdvertisingWorkbook(buffer: Buffer): ParsedAdvertisingWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

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
  const aliases = normalizeAliases();
  const rows: ParsedAdvertisingCostRow[] = [];
  const errors: AdvertisingParseError[] = [];

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    const costDate = readDate(rawRow, aliases.costDate);
    const amount = readMoney(rawRow, aliases.amount);
    const sellerSku = readText(rawRow, aliases.sellerSku);
    const parentSku = readText(rawRow, aliases.parentSku);

    if (!costDate) {
      errors.push(rowError(sourceRow, "INVALID_COST_DATE", "Missing or invalid cost date.", rawRow));
      return;
    }

    if (amount === null) {
      errors.push(rowError(sourceRow, "INVALID_AMOUNT", "Missing or invalid ad spend amount.", rawRow));
      return;
    }

    if (!sellerSku && !parentSku) {
      errors.push(
        rowError(
          sourceRow,
          "MISSING_SKU",
          "Provide a seller SKU or parent SKU for attribution.",
          rawRow
        )
      );
      return;
    }

    rows.push({
      costDate,
      sellerSku: sellerSku || undefined,
      parentSku: parentSku || undefined,
      amount,
      campaignId: readText(rawRow, aliases.campaignId) || undefined,
      campaignName: readText(rawRow, aliases.campaignName) || undefined,
      currency: readText(rawRow, aliases.currency) || "USD",
      sourceRow
    });
  });

  return { rows, errors, rowCount: rawRows.length };
}

function normalizeAliases() {
  return (Object.keys(headerAliases) as AdvertisingColumn[]).reduce(
    (aliases, column) => {
      aliases[column] = headerAliases[column].map(normalizeHeader);
      return aliases;
    },
    {} as Record<AdvertisingColumn, string[]>
  );
}

function rowError(
  row: number,
  code: string,
  message: string,
  rawData: Record<string, unknown>
): AdvertisingParseError {
  return { row, code, message, rawData };
}

function readText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function readMoney(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);

  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readDate(row: Record<string, unknown>, aliases: string[]) {
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

function readAliasedValue(row: Record<string, unknown>, aliases: string[]) {
  const key = Object.keys(row).find((candidate) =>
    aliases.includes(normalizeHeader(candidate))
  );
  return key ? row[key] : null;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
