import * as XLSX from "xlsx";
import type {
  ParsedSalesUploadRow,
  ParsedSalesUploadWorkbook,
  SalesUploadFee,
  SalesUploadIssue
} from "@/server/sales/upload-types";

type SalesUploadColumn =
  | "externalOrderId"
  | "externalOrderLineId"
  | "orderDate"
  | "sku"
  | "parentSku"
  | "productName"
  | "brand"
  | "marketplaceItemId"
  | "quantity"
  | "itemPrice"
  | "grossSales"
  | "shippingRevenue"
  | "taxCollected"
  | "discountAmount"
  | "orderStatus"
  | "currency"
  | "marketplaceFee"
  | "fulfillmentFee"
  | "shippingFee"
  | "storageFee"
  | "returnFee"
  | "adjustmentAmount"
  | "refundAmount"
  | "refundDate";

export type SalesUploadParseOptions = {
  marketplace: string;
  preferredSheetNames?: string[];
  headerAliases?: Partial<Record<SalesUploadColumn, string[]>>;
  skipStatusPattern?: RegExp;
};

const defaultHeaderAliases: Record<SalesUploadColumn, string[]> = {
  externalOrderId: [
    "order id",
    "order_id",
    "external order id",
    "purchase order id",
    "purchase order",
    "po number",
    "order number",
    "customer order id"
  ],
  externalOrderLineId: [
    "line id",
    "line_id",
    "line number",
    "order line id",
    "external line id"
  ],
  orderDate: ["order date", "order_date", "purchase date", "date", "created date"],
  sku: ["sku", "seller sku", "seller_sku", "partner sku", "item sku", "msku", "merchant sku"],
  parentSku: ["parent sku", "parent_sku", "parent", "style sku", "base item id"],
  productName: ["item name", "product name", "item description", "description", "title"],
  brand: ["brand"],
  marketplaceItemId: ["item id", "item_id", "marketplace item id", "product id", "upc"],
  quantity: ["quantity", "qty", "units", "units sold"],
  itemPrice: ["item price", "unit price", "unit_price", "price", "average selling price", "aur"],
  grossSales: [
    "gross sales",
    "gross_sales",
    "item revenue",
    "item_revenue",
    "sales",
    "product sales",
    "item total",
    "item cost",
    "gmv"
  ],
  shippingRevenue: ["shipping revenue", "shipping_revenue", "shipping", "shipping cost"],
  taxCollected: ["tax collected", "tax_collected", "tax", "sales tax"],
  discountAmount: ["discount", "discount amount", "discount_amount", "promo discount"],
  orderStatus: ["status", "order status", "order_status"],
  currency: ["currency", "currency code"],
  marketplaceFee: [
    "marketplace fee",
    "marketplace_fee",
    "referral fee",
    "commission",
    "commission fee"
  ],
  fulfillmentFee: ["fulfillment fee", "fulfillment_fee", "wfs fee", "fba fee"],
  shippingFee: ["shipping fee", "shipping_fee", "carrier fee"],
  storageFee: ["storage fee", "storage_fee", "warehouse fee"],
  returnFee: ["return fee", "return_fee", "refund fee"],
  adjustmentAmount: ["adjustment", "adjustment amount", "adjustment_amount"],
  refundAmount: ["refund amount", "refund_amount", "refund", "refund sales"],
  refundDate: ["refund date", "refund_date", "return date"]
};

