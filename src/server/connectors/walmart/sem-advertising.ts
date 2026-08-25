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
import { compactObject, readNumber, toArray, toJsonValue, toRecord } from "../../imports/utils.ts";

const REPORT_TYPE = "walmart_seller_center_sem_campaign_daily";
const REPORT_LABEL = "Walmart Seller Center SEM Campaign Daily Report";
const SOURCE = "walmart_seller_center_sem";
const DUPLICATE_VERSION = "walmart-seller-center-sem-campaign-daily-v1";
const PREVIEW_LIMIT = 50;
const WRITE_CHUNK_SIZE = 500;
const REQUIRED_HEADERS = [
  "date",
  "campaign name",
  "campaign id",
  "impressions",
  "clicks",
  "spend",
  "sales"
];

type WorkbookReport = {
  sheet: XLSX.WorkSheet | null;
  rawRows: Array<Record<string, unknown>>;
  headers: Set<string>;
};

type ParsedNumber = {
  status: "blank" | "invalid" | "valid";
  value: number | null;
};

type SemRow = {
  rowNumber: number;
  sourceRows: number[];
  reportingDate: string;
  campaignName: string;
  campaignId: string;
  impressions: number;
  clicks: number;
  averageCtr: number | null;
  spend: number;
  attributedSales: number;
  roas: number | null;
  duplicateKey: string;
};

type SemSummary = {
  rowsRead: number;
  validRows: number;
  skippedRows: number;
  importedRows: number;
  updatedRows: number;
  zeroSpendRows: number;
  invalidRows: number;
  duplicateRowsAggregated: number;
  duplicateGroupsAggregated: number;
  totalSemSpend: number;
  totalAttributedSales: number;
  earliestDate: string | null;
  latestDate: string | null;
  dateCount: number;
  detectedGrain: "daily";
  spendField: "Spend";
  attributedSalesField: "Sales";
  skuAttributionAvailable: false;
  attributionLevel: "marketplace_campaign";
  mappedSkuCount: 0;
  unmappedSkuCount: 0;
};

type ExistingSemCost = {
  id: string;
  costDate: Date;
  campaignId: string | null;
  campaignName: string | null;
  metadata: Prisma.JsonValue | null;
};

const workbookCache = new WeakMap<Buffer, WorkbookReport>();

export const walmartSellerCenterSemParser: ImportReportParser = {
  importKind: "advertising",
  reportType: REPORT_TYPE,
  reportTypeLabel: REPORT_LABEL,
  detect(context) {
    const report = readWorkbookReport(context.buffer);

    if (!report.sheet) {
      return 0;
    }

    const hasRequiredHeaders = REQUIRED_HEADERS.every((header) => report.headers.has(header));
    const hasCampaignShape = report.headers.has("campaign name") && report.headers.has("campaign id");

    return hasRequiredHeaders && hasCampaignShape ? 100 : 0;
  },
  parse(context) {
    return parseWalmartSellerCenterSemReport(context.buffer);
  },
  commit: commitWalmartSellerCenterSemReport
};

export function parseWalmartSellerCenterSemReport(buffer: Buffer): ParsedImportReport {
  const report = readWorkbookReport(buffer);

  if (!report.sheet) {
    return unsupportedReport("WORKSHEET_NOT_FOUND", "The file did not contain a readable worksheet.");
  }

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !report.headers.has(header));

  if (missingHeaders.length) {
    return unsupportedReport(
      "UNSUPPORTED_WALMART_SEM_REPORT",
      `This does not look like a Walmart Seller Center SEM campaign daily report. Missing columns: ${missingHeaders.join(", ")}.`
    );
  }

  const parsed = parseSemRows(report.rawRows);

  return {
    importKind: "advertising",
    reportType: REPORT_TYPE,
    reportTypeLabel: REPORT_LABEL,
    rowCount: parsed.summary.rowsRead,
    validCount: parsed.rows.length,
    rejectedCount: parsed.issues.filter((issue) => issue.severity !== "warning").length,
    issues: parsed.issues,
    previewRows: parsed.previewRows,
    summary: {
      parserVersion: DUPLICATE_VERSION,
      reportName: "Campaign Level Daily Report",
      ...parsed.summary
    },
    payload: toJsonValue({
      source: SOURCE,
      rows: parsed.rows
    }),
    duplicateVersion: DUPLICATE_VERSION,
    allowDuplicateFileImport: true
  };
}

