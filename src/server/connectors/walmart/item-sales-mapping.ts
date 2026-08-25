import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "../../../lib/db.ts";
import type {
  ImportCommitContext,
  ImportCommitResult,
  ImportReportParser,
  ParsedImportIssue,
  ParsedImportPreviewRow,
  ParsedImportReport
} from "../../imports/types.ts";
import {
  compactObject,
  readString as readJsonString,
  toArray,
  toJsonValue,
  toRecord
} from "../../imports/utils.ts";
import {
  normalizeMarketplaceSku,
  normalizeOptionalMarketplaceSku
} from "../../sales/sku-normalization.ts";

const REPORT_TYPE = "walmart_item_sales_product_mapping";
const REPORT_LABEL = "Item Sales - Product Mapping Only";
const DUPLICATE_VERSION = "walmart-item-sales-product-mapping-v1";
const PREVIEW_LIMIT = 50;
const COMMIT_CHUNK_SIZE = 500;

type WorkbookReport = {
  rawRows: Array<Record<string, unknown>>;
  headers: Set<string>;
};

type WalmartItemSalesMappingRow = {
  sellerSku: string;
  parentSku: string;
  itemId: string | null;
  itemName: string | null;
  brand: string | null;
  department: string | null;
  sourceRow: number;
};

type MappingCommitSummary = {
  rowsRead: number;
  skusFound: number;
  parentGroupsFound: number;
  newSkusCreated: number;
  existingSkusUpdated: number;
  parentRelationshipsCreated: number;
  parentRelationshipsChanged: number;
  invalidRows: number;
  duplicatesSkipped: number;
  itemSalesFinancialFieldsIgnored: string[];
};

export const walmartItemSalesMappingParser: ImportReportParser = {
  importKind: "inventory",
  reportType: REPORT_TYPE,
  reportTypeLabel: REPORT_LABEL,
  detect(context) {
    const report = readWorkbookReport(context.buffer);

    if (!report.rawRows.length) {
      return 0;
    }

    const hasSku = hasAnyHeader(report.headers, ["sku", "sku id", "seller sku", "partner sku"]);
    const hasParent = hasAnyHeader(report.headers, [
      "base item id",
      "base_item_id",
      "parent sku",
      "parent item id",
      "parent item",
      "variant group id"
    ]);
    const hasItemSalesShape = hasAnyHeader(report.headers, [
      "gmv",
      "units sold",
      "orders",
      "auth sales",
      "refund sales",
      "gmv minus commission"
    ]);

    return hasSku && hasParent && hasItemSalesShape ? 100 : 0;
  },
  parse(context) {
    return parseWalmartItemSalesMappingReport(context.buffer);
  },
  commit: commitWalmartItemSalesMapping
};

function parseWalmartItemSalesMappingReport(buffer: Buffer): ParsedImportReport {
  const report = readWorkbookReport(buffer);
  const parsed = parseMappingRows(report.rawRows);

  return {
    importKind: "inventory",
    reportType: REPORT_TYPE,
    reportTypeLabel: REPORT_LABEL,
    rowCount: parsed.summary.rowsRead,
    validCount: parsed.rows.length,
    rejectedCount: parsed.issues.length,
    issues: parsed.issues,
    previewRows: parsed.previewRows,
    summary: {
      ...parsed.summary,
      importedRows: 0,
      updatedRows: 0,
      mappingPurpose: "sku_parent_mapping_only",
      financialDataUsedForPnl: false,
      duplicateVersion: DUPLICATE_VERSION
    },
    payload: toJsonValue({
      rows: parsed.rows.map(encodeMappingPayloadRow)
    }),
    duplicateVersion: DUPLICATE_VERSION,
    allowDuplicateFileImport: true
  };
}

