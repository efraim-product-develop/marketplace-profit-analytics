export const requiredCogsColumns = ["sku", "effective_date", "unit_cogs"] as const;

export const optionalCogsColumns = [
  "parent_sku",
  "product_name",
  "variation_name",
  "shipment_id",
  "inbound_freight_per_unit",
  "prep_cost_per_unit",
  "packaging_cost_per_unit",
  "notes"
] as const;

export type RequiredCogsColumn = (typeof requiredCogsColumns)[number];
export type OptionalCogsColumn = (typeof optionalCogsColumns)[number];
export type CogsColumn = RequiredCogsColumn | OptionalCogsColumn;

export type RawCogsImportRow = Partial<Record<CogsColumn, unknown>> & {
  rowNumber: number;
};

export type ValidatedCogsImportRow = {
  rowNumber: number;
  sku: string;
  parentSku: string;
  productName: string;
  variationName: string;
  shipmentId: string;
  effectiveDate: string;
  unitCogs: number;
  inboundFreightPerUnit: number;
  prepCostPerUnit: number;
  packagingCostPerUnit: number;
  unitCost: number;
  notes: string;
};

export type CogsRowValidationResult = {
  rowNumber: number;
  row?: ValidatedCogsImportRow;
  errors: string[];
};

const allCogsColumns = [...requiredCogsColumns, ...optionalCogsColumns] as const;
const optionalMoneyFields: Array<OptionalCogsColumn> = [
  "inbound_freight_per_unit",
  "prep_cost_per_unit",
  "packaging_cost_per_unit"
];

export function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function missingCogsColumns(headers: string[]) {
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  return requiredCogsColumns.filter((column) => !normalizedHeaders.has(column));
}

export function normalizeRawCogsRow(
  row: Record<string, unknown>,
  rowNumber: number
): RawCogsImportRow {
  const normalizedEntries = Object.entries(row).reduce<Record<string, unknown>>(
    (entries, [key, value]) => {
      entries[normalizeHeader(key)] = value;
      return entries;
    },
    {}
  );

  return allCogsColumns.reduce(
    (normalizedRow, column) => {
      normalizedRow[column] = normalizedEntries[column] ?? "";
      return normalizedRow;
    },
    { rowNumber } as RawCogsImportRow
  );
}

export function validateCogsRows(rows: RawCogsImportRow[]) {
  const seenKeys = new Map<string, number>();

  return rows.map((row) => {
    const errors: string[] = [];

    if (!readText(row.sku)) {
      errors.push("sku is required.");
    }

    const effectiveDate = parseDate(row.effective_date);
    if (!effectiveDate) {
      errors.push("effective_date must be a valid date.");
    }

    const unitCogs = parseMoney(row.unit_cogs);
    if (unitCogs === null) {
      errors.push("unit_cogs must be a valid number.");
    }

    const optionalMoney = optionalMoneyFields.reduce<Record<string, number | null>>(
      (values, field) => {
        values[field] = parseOptionalMoney(row[field]);
        if (values[field] === null) {
          errors.push(`${field} must be a valid number.`);
        }
        return values;
      },
      {}
    );

    const key = [readText(row.sku), effectiveDate ?? readText(row.effective_date)]
      .map((value) => value.toLowerCase())
      .join("::");

    if (seenKeys.has(key)) {
      errors.push(
        `Duplicate row for sku + effective_date. First seen on row ${seenKeys.get(key)}.`
      );
    } else {
      seenKeys.set(key, row.rowNumber);
    }

    if (errors.length || !effectiveDate) {
      return { rowNumber: row.rowNumber, errors };
    }

    const sku = readText(row.sku);
    const parentSku = readText(row.parent_sku);
    const productName = readText(row.product_name);
    const variationName = readText(row.variation_name) || productName;
    const effectiveDateKey = effectiveDate.slice(0, 10);
    const shipmentId = readText(row.shipment_id) || `manual-cogs-${effectiveDateKey}`;
    const inboundFreightPerUnit = optionalMoney.inbound_freight_per_unit ?? 0;
    const prepCostPerUnit = optionalMoney.prep_cost_per_unit ?? 0;
    const packagingCostPerUnit = optionalMoney.packaging_cost_per_unit ?? 0;

    return {
      rowNumber: row.rowNumber,
      errors,
      row: {
        rowNumber: row.rowNumber,
        sku,
        parentSku,
        productName,
        variationName,
        shipmentId,
        effectiveDate,
        unitCogs: unitCogs ?? 0,
        inboundFreightPerUnit,
        prepCostPerUnit,
        packagingCostPerUnit,
        unitCost: (unitCogs ?? 0) + inboundFreightPerUnit + prepCostPerUnit + packagingCostPerUnit,
        notes: readText(row.notes)
      }
    };
  }) satisfies CogsRowValidationResult[];
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

  const parsed = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalMoney(value: unknown) {
  const text = readText(value);

  if (!text) {
    return 0;
  }

  return parseMoney(value);
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const date = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = readText(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