async function commitWalmartSellerCenterSemReport(
  context: ImportCommitContext,
  payload: Prisma.JsonValue
): Promise<ImportCommitResult> {
  const rows = decodeSemRows(payload);

  if (!rows.length) {
    return {
      importedCount: 0,
      summary: {
        importedRows: 0,
        updatedRows: 0,
        totalSemSpend: 0
      }
    };
  }

  const existingByKey = await loadExistingSemRows({
    organizationId: context.organizationId,
    marketplace: context.marketplace,
    rows
  });
  const rowsToCreate: Prisma.AdvertisingCostCreateManyInput[] = [];
  let importedRows = 0;
  let updatedRows = 0;

  for (const row of rows) {
    const existing = existingByKey.get(row.duplicateKey);

    if (existing) {
      updatedRows += 1;
      await prisma.advertisingCost.update({
        where: { id: existing.id },
        data: buildSemUpdate(row, context.originalFileName)
      });
      continue;
    }

    importedRows += 1;
    rowsToCreate.push(
      buildSemCreate({
        organizationId: context.organizationId,
        marketplace: context.marketplace,
        row,
        originalFileName: context.originalFileName
      })
    );
  }

  for (const chunk of chunkArray(rowsToCreate, WRITE_CHUNK_SIZE)) {
    await prisma.advertisingCost.createMany({ data: chunk });
  }

  const summary = summarizeSemRows(rows);

  return {
    importedCount: importedRows + updatedRows,
    summary: {
      importedRows,
      updatedRows,
      rowsImported: importedRows,
      rowsUpdated: updatedRows,
      duplicateUpsertedRows: updatedRows,
      totalSemSpend: summary.totalSemSpend,
      totalAttributedSales: summary.totalAttributedSales,
      earliestDate: summary.earliestDate,
      latestDate: summary.latestDate,
      dateCount: summary.dateCount,
      reportingPeriod: formatReportingPeriod(summary.earliestDate, summary.latestDate),
      mappedSkuCount: 0,
      unmappedSkuCount: 0,
      skuAttributionAvailable: false,
      attributionLevel: "marketplace_campaign"
    }
  };
}

function parseSemRows(rawRows: Array<Record<string, unknown>>) {
  const rowsByKey = new Map<string, SemRow>();
  const issues: ParsedImportIssue[] = [];
  let zeroSpendRows = 0;
  let invalidRows = 0;
  let duplicateRowsAggregated = 0;
  let duplicateGroupsAggregated = 0;

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;

    if (isBlankRow(rawRow)) {
      return;
    }

    const reportingDate = readDateString(readAliasedValue(rawRow, ["Date"]));
    const campaignName = readText(readAliasedValue(rawRow, ["Campaign Name"]));
    const campaignId = readText(readAliasedValue(rawRow, ["Campaign ID"]));
    const impressions = readNumericField(rawRow, ["Impressions"], false);
    const clicks = readNumericField(rawRow, ["Clicks"], false);
    const averageCtr = readNumericField(rawRow, ["Average CTR"], true);
    const spend = readNumericField(rawRow, ["Spend"], false);
    const attributedSales = readNumericField(rawRow, ["Sales"], false);
    const roas = readNumericField(rawRow, ["ROAS"], true);

    const invalidFields = [
      reportingDate ? null : "Date",
      campaignName ? null : "Campaign Name",
      campaignId ? null : "Campaign ID",
      impressions.status === "invalid" ? "Impressions" : null,
      clicks.status === "invalid" ? "Clicks" : null,
      averageCtr.status === "invalid" ? "Average CTR" : null,
      spend.status === "valid" ? null : "Spend",
      attributedSales.status === "invalid" ? "Sales" : null,
      roas.status === "invalid" ? "ROAS" : null
    ].filter(Boolean);

    if (invalidFields.length) {
      invalidRows += 1;
      issues.push({
        row: rowNumber,
        code: "INVALID_SEM_ROW",
        message: `Required SEM fields are missing or invalid: ${invalidFields.join(", ")}.`,
        rawData: rawRow
      });
      return;
    }

    if ((spend.value ?? 0) <= 0) {
      zeroSpendRows += 1;
      issues.push({
        row: rowNumber,
        code: "ZERO_SEM_SPEND",
        message: "Rows with blank or zero SEM spend are skipped.",
        severity: "warning",
        rawData: rawRow
      });
      return;
    }

    const row: SemRow = {
      rowNumber,
      sourceRows: [rowNumber],
      reportingDate,
      campaignName,
      campaignId,
      impressions: impressions.value ?? 0,
      clicks: clicks.value ?? 0,
      averageCtr: averageCtr.value,
      spend: roundMoney(spend.value ?? 0),
      attributedSales: roundMoney(attributedSales.value ?? 0),
      roas: roas.value,
      duplicateKey: buildSemDuplicateKey({
        reportingDate,
        campaignId,
        campaignName
      })
    };
    const existing = rowsByKey.get(row.duplicateKey);

    if (existing) {
      duplicateRowsAggregated += 1;
      if (existing.sourceRows.length === 1) {
        duplicateGroupsAggregated += 1;
      }
      mergeSemRows(existing, row);
      return;
    }

    rowsByKey.set(row.duplicateKey, row);
  });

  const rows = [...rowsByKey.values()].sort((a, b) =>
    a.reportingDate.localeCompare(b.reportingDate) || a.campaignName.localeCompare(b.campaignName)
  );
  const summary = {
    ...summarizeSemRows(rows),
    rowsRead: rawRows.length,
    validRows: rows.length,
    skippedRows: zeroSpendRows + invalidRows,
    importedRows: 0,
    updatedRows: 0,
    zeroSpendRows,
    invalidRows,
    duplicateRowsAggregated,
    duplicateGroupsAggregated,
    detectedGrain: "daily" as const,
    spendField: "Spend" as const,
    attributedSalesField: "Sales" as const,
    skuAttributionAvailable: false as const,
    attributionLevel: "marketplace_campaign" as const,
    mappedSkuCount: 0,
    unmappedSkuCount: 0
  };

  return {
    rows,
    issues,
    summary,
    previewRows: rows.slice(0, PREVIEW_LIMIT).map((row) => buildPreviewRow(row))
  };
}

