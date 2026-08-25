import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

const args = parseArgs(process.argv.slice(2));
const marketplace = args.marketplace ?? "walmart";
const from = args.from ?? null;
const to = args.to ?? null;
const sampleLimit = Number(args.limit ?? 25);

loadEnvFile();

if (args.file) {
  inspectWorkbook(args.file);
}

const prisma = new PrismaClient();

try {
  await inspectDatabase();
} finally {
  await prisma.$disconnect();
}

function inspectWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const headers = Object.keys(rows[0] ?? {});
  const quantityColumn = findColumn(headers, ["qty", "quantity"]);
  const unitPriceColumn = findColumn(headers, ["item cost", "item price", "unit price", "price"]);
  const extendedAmountColumn = findColumn(headers, [
    "gross sales",
    "item revenue",
    "sales",
    "po gmv",
    "gmv"
  ]);
  const cancelledQuantityColumn = findColumn(headers, [
    "cancelled qty",
    "canceled qty",
    "cancelled quantity",
    "canceled quantity",
    "qty cancelled",
    "qty canceled",
    "quantity cancelled",
    "quantity canceled"
  ]);
  const statusColumn = findColumn(headers, ["status", "order status"]);
  const sampleRows = rows
    .filter((row) => toNumber(row[quantityColumn]) > 1)
    .slice(0, 10)
    .map((row) => ({
      quantity: toNumber(row[quantityColumn]),
      unitPriceColumn,
      unitPriceValue: unitPriceColumn ? row[unitPriceColumn] : null,
      extendedAmountColumn,
      extendedAmountValue: extendedAmountColumn ? row[extendedAmountColumn] : null,
      status: statusColumn ? row[statusColumn] : null,
      cancelledQuantity: cancelledQuantityColumn ? row[cancelledQuantityColumn] : null
    }));

  console.log("Workbook PO quantity inspection");
  console.table({
    file: filePath,
    sheet: firstSheetName,
    rowCount: rows.length,
    quantityColumn: quantityColumn ?? "(not found)",
    unitPriceColumn: unitPriceColumn ?? "(not found)",
    extendedAmountColumn: extendedAmountColumn ?? "(not found)",
    cancelledQuantityColumn: cancelledQuantityColumn ?? "(not found)",
    statusColumn: statusColumn ?? "(not found)"
  });
  console.table(sampleRows);
}