function parseMappingRows(rawRows: Array<Record<string, unknown>>) {
  const rows: WalmartItemSalesMappingRow[] = [];
  const issues: ParsedImportIssue[] = [];
  const previewRows: ParsedImportPreviewRow[] = [];
  const seenSkus = new Set<string>();
  const parentGroups = new Set<string>();
  let invalidRows = 0;
  let duplicatesSkipped = 0;
  const financialFieldsIgnored = new Set<string>();

  rawRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;

    if (isBlankRow(rawRow) || isSummaryRow(rawRow)) {
      return;
    }

    for (const header of Object.keys(rawRow)) {
      if (isFinancialHeader(header)) {
        financialFieldsIgnored.add(header);
      }
    }

    const sellerSku = normalizeMarketplaceSku(
      readAliasedText(rawRow, ["sku", "sku id", "seller sku", "partner sku", "item sku"])
    );
    const parentSku =
      normalizeOptionalMarketplaceSku(
        readAliasedText(rawRow, [
          "parent sku",
          "parent item id",
          "parent item",
          "base item id",
          "base_item_id",
          "variant group id",
          "group id"
        ])
      ) ?? "";

    if (!sellerSku) {
      invalidRows += 1;
      issues.push(errorIssue(sourceRow, "MISSING_SKU", "Missing SKU.", rawRow));
      return;
    }

    if (!parentSku) {
      invalidRows += 1;
      issues.push(
        errorIssue(
          sourceRow,
          "MISSING_PARENT_IDENTIFIER",
          "Missing Parent SKU, Parent Item ID, Base Item ID, or Variant Group ID.",
          rawRow
        )
      );
      return;
    }

    if (seenSkus.has(sellerSku)) {
      duplicatesSkipped += 1;
      issues.push(
        warningIssue(
          sourceRow,
          "DUPLICATE_SKU_MAPPING",
          "Skipped duplicate SKU mapping in this file. The first mapping for this SKU was used.",
          rawRow
        )
      );
      return;
    }

    seenSkus.add(sellerSku);
    parentGroups.add(parentSku);

    const mappingRow = {
      sellerSku,
      parentSku,
      itemId: readOptionalAliasedText(rawRow, [
        "item id",
        "item_id",
        "item id#",
        "walmart item id"
      ]),
      itemName: readOptionalAliasedText(rawRow, [
        "item name",
        "item_name",
        "product name",
        "product_name",
        "description"
      ]),
      brand: readOptionalAliasedText(rawRow, ["brand"]),
      department: readOptionalAliasedText(rawRow, ["department", "dept"]),
      sourceRow
    };

    rows.push(mappingRow);

    if (previewRows.length < PREVIEW_LIMIT) {
      previewRows.push({
        rowNumber: sourceRow,
        status: "valid",
        normalizedData: compactObject({
          sku: mappingRow.sellerSku,
          parentSku: mappingRow.parentSku,
          itemId: mappingRow.itemId,
          itemName: mappingRow.itemName,
          brand: mappingRow.brand,
          department: mappingRow.department,
          financialDataUsedForPnl: false
        })
      });
    }
  });

  const summary: MappingCommitSummary = {
    rowsRead: rawRows.length,
    skusFound: rows.length,
    parentGroupsFound: parentGroups.size,
    newSkusCreated: 0,
    existingSkusUpdated: 0,
    parentRelationshipsCreated: 0,
    parentRelationshipsChanged: 0,
    invalidRows,
    duplicatesSkipped,
    itemSalesFinancialFieldsIgnored: Array.from(financialFieldsIgnored).sort()
  };

  return { rows, issues, previewRows, summary };
}

async function commitWalmartItemSalesMapping(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const rows = decodeMappingRows(payload);

  if (!rows.length) {
    return {
      importedCount: 0,
      summary: {
        newSkusCreated: 0,
        existingSkusUpdated: 0,
        parentRelationshipsCreated: 0,
        parentRelationshipsChanged: 0
      }
    };
  }

  const skus = uniqueStrings(rows.map((row) => row.sellerSku));
  const parentSkus = uniqueStrings(rows.map((row) => row.parentSku));
  const existingProducts = await findProducts(context.organizationId, skus);
  const existingListings = await findListings(context.organizationId, context.marketplace, skus);
  const existingProductParentBySku = new Map(
    existingProducts.map((product) => [product.internalSku ?? "", product.parentSku])
  );
  const existingListingParentBySku = new Map(
    existingListings.map((listing) => [listing.sellerSku, listing.parentSku])
  );

  let newSkusCreated = skus.filter((sku) => !existingProductParentBySku.has(sku)).length;
  let existingSkusUpdated = skus.length - newSkusCreated;
  let parentRelationshipsCreated = 0;
  let parentRelationshipsChanged = 0;

  for (const row of rows) {
    const previousParent =
      existingListingParentBySku.get(row.sellerSku) ??
      existingProductParentBySku.get(row.sellerSku) ??
      null;

    if (!previousParent) {
      parentRelationshipsCreated += 1;
    } else if (previousParent !== row.parentSku) {
      parentRelationshipsChanged += 1;
    }
  }

  for (const parentChunk of chunkArray(parentSkus, COMMIT_CHUNK_SIZE)) {
    await prisma.product.createMany({
      data: parentChunk.map((parentSku) => ({
        organizationId: context.organizationId,
        internalSku: parentSku,
        title: parentSku
      })),
      skipDuplicates: true
    });
  }

  for (const rowChunk of chunkArray(rows, COMMIT_CHUNK_SIZE)) {
    await prisma.product.createMany({
      data: rowChunk.map((row) => ({
        organizationId: context.organizationId,
        internalSku: row.sellerSku,
        parentSku: row.parentSku,
        title: row.itemName,
        brand: row.brand
      })),
      skipDuplicates: true
    });

    const products = await findProducts(
      context.organizationId,
      rowChunk.map((row) => row.sellerSku)
    );
    const productsBySku = new Map(
      products.flatMap((product) =>
        product.internalSku ? [[product.internalSku, product]] as const : []
      )
    );

    await prisma.listing.createMany({
      data: rowChunk.map((row) => ({
        organizationId: context.organizationId,
        productId: productsBySku.get(row.sellerSku)?.id,
        marketplace: context.marketplace,
        sellerSku: row.sellerSku,
        parentSku: row.parentSku,
        marketplaceItemId: row.itemId,
        title: row.itemName
      })),
      skipDuplicates: true
    });

    for (const row of rowChunk) {
      const product = productsBySku.get(row.sellerSku);

      await prisma.product.updateMany({
        where: { organizationId: context.organizationId, internalSku: row.sellerSku },
        data: {
          parentSku: row.parentSku,
          ...(row.itemName ? { title: row.itemName } : {}),
          ...(row.brand ? { brand: row.brand } : {})
        }
      });

      await prisma.listing.updateMany({
        where: {
          organizationId: context.organizationId,
          marketplace: context.marketplace,
          sellerSku: row.sellerSku
        },
        data: {
          productId: product?.id,
          parentSku: row.parentSku,
          ...(row.itemId ? { marketplaceItemId: row.itemId } : {}),
          ...(row.itemName ? { title: row.itemName } : {})
        }
      });
    }
  }

  return {
    importedCount: rows.length,
    summary: {
      rowsRead: rows.length,
      skusFound: skus.length,
      parentGroupsFound: parentSkus.length,
      newSkusCreated,
      existingSkusUpdated,
      parentRelationshipsCreated,
      parentRelationshipsChanged,
      mappingSource: "walmart_item_sales",
      mappingPurpose: "sku_parent_mapping_only",
      financialDataUsedForPnl: false
    }
  };
}