export function parseSalesUploadWorkbook(
  buffer: Buffer,
  options: SalesUploadParseOptions
): ParsedSalesUploadWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = getSheetName(workbook, options.preferredSheetNames);
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

  if (!sheet) {
    return buildSalesUploadWorkbook([], [
      {
        row: 0,
        code: "WORKSHEET_NOT_FOUND",
        message: "The workbook did not contain a worksheet.",
        severity: "error"
      }
    ], 0);
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null
  });
  const aliases = normalizeAliases(options.headerAliases);
  const rows: ParsedSalesUploadRow[] = [];
  const issues: SalesUploadIssue[] = [];
  const seenNaturalKeys = new Set<string>();

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;

    if (isBlankRow(rawRow)) {
      issues.push(rowIssue(sourceRow, "BLANK_ROW", "Skipped blank row.", rawRow, "warning"));
      return;
    }

    const externalOrderId = readText(rawRow, aliases.externalOrderId);
    const externalOrderLineId = readText(rawRow, aliases.externalOrderLineId);
    const orderDate = readDate(rawRow, aliases.orderDate);
    const sku = readText(rawRow, aliases.sku);
    const quantity = readNumberValue(rawRow, aliases.quantity);
    const itemPrice = readMoneyValue(rawRow, aliases.itemPrice);
    const grossSales = readMoneyValue(rawRow, aliases.grossSales);
    const currency = readText(rawRow, aliases.currency) || "USD";
    const orderStatus = readText(rawRow, aliases.orderStatus);

    if (options.skipStatusPattern?.test(orderStatus)) {
      issues.push(
        rowIssue(sourceRow, "SKIPPED_STATUS", `Skipped ${orderStatus} row.`, rawRow, "warning")
      );
      return;
    }

    if (!externalOrderId) {
      issues.push(rowIssue(sourceRow, "MISSING_ORDER_ID", "Missing order ID.", rawRow));
      return;
    }

    if (!orderDate) {
      issues.push(rowIssue(sourceRow, "INVALID_ORDER_DATE", "Missing or invalid order date.", rawRow));
      return;
    }

    if (!sku) {
      issues.push(rowIssue(sourceRow, "MISSING_SKU", "Missing SKU.", rawRow));
      return;
    }

    if (quantity.status !== "valid" || (quantity.value ?? 0) <= 0) {
      issues.push(rowIssue(sourceRow, "INVALID_QUANTITY", "Missing or invalid quantity.", rawRow));
      return;
    }

    if (itemPrice.status === "invalid") {
      issues.push(rowIssue(sourceRow, "INVALID_ITEM_PRICE", "Invalid item price.", rawRow));
      return;
    }

    if (grossSales.status === "invalid") {
      issues.push(rowIssue(sourceRow, "INVALID_GROSS_SALES", "Invalid gross sales.", rawRow));
      return;
    }

    if (itemPrice.status !== "valid" && grossSales.status !== "valid") {
      issues.push(
        rowIssue(
          sourceRow,
          "MISSING_SALES_AMOUNT",
          "Provide item price or gross sales.",
          rawRow
        )
      );
      return;
    }

    const naturalKey = `${normalizeHeader(externalOrderId)}:${normalizeHeader(sku)}`;

    if (seenNaturalKeys.has(naturalKey)) {
      issues.push(
        rowIssue(
          sourceRow,
          "DUPLICATE_ORDER_SKU",
          "Skipped duplicate row for the same order ID and SKU.",
          rawRow,
          "warning"
        )
      );
      return;
    }

    const units = Math.trunc(quantity.value ?? 0);
    const normalizedGrossSales =
      grossSales.status === "valid"
        ? roundMoney(grossSales.value ?? 0)
        : roundMoney((itemPrice.value ?? 0) * units);
    const normalizedItemPrice =
      itemPrice.status === "valid"
        ? roundMoney(itemPrice.value ?? 0)
        : roundMoney(normalizedGrossSales / units);
    const optionalMoney = readOptionalMoneyFields(rawRow, aliases);
    const invalidOptionalField = optionalMoney.find((field) => field.parsed.status === "invalid");

    if (invalidOptionalField) {
      issues.push(
        rowIssue(
          sourceRow,
          `INVALID_${invalidOptionalField.code}`,
          `Invalid ${invalidOptionalField.label}.`,
          rawRow
        )
      );
      return;
    }

    const refundDateValue = readAliasedValue(rawRow, aliases.refundDate);
    const refundDate = readDate(rawRow, aliases.refundDate);

    if (refundDateValue && !refundDate) {
      issues.push(rowIssue(sourceRow, "INVALID_REFUND_DATE", "Invalid refund date.", rawRow));
      return;
    }

    seenNaturalKeys.add(naturalKey);

    const refundAmount = getOptionalMoney(optionalMoney, "refundAmount");
    const row: ParsedSalesUploadRow = {
      marketplace: options.marketplace,
      externalOrderId,
      externalOrderLineId: externalOrderLineId || undefined,
      orderDate,
      sku,
      parentSku: readText(rawRow, aliases.parentSku) || undefined,
      productName: readText(rawRow, aliases.productName) || undefined,
      brand: readText(rawRow, aliases.brand) || undefined,
      marketplaceItemId: readText(rawRow, aliases.marketplaceItemId) || undefined,
      quantity: units,
      itemPrice: normalizedItemPrice,
      grossSales: normalizedGrossSales,
      shippingRevenue: getOptionalMoney(optionalMoney, "shippingRevenue") ?? 0,
      taxCollected: getOptionalMoney(optionalMoney, "taxCollected") ?? 0,
      discountAmount: Math.abs(getOptionalMoney(optionalMoney, "discountAmount") ?? 0),
      orderStatus: orderStatus || undefined,
      currency,
      sourceRow,
      fees: buildFees(optionalMoney, currency),
      refund:
        refundAmount && refundAmount !== 0
          ? {
              refundAmount: Math.abs(refundAmount),
              refundDate: refundDate ?? orderDate,
              currency
            }
          : undefined,
      metadata: {
        source: "sales_upload",
        externalOrderLineId: externalOrderLineId || null
      }
    };

    rows.push(row);
  });

  return buildSalesUploadWorkbook(rows, issues, rawRows.length);
}