async function inspectDatabase() {
  const hasPriceSourceKind = await columnExists("SalesOrderItem", "poPriceSourceKind");
  const dateFilter = buildDateFilter();
  const [summaryRows, sampleRows, importPreviewRows] = await Promise.all([
    prisma.$queryRawUnsafe(`
      WITH po_lines AS (
        SELECT
          soi.id,
          soi."purchaseOrderNumber",
          soi."sellerSku",
          soi.quantity,
          soi."unitPrice"::numeric AS unit_price,
          soi."itemRevenue"::numeric AS item_revenue,
          ${hasPriceSourceKind ? 'soi."poPriceSourceKind"' : "NULL"} AS price_source_kind,
          so."orderDate",
          COALESCE(si.status::text, '(no sales import)') AS import_status,
          (so."importId" IS NULL OR si.status IN ('IMPORTED', 'NEEDS_REVIEW')) AS pnl_eligible
        FROM "SalesOrderItem" soi
        JOIN "SalesOrder" so ON so.id = soi."orderId"
        LEFT JOIN "SalesImport" si ON si.id = so."importId"
        WHERE soi."marketplace" = $1
          AND so.status = 'PO_DETAIL'
          AND soi.quantity > 0
          ${dateFilter.sql}
      ),
      compared AS (
        SELECT
          *,
          CASE
            WHEN price_source_kind = 'extended_line_amount' THEN item_revenue
            WHEN quantity > 1 AND abs(item_revenue - unit_price) < 0.005 THEN unit_price * quantity
            ELSE item_revenue
          END AS corrected_item_revenue
        FROM po_lines
      )
      SELECT
        import_status,
        pnl_eligible,
        COUNT(*)::int AS total_lines,
        COUNT(*) FILTER (WHERE quantity > 1)::int AS quantity_gt_one_lines,
        COUNT(*) FILTER (WHERE abs(corrected_item_revenue - item_revenue) >= 0.005)::int AS affected_lines,
        COALESCE(SUM(item_revenue), 0)::float AS current_gmv,
        COALESCE(SUM(corrected_item_revenue), 0)::float AS corrected_gmv,
        COALESCE(SUM(corrected_item_revenue - item_revenue), 0)::float AS quantity_difference
      FROM compared
      GROUP BY import_status, pnl_eligible
      ORDER BY pnl_eligible DESC, import_status
    `, marketplace, ...dateFilter.params),
    prisma.$queryRawUnsafe(`
      WITH po_lines AS (
        SELECT
          soi."purchaseOrderNumber",
          soi."sellerSku",
          soi.quantity,
          soi."unitPrice"::numeric AS unit_price,
          soi."itemRevenue"::numeric AS item_revenue,
          ${hasPriceSourceKind ? 'soi."poPriceSourceKind"' : "NULL"} AS price_source_kind,
          so."orderDate",
          COALESCE(si.status::text, '(no sales import)') AS import_status,
          (so."importId" IS NULL OR si.status IN ('IMPORTED', 'NEEDS_REVIEW')) AS pnl_eligible
        FROM "SalesOrderItem" soi
        JOIN "SalesOrder" so ON so.id = soi."orderId"
        LEFT JOIN "SalesImport" si ON si.id = so."importId"
        WHERE soi."marketplace" = $1
          AND so.status = 'PO_DETAIL'
          AND soi.quantity > 1
          ${dateFilter.sql}
      ),
      compared AS (
        SELECT
          *,
          CASE
            WHEN price_source_kind = 'extended_line_amount' THEN item_revenue
            WHEN abs(item_revenue - unit_price) < 0.005 THEN unit_price * quantity
            ELSE item_revenue
          END AS corrected_item_revenue
        FROM po_lines
      )
      SELECT
        "purchaseOrderNumber",
        "sellerSku",
        quantity::int,
        unit_price::float AS "sourcePrice",
        COALESCE(price_source_kind, 'unknown_legacy') AS "priceSourceKind",
        item_revenue::float AS "currentStoredGrossSales",
        corrected_item_revenue::float AS "calculatedGrossSales",
        (corrected_item_revenue - item_revenue)::float AS difference,
        import_status AS "importStatus",
        pnl_eligible AS "pnlEligible",
        "orderDate"
      FROM compared
      ORDER BY abs(corrected_item_revenue - item_revenue) DESC, "orderDate" DESC
      LIMIT ${Math.max(1, Math.trunc(sampleLimit))}
    `, marketplace, ...dateFilter.params),
    prisma.importRunPreviewRow.findMany({
      where: {
        importRun: {
          marketplace,
          importKind: "sales",
          reportType: "walmart_po_order_sales"
        },
        status: "valid"
      },
      include: { importRun: true },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  console.log("Imported PO quantity diagnostic");
  console.table(summaryRows.map(formatMoneySummary));
  console.log("P&L uses rows where pnlEligible = true.");
  console.log("Sample imported PO lines with quantity > 1");
  console.table(sampleRows.map(formatSampleRow));
  console.log("Saved preview column hints");
  console.table(summarizePreviewRows(importPreviewRows));
}

function buildDateFilter() {
  const clauses = [];
  const params = [];

  if (from) {
    params.push(new Date(`${from}T00:00:00.000Z`));
    clauses.push(`AND so."orderDate" >= $${params.length + 1}`);
  }

  if (to) {
    params.push(new Date(`${to}T23:59:59.999Z`));
    clauses.push(`AND so."orderDate" <= $${params.length + 1}`);
  }

  return {
    sql: clauses.length ? `\n          ${clauses.join("\n          ")}` : "",
    params
  };
}

async function columnExists(tableName, columnName) {
  const rows = await prisma.$queryRawUnsafe(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    tableName,
    columnName
  );

  return rows.length > 0;
}

function summarizePreviewRows(rows) {
  return rows.slice(0, 10).map((row) => {
    const rawData = row.rawData && typeof row.rawData === "object" ? row.rawData : {};
    const normalizedData =
      row.normalizedData && typeof row.normalizedData === "object" ? row.normalizedData : {};
    const headers = Object.keys(rawData);

    return {
      file: row.importRun.originalFileName,
      rowNumber: row.rowNumber,
      quantityColumn: findColumn(headers, ["qty", "quantity"]),
      quantity: normalizedData.quantity,
      originalQuantity: normalizedData.originalQuantity,
      unitPriceColumn: findColumn(headers, ["item cost", "item price", "unit price", "price"]),
      extendedAmountColumn: findColumn(headers, ["gross sales", "item revenue", "sales", "po gmv", "gmv"]),
      priceSourceKind: normalizedData.priceSourceKind,
      poGmv: normalizedData.poGmv
    };
  });
}

function formatMoneySummary(row) {
  return {
    importStatus: row.import_status,
    pnlEligible: row.pnl_eligible,
    totalLines: row.total_lines,
    quantityGtOneLines: row.quantity_gt_one_lines,
    affectedLines: row.affected_lines,
    currentGmv: roundMoney(row.current_gmv),
    correctedGmv: roundMoney(row.corrected_gmv),
    quantityDifference: roundMoney(row.quantity_difference)
  };
}

function formatSampleRow(row) {
  return {
    purchaseOrderNumber: row.purchaseOrderNumber,
    sku: row.sellerSku,
    quantity: row.quantity,
    sourcePrice: roundMoney(row.sourcePrice),
    sourcePriceKind: row.priceSourceKind,
    calculatedGrossSales: roundMoney(row.calculatedGrossSales),
    currentStoredGrossSales: roundMoney(row.currentStoredGrossSales),
    difference: roundMoney(row.difference),
    importStatus: row.importStatus,
    pnlEligible: row.pnlEligible,
    orderDate: row.orderDate?.toISOString?.().slice(0, 10) ?? String(row.orderDate)
  };
}

function parseArgs(values) {
  return Object.fromEntries(
    values.map((value) => {
      const normalized = value.startsWith("--") ? value.slice(2) : value;
      const [key, ...rest] = normalized.split("=");
      return [key, rest.join("=") || "true"];
    })
  );
}

function findColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.find((header) => normalizedAliases.includes(normalizeHeader(header))) ?? null;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function loadEnvFile() {
  const envText = readFileSync(".env", "utf8");

  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