function summarizeSemRows(rows: SemRow[]) {
  const dates = [...new Set(rows.map((row) => row.reportingDate))].sort();

  return {
    totalSemSpend: roundMoney(rows.reduce((sum, row) => sum + row.spend, 0)),
    totalAttributedSales: roundMoney(rows.reduce((sum, row) => sum + row.attributedSales, 0)),
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    dateCount: dates.length
  };
}

async function loadExistingSemRows({
  organizationId,
  marketplace,
  rows
}: {
  organizationId: string;
  marketplace: string;
  rows: SemRow[];
}) {
  const dates = [...new Set(rows.map((row) => row.reportingDate))].map((date) => new Date(`${date}T00:00:00.000Z`));
  const campaignIds = [...new Set(rows.map((row) => row.campaignId).filter(Boolean))];
  const campaignNames = [...new Set(rows.map((row) => row.campaignName).filter(Boolean))];

  if (!dates.length) {
    return new Map<string, ExistingSemCost>();
  }

  const existingRows = await prisma.advertisingCost.findMany({
    where: {
      organizationId,
      marketplace,
      source: SOURCE,
      costDate: { in: dates },
      OR: [
        ...(campaignIds.length ? [{ campaignId: { in: campaignIds } }] : []),
        ...(campaignNames.length ? [{ campaignName: { in: campaignNames } }] : [])
      ]
    },
    select: {
      id: true,
      costDate: true,
      campaignId: true,
      campaignName: true,
      metadata: true
    }
  });

  return new Map(
    existingRows.map((row) => [
      buildSemDuplicateKey({
        reportingDate: formatDate(row.costDate),
        campaignId: row.campaignId ?? readText(toRecord(row.metadata).campaignId),
        campaignName: row.campaignName ?? readText(toRecord(row.metadata).campaignName)
      }),
      row
    ])
  );
}

function buildSemCreate({
  organizationId,
  marketplace,
  row,
  originalFileName
}: {
  organizationId: string;
  marketplace: string;
  row: SemRow;
  originalFileName: string;
}): Prisma.AdvertisingCostCreateManyInput {
  return {
    organizationId,
    marketplace,
    source: SOURCE,
    sellerSku: null,
    parentSku: null,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    costDate: new Date(`${row.reportingDate}T00:00:00.000Z`),
    amount: row.spend,
    currency: "USD",
    metadata: buildMetadata(row, originalFileName)
  };
}

function buildSemUpdate(row: SemRow, originalFileName: string): Prisma.AdvertisingCostUpdateInput {
  return {
    sellerSku: null,
    parentSku: null,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    costDate: new Date(`${row.reportingDate}T00:00:00.000Z`),
    amount: row.spend,
    currency: "USD",
    metadata: buildMetadata(row, originalFileName)
  };
}

function buildMetadata(row: SemRow, originalFileName: string): Prisma.InputJsonValue {
  return toJsonValue({
    source: SOURCE,
    reportType: REPORT_LABEL,
    reportName: "Campaign Level Daily Report",
    grain: "daily",
    reportGrain: "daily",
    reportDate: row.reportingDate,
    date: row.reportingDate,
    originalFileName,
    sourceRow: row.rowNumber,
    sourceRows: row.sourceRows,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    clicks: row.clicks,
    impressions: row.impressions,
    averageCtr: row.averageCtr,
    attributedSales: row.attributedSales,
    roas: row.roas,
    skuAttributionAvailable: false,
    attributionLevel: "marketplace_campaign",
    duplicateKey: row.duplicateKey
  });
}