type ParsedNumber = {
  status: "blank" | "invalid" | "valid";
  value: number | null;
};

type OptionalMoneyField = {
  key:
    | "shippingRevenue"
    | "taxCollected"
    | "discountAmount"
    | "marketplaceFee"
    | "fulfillmentFee"
    | "shippingFee"
    | "storageFee"
    | "returnFee"
    | "adjustmentAmount"
    | "refundAmount";
  code: string;
  label: string;
  parsed: ParsedNumber;
};

function buildSalesUploadWorkbook(
  rows: ParsedSalesUploadRow[],
  issues: SalesUploadIssue[],
  rowCount: number
): ParsedSalesUploadWorkbook {
  return {
    rows,
    issues,
    rowCount,
    summary: {
      totalRowsRead: rowCount,
      validRows: rows.length,
      rejectedRows: issues.length,
      totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
      totalGrossSales: roundMoney(rows.reduce((sum, row) => sum + row.grossSales, 0)),
      totalShippingRevenue: roundMoney(rows.reduce((sum, row) => sum + row.shippingRevenue, 0)),
      totalTaxCollected: roundMoney(rows.reduce((sum, row) => sum + row.taxCollected, 0)),
      totalDiscountAmount: roundMoney(rows.reduce((sum, row) => sum + row.discountAmount, 0)),
      totalFees: roundMoney(
        rows.reduce(
          (sum, row) => sum + row.fees.reduce((feeSum, fee) => feeSum + fee.feeAmount, 0),
          0
        )
      ),
      totalRefunds: roundMoney(
        rows.reduce((sum, row) => sum + (row.refund?.refundAmount ?? 0), 0)
      )
    }
  };
}

function getSheetName(workbook: XLSX.WorkBook, preferredSheetNames: string[] = []) {
  const preferred = workbook.SheetNames.find((sheetName) =>
    preferredSheetNames.map(normalizeHeader).includes(normalizeHeader(sheetName))
  );

  return preferred ?? workbook.SheetNames[0];
}

function normalizeAliases(overrides: SalesUploadParseOptions["headerAliases"] = {}) {
  const aliases = { ...defaultHeaderAliases };

  for (const [key, value] of Object.entries(overrides)) {
    const column = key as SalesUploadColumn;
    aliases[column] = [...(value ?? []), ...aliases[column]];
  }

  return Object.fromEntries(
    Object.entries(aliases).map(([key, value]) => [
      key,
      value.map(normalizeHeader)
    ])
  ) as Record<SalesUploadColumn, string[]>;
}

