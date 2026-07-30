import * as XLSX from "xlsx";

export type CogsColumn =
  | "marketplace"
  | "sellerSku"
  | "parentSku"
  | "unitCost"
  | "currency"
  | "effectiveDate";

export type CogsParseOptions = {
  marketplace?: string;
  worksheetName?: string;
  headerAliases?: Partial<Record<CogsColumn, string[]>>;
};

export type ParsedCogsRow = {
  marketplace?: string;
  sellerSku: string;
  parentSku?: string;
  unitCost: number;
  currency: string;
  effectiveDate: Date;
  sourceRow: number;
};

export type CogsParseError = {
  row: number;
  code: string;
  message: string;
  rawData?: Record<string, unknown>;
};

export type ParsedCogsWorkbook = {
  rows: ParsedCogsRow[];
  errors: CogsParseError[];
  rowCount: number;
};

const defaultHeaderAliases: Record<CogsColumn, string[]> = {
  marketplace: ["marketplace", "channel", "source marketplace"],
  sellerSku: ["seller sku", "seller_sku", "sku", "msku", "merchant sku"],
  parentSku: ["parent sku", "parent_sku", "parent", "style sku"],
  unitCost: ["unit cost", "cogs", "cost", "item cost", "landed cost"],
  currency: ["currency", "currency code"],
  effectiveDate: ["effective date", "effective_date", "cost date", "date"]
};

export function parseGenericCogsWorkbook(
  buffer: Buffer,
  options: CogsParseOptions = {}
): ParsedCogsWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = options.worksheetName ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          code: "WORKSHEET_NOT_FOUND",
          message: `Worksheet "${sheetName}" was not found.`
        }
      ],
      rowCount: 0
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null
  });
  const aliases = mergeAliases(options.headerAliases);
  const rows: ParsedCogsRow[] = [];
  const errors: CogsParseError[] = [];

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    const sellerSku = readText(rawRow, aliases.sellerSku);
    const unitCost = readMoney(rawRow, aliases.unitCost);
    const effectiveDate = readDate(rawRow, aliases.effectiveDate);

    if (!sellerSku) {
      errors.push({
        row: sourceRow,
        code: "MISSING_SELLER_SKU",
        message: "Missing seller SKU.",
        rawData: rawRow
      });
      return;
    }

    if (unitCost === null) {
      errors.push({
        row: sourceRow,
        code: "INVALID_UNIT_COST",
        message: "Missing or invalid unit cost.",
        rawData: rawRow
      });
      return;
    }

    if (!effectiveDate) {
      errors.push({
        row: sourceRow,
        code: "INVALID_EFFECTIVE_DATE",
        message: "Missing or invalid effective date.",
        rawData: rawRow
      });
      return;
    }

    rows.push({
      marketplace: options.marketplace ?? readText(rawRow, aliases.marketplace),
      sellerSku,
      parentSku: readText(rawRow, aliases.parentSku) || undefined,
      unitCost,
      currency: readText(rawRow, aliases.currency) || "USD",
      effectiveDate,
      sourceRow
    });
  });

  return {
    rows,
    errors,
    rowCount: rawRows.length
  };
}

function mergeAliases(overrides: CogsParseOptions["headerAliases"] = {}) {
  return (Object.keys(defaultHeaderAliases) as CogsColumn[]).reduce(
    (merged, column) => {
      merged[column] = [...(overrides[column] ?? []), ...defaultHeaderAliases[column]].map(
        normalizeHeader
      );
      return merged;
    },
    {} as Record<CogsColumn, string[]>
  );
}

function readText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
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
    return parsed
      ? new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d))
      : null;
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