function buildPreviewRow(row: SemRow): ParsedImportPreviewRow {
  return {
    rowNumber: row.rowNumber,
    status: "valid",
    normalizedData: compactObject({
      date: row.reportingDate,
      campaignName: row.campaignName,
      campaignId: row.campaignId,
      spend: row.spend,
      sales: row.attributedSales,
      clicks: row.clicks,
      impressions: row.impressions,
      roas: row.roas,
      skuAttribution: "marketplace-level"
    })
  };
}

function unsupportedReport(code: string, message: string): ParsedImportReport {
  return {
    importKind: "advertising",
    reportType: REPORT_TYPE,
    reportTypeLabel: REPORT_LABEL,
    rowCount: 0,
    validCount: 0,
    rejectedCount: 1,
    issues: [{ row: 0, code, message }],
    previewRows: [],
    summary: { message },
    payload: toJsonValue({ rows: [] }),
    duplicateVersion: DUPLICATE_VERSION,
    allowDuplicateFileImport: true
  };
}

function decodeSemRows(payload: Prisma.JsonValue): SemRow[] {
  return toArray(toRecord(payload).rows)
    .map((value) => toRecord(value as Prisma.JsonValue))
    .map((row) => ({
      rowNumber: readNumber(row.rowNumber),
      sourceRows: toArray(row.sourceRows).map((value) => readNumber(value)),
      reportingDate: readText(row.reportingDate),
      campaignName: readText(row.campaignName),
      campaignId: readText(row.campaignId),
      impressions: readNumber(row.impressions),
      clicks: readNumber(row.clicks),
      averageCtr: optionalNumber(row.averageCtr),
      spend: readNumber(row.spend),
      attributedSales: readNumber(row.attributedSales),
      roas: optionalNumber(row.roas),
      duplicateKey: readText(row.duplicateKey)
    }))
    .filter((row) => row.reportingDate && row.campaignName && row.campaignId && row.spend > 0);
}

function readWorkbookReport(buffer: Buffer): WorkbookReport {
  const cached = workbookCache.get(buffer);

  if (cached) {
    return cached;
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  const rawRows = sheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: true
      })
    : [];
  const report = {
    sheet,
    rawRows,
    headers: new Set(getHeaders(rawRows).map(normalizeHeader))
  };

  workbookCache.set(buffer, report);
  return report;
}

function getHeaders(rows: Array<Record<string, unknown>>) {
  return rows[0] ? Object.keys(rows[0]) : [];
}

function readNumericField(
  rawRow: Record<string, unknown>,
  aliases: string[],
  optional: boolean
): ParsedNumber {
  const value = readAliasedValue(rawRow, aliases);

  if (value === null || value === undefined || String(value).trim() === "") {
    return optional ? { status: "blank", value: null } : { status: "invalid", value: null };
  }

  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));

  if (!Number.isFinite(parsed)) {
    return { status: "invalid", value: null };
  }

  return { status: "valid", value: parsed };
}

function readAliasedValue(rawRow: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const entry = Object.entries(rawRow).find(([key]) => normalizedAliases.has(normalizeHeader(key)));

  return entry?.[1] ?? null;
}

function readDateString(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(value);
  }

  const text = readText(value);

  if (!text) {
    return "";
  }

  const parsed = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? "" : formatDate(parsed);
}

function readText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function optionalNumber(value: unknown) {
  const parsed = readNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeSemRows(target: SemRow, incoming: SemRow) {
  target.sourceRows.push(...incoming.sourceRows);
  target.impressions += incoming.impressions;
  target.clicks += incoming.clicks;
  target.spend = roundMoney(target.spend + incoming.spend);
  target.attributedSales = roundMoney(target.attributedSales + incoming.attributedSales);
  target.averageCtr =
    target.impressions > 0 ? roundMoney((target.clicks / target.impressions) * 100) : null;
  target.roas = target.spend > 0 ? roundMoney(target.attributedSales / target.spend) : null;
}

function buildSemDuplicateKey({
  reportingDate,
  campaignId,
  campaignName
}: {
  reportingDate: string;
  campaignId: string;
  campaignName: string;
}) {
  return [
    SOURCE,
    reportingDate,
    normalizeKey(campaignId) || normalizeKey(campaignName)
  ].join("|");
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function isBlankRow(rawRow: Record<string, unknown>) {
  return Object.values(rawRow).every((value) => value === null || value === undefined || String(value).trim() === "");
}

function normalizeHeader(value: string) {
  return value.trim().replace(/^"+|"+$/g, "").toLowerCase().replace(/[_\s]+/g, " ");
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatReportingPeriod(start: string | null, end: string | null) {
  if (!start || !end) {
    return null;
  }

  return start === end ? start : `${start} - ${end}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
