import * as XLSX from "xlsx";

type SalesColumn =
  | "externalOrderId"
  | "orderDate"
  | "sellerSku"
  | "parentSku"
  | "quantity"
  | "unitPrice"
  | "itemRevenue"
  | "shippingRevenue"
  | "taxCollected"
  | "discountAmount"
  | "feeType"
  | "feeAmount"
  | "refundAmount"
  | "refundDate"
  | "currency"
  | "status"
  | "externalLineId";

export type ParsedSalesRow = {
  externalOrderId: string;
  orderDate: Date;
  sellerSku: string;
  parentSku?: string;
  productName?: string;
  brand?: string;
  marketplaceItemId?: string;
  fulfillmentChannel?: string;
  quantity: number;
  unitPrice: number;
  itemRevenue: number;
  shippingRevenue: number;
  taxCollected: number;
  discountAmount: number;
  feeType?: string;
  feeAmount: number;
  refundAmount?: number;
  refundDate?: Date | null;
  currency: string;
  status?: string;
  externalLineId?: string;
  sourceRow: number;
  metadata?: Record<string, unknown>;
};

export type SalesParseError = {
  row: number;
  code: string;
  message: string;
  severity?: "error" | "warning";
  rawData?: Record<string, unknown>;
};

export type ParsedSalesWorkbook = {
  rows: ParsedSalesRow[];
  errors: SalesParseError[];
  rowCount: number;
};

export type SalesParseOptions = {
  reportMonth?: string;
  reportDate?: string;
  reportStartDate?: string;
  reportEndDate?: string;
};

const headerAliases: Record<SalesColumn, string[]> = {
  externalOrderId: ["order id", "order_id", "external order id", "purchase order id"],
  orderDate: ["order date", "order_date", "purchase date", "date"],
  sellerSku: ["seller sku", "seller_sku", "sku", "msku", "merchant sku"],
  parentSku: ["parent sku", "parent_sku", "parent", "style sku"],
  quantity: ["quantity", "qty", "units"],
  unitPrice: ["unit price", "unit_price", "price"],
  itemRevenue: ["item revenue", "item_revenue", "sales", "gross sales", "product sales"],
  shippingRevenue: ["shipping revenue", "shipping_revenue", "shipping"],
  taxCollected: ["tax collected", "tax_collected", "tax"],
  discountAmount: ["discount", "discount amount", "discount_amount", "promo discount"],
  feeType: ["fee type", "fee_type", "fee name"],
  feeAmount: ["fee amount", "fee_amount", "marketplace fee", "referral fee", "wfs fee"],
  refundAmount: ["refund", "refunds", "refund amount", "refund_amount", "refund sales"],
  refundDate: ["refund date", "refund_date", "return date"],
  currency: ["currency", "currency code"],
  status: ["status", "order status"],
  externalLineId: ["line id", "line_id", "order line id", "external line id"]
};

export function parseSalesWorkbook(buffer: Buffer): ParsedSalesWorkbook {
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
  const normalizedAliases = normalizeAliases();
  const rows: ParsedSalesRow[] = [];
  const errors: SalesParseError[] = [];

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    const externalOrderId = readText(rawRow, normalizedAliases.externalOrderId);
    const orderDate = readDate(rawRow, normalizedAliases.orderDate);
    const sellerSku = readText(rawRow, normalizedAliases.sellerSku);
    const quantity = readNumber(rawRow, normalizedAliases.quantity);
    const itemRevenue = readMoney(rawRow, normalizedAliases.itemRevenue);
    const unitPrice = readMoney(rawRow, normalizedAliases.unitPrice);
    const refundDateValue = readAliasedValue(rawRow, normalizedAliases.refundDate);
    const refundDate = readDate(rawRow, normalizedAliases.refundDate);

    if (!externalOrderId) {
      errors.push(rowError(sourceRow, "MISSING_ORDER_ID", "Missing order ID.", rawRow));
      return;
    }

    if (!orderDate) {
      errors.push(rowError(sourceRow, "INVALID_ORDER_DATE", "Missing or invalid order date.", rawRow));
      return;
    }

    if (!sellerSku) {
      errors.push(rowError(sourceRow, "MISSING_SELLER_SKU", "Missing seller SKU.", rawRow));
      return;
    }

    if (quantity === null || quantity <= 0) {
      errors.push(rowError(sourceRow, "INVALID_QUANTITY", "Missing or invalid quantity.", rawRow));
      return;
    }

    if (itemRevenue === null && unitPrice === null) {
      errors.push(
        rowError(
          sourceRow,
          "INVALID_REVENUE",
          "Provide item revenue or unit price.",
          rawRow
        )
      );
      return;
    }

    if (refundDateValue && !refundDate) {
      errors.push(rowError(sourceRow, "INVALID_REFUND_DATE", "Invalid refund date.", rawRow));
      return;
    }

    const refundAmount = readMoney(rawRow, normalizedAliases.refundAmount);

    rows.push({
      externalOrderId,
      orderDate,
      sellerSku,
      parentSku: readText(rawRow, normalizedAliases.parentSku) || undefined,
      quantity,
      unitPrice: unitPrice ?? (itemRevenue ?? 0) / quantity,
      itemRevenue: itemRevenue ?? (unitPrice ?? 0) * quantity,
      shippingRevenue: readMoney(rawRow, normalizedAliases.shippingRevenue) ?? 0,
      taxCollected: readMoney(rawRow, normalizedAliases.taxCollected) ?? 0,
      discountAmount: readMoney(rawRow, normalizedAliases.discountAmount) ?? 0,
      feeType: readText(rawRow, normalizedAliases.feeType) || undefined,
      feeAmount: readMoney(rawRow, normalizedAliases.feeAmount) ?? 0,
      refundAmount:
        refundAmount !== null && refundAmount !== 0 ? Math.abs(refundAmount) : undefined,
      refundDate: refundAmount !== null && refundAmount !== 0 ? refundDate ?? orderDate : undefined,
      currency: readText(rawRow, normalizedAliases.currency) || "USD",
      status: readText(rawRow, normalizedAliases.status) || undefined,
      externalLineId: readText(rawRow, normalizedAliases.externalLineId) || undefined,
      sourceRow
    });
  });

  return {
    rows,
    errors,
    rowCount: rawRows.length
  };
}

function normalizeAliases() {
  return (Object.keys(headerAliases) as SalesColumn[]).reduce(
    (aliases, column) => {
      aliases[column] = headerAliases[column].map(normalizeHeader);
      return aliases;
    },
    {} as Record<SalesColumn, string[]>
  );
}

function rowError(
  row: number,
  code: string,
  message: string,
  rawData: Record<string, unknown>
): SalesParseError {
  return { row, code, message, rawData };
}

function readText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function readNumber(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
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