function findProducts(organizationId: string, skus: string[]) {
  return prisma.product.findMany({
    where: { organizationId, internalSku: { in: uniqueStrings(skus) } },
    select: { id: true, internalSku: true, parentSku: true }
  });
}

function findListings(organizationId: string, marketplace: string, skus: string[]) {
  return prisma.listing.findMany({
    where: { organizationId, marketplace, sellerSku: { in: uniqueStrings(skus) } },
    select: { sellerSku: true, parentSku: true }
  });
}

function encodeMappingPayloadRow(row: WalmartItemSalesMappingRow) {
  return row;
}

function decodeMappingRows(payload: Prisma.JsonValue): WalmartItemSalesMappingRow[] {
  const record = toRecord(payload);

  return toArray(record.rows)
    .map((value) => {
      const row = toRecord(value as Prisma.JsonValue);

      return {
        sellerSku: normalizeMarketplaceSku(readJsonString(row.sellerSku)),
        parentSku: normalizeMarketplaceSku(readJsonString(row.parentSku)),
        itemId: optionalJsonString(row.itemId),
        itemName: optionalJsonString(row.itemName),
        brand: optionalJsonString(row.brand),
        department: optionalJsonString(row.department),
        sourceRow: Math.trunc(Number(row.sourceRow) || 0)
      };
    })
    .filter((row) => row.sellerSku && row.parentSku);
}

function readWorkbookReport(buffer: Buffer): WorkbookReport {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;

  if (!sheet) {
    return { rawRows: [], headers: new Set<string>() };
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  return {
    rawRows,
    headers: getHeaders(rawRows)
  };
}

function hasAnyHeader(headers: Set<string>, aliases: string[]) {
  return aliases.some((alias) => headers.has(normalizeHeader(alias)));
}

function getHeaders(rows: Array<Record<string, unknown>>) {
  const firstRow = rows[0] ?? {};
  return new Set(Object.keys(firstRow).map(normalizeHeader));
}

function readAliasedText(row: Record<string, unknown>, aliases: string[]) {
  const value = readAliasedValue(row, aliases);
  return value === null || value === undefined ? "" : String(value).trim();
}

function readOptionalAliasedText(row: Record<string, unknown>, aliases: string[]) {
  const text = readAliasedText(row, aliases);
  return text || null;
}

function readAliasedValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const key = Object.keys(row).find((candidate) =>
    normalizedAliases.includes(normalizeHeader(candidate))
  );

  return key ? row[key] : null;
}

function isBlankRow(row: Record<string, unknown>) {
  return Object.values(row).every((value) => value === null || value === undefined || value === "");
}

function isSummaryRow(row: Record<string, unknown>) {
  return Object.values(row).some((value) => {
    const normalized = normalizeHeader(value === null || value === undefined ? "" : String(value));
    return normalized === "total" || normalized === "grand total" || normalized === "summary";
  });
}

function isFinancialHeader(header: string) {
  return [
    "gmv",
    "units sold",
    "orders",
    "auth sales",
    "cancelled sales",
    "refund sales",
    "gmv minus commission",
    "aur"
  ].includes(normalizeHeader(header));
}

function errorIssue(row: number, code: string, message: string, rawData: Record<string, unknown>) {
  return { row, code, message, rawData, severity: "error" as const };
}

function warningIssue(row: number, code: string, message: string, rawData: Record<string, unknown>) {
  return { row, code, message, rawData, severity: "warning" as const };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function optionalJsonString(value: unknown) {
  const text = readJsonString(value).trim();
  return text || null;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}