function readOptionalMoneyFields(
  row: Record<string, unknown>,
  aliases: Record<SalesUploadColumn, string[]>
): OptionalMoneyField[] {
  return [
    {
      key: "shippingRevenue",
      code: "SHIPPING_REVENUE",
      label: "shipping revenue",
      parsed: readMoneyValue(row, aliases.shippingRevenue)
    },
    {
      key: "taxCollected",
      code: "TAX_COLLECTED",
      label: "tax collected",
      parsed: readMoneyValue(row, aliases.taxCollected)
    },
    {
      key: "discountAmount",
      code: "DISCOUNT_AMOUNT",
      label: "discount amount",
      parsed: readMoneyValue(row, aliases.discountAmount)
    },
    {
      key: "marketplaceFee",
      code: "MARKETPLACE_FEE",
      label: "marketplace fee",
      parsed: readMoneyValue(row, aliases.marketplaceFee)
    },
    {
      key: "fulfillmentFee",
      code: "FULFILLMENT_FEE",
      label: "fulfillment fee",
      parsed: readMoneyValue(row, aliases.fulfillmentFee)
    },
    {
      key: "shippingFee",
      code: "SHIPPING_FEE",
      label: "shipping fee",
      parsed: readMoneyValue(row, aliases.shippingFee)
    },
    {
      key: "storageFee",
      code: "STORAGE_FEE",
      label: "storage fee",
      parsed: readMoneyValue(row, aliases.storageFee)
    },
    {
      key: "returnFee",
      code: "RETURN_FEE",
      label: "return fee",
      parsed: readMoneyValue(row, aliases.returnFee)
    },
    {
      key: "adjustmentAmount",
      code: "ADJUSTMENT_AMOUNT",
      label: "adjustment amount",
      parsed: readMoneyValue(row, aliases.adjustmentAmount)
    },
    {
      key: "refundAmount",
      code: "REFUND_AMOUNT",
      label: "refund amount",
      parsed: readMoneyValue(row, aliases.refundAmount)
    }
  ];
}

function buildFees(fields: OptionalMoneyField[], currency: string): SalesUploadFee[] {
  const feeMap: Array<{
    key: OptionalMoneyField["key"];
    feeType: string;
    preserveSign?: boolean;
  }> = [
    { key: "marketplaceFee", feeType: "marketplace_fee" },
    { key: "fulfillmentFee", feeType: "fulfillment_fee" },
    { key: "shippingFee", feeType: "shipping_fee" },
    { key: "storageFee", feeType: "storage_fee" },
    { key: "returnFee", feeType: "return_fee" },
    { key: "adjustmentAmount", feeType: "adjustment", preserveSign: true }
  ];

  return feeMap.flatMap((fee) => {
    const amount = getOptionalMoney(fields, fee.key);

    if (!amount) {
      return [];
    }

    return [
      {
        feeType: fee.feeType,
        feeAmount: fee.preserveSign ? roundMoney(amount) : -Math.abs(roundMoney(amount)),
        currency
      }
    ];
  });
}

function getOptionalMoney(fields: OptionalMoneyField[], key: OptionalMoneyField["key"]) {
  const parsed = fields.find((field) => field.key === key)?.parsed;
  return parsed?.status === "valid" ? roundMoney(parsed.value ?? 0) : null;
}

function rowIssue(
  row: number,
  code: string,
  message: string,
  rawData: Record<string, unknown>,
  severity: "error" | "warning" = "error"
): SalesUploadIssue {
  return { row, code, message, rawData, severity };
}

function readText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function readNumberValue(row: Record<string, unknown>, aliases: string[]): ParsedNumber {
  return parseNumber(readAliasedValue(row, aliases), false);
}

function readMoneyValue(row: Record<string, unknown>, aliases: string[]): ParsedNumber {
  return parseNumber(readAliasedValue(row, aliases), true);
}

function parseNumber(value: unknown, money: boolean): ParsedNumber {
  if (value === null || value === undefined || value === "") {
    return { status: "blank", value: null };
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { status: "valid", value }
      : { status: "invalid", value: null };
  }

  const parsed = Number(String(value).replace(money ? /[$,%\s,]/g : /[,%\s]/g, ""));

  return Number.isFinite(parsed)
    ? { status: "valid", value: parsed }
    : { status: "invalid", value: null };
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

function isBlankRow(row: Record<string, unknown>) {
  return Object.values(row).every(
    (value) => value === null || value === undefined || String(value).trim() === ""
  );
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function roundMoney(value: number) {
  return Math.round(value * 10000) / 10000;
}
