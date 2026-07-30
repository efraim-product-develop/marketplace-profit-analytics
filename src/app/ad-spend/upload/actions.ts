"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import {
  AD_SOURCE_CONNECT,
  adSpendReportTypes,
  buildReportMonth,
  buildConnectDuplicateKey,
  missingAdSpendColumns,
  normalizeRawAdSpendRow,
  type AdSpendReportType,
  type AdSpendReportPeriod,
  type RawAdSpendImportRow,
  type ValidatedAdSpendImportRow,
  validateAdSpendRows
} from "@/lib/ad-spend-import";
import { AD_SPEND_UPLOAD_MAX_BYTES, AD_SPEND_UPLOAD_MAX_LABEL } from "@/lib/upload-limits";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganization } from "@/server/organizations/current";
import { toJsonValue, toArray, toRecord, readString, readNumber } from "@/server/imports/utils";

const CREATE_CHUNK_SIZE = 500;
const PREVIEW_ROW_LIMIT = 50;

export type AdSpendImportInput = {
  originalFileName: string;
  fileHash: string;
  reportType: AdSpendReportType;
  reportPeriod: AdSpendReportPeriod;
  rows: RawAdSpendImportRow[];
};

export type AdSpendImportResult = {
  ok: boolean;
  status: "IMPORTED" | "FAILED";
  message: string;
  importRunId?: string;
  reportTypeLabel: string;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  importedRows: number;
  updatedRows: number;
  errorCount: number;
  totalSpend: number;
  totalClicks: number;
  totalImpressions: number;
  totalAttributedSales: number;
  errors: Array<{
    rowNumber: number;
    message: string;
  }>;
  skippedMessages: Array<{
    rowNumber: number;
    message: string;
  }>;
  previewRows: ValidatedAdSpendImportRow[];
};

type ParsedAdSpendUpload =
  | { input: AdSpendImportInput }
  | { error: AdSpendImportResult };

export async function previewAdSpendFile(formData: FormData): Promise<AdSpendImportResult> {
  const parsed = await parseAdSpendUploadFormData(formData);
  if ("error" in parsed) {
    return parsed.error;
  }

  const reportTypeLabel = getReportTypeLabel(parsed.input.reportType);
  const validated = validateAdSpendRows(
    parsed.input.rows,
    parsed.input.reportPeriod,
    parsed.input.reportType
  );
  const validRows = validated.flatMap((result) => (result.row ? [result.row] : []));
  const errors = buildRowErrors(parsed.input.rows.length, validated);
  const skipped = buildSkippedMessages(validated);
  const organization = await getCurrentOrganization();
  const marketplace = getCurrentMarketplace();
  const importRun = await prisma.importRun.create({
    data: {
      organizationId: organization.id,
      marketplace,
      importKind: "advertising",
      reportType: parsed.input.reportType,
      reportTypeLabel,
      source: "upload",
      originalFileName: parsed.input.originalFileName,
      fileHash: parsed.input.fileHash,
      status: errors.length || !validRows.length ? "NEEDS_REVIEW" : "PENDING",
      rowCount: parsed.input.rows.length,
      validCount: validRows.length,
      rejectedCount: errors.length + skipped.length,
      options: toJsonValue({
        reportDate: parsed.input.reportPeriod.date,
        reportStartDate: parsed.input.reportPeriod.startDate,
        reportEndDate: parsed.input.reportPeriod.endDate,
        reportMonth: buildReportMonth(parsed.input.reportPeriod),
        reportType: parsed.input.reportType
      }),
      summary: toJsonValue(buildAdSpendSummary({
        reportType: parsed.input.reportType,
        reportTypeLabel,
        totalRows: parsed.input.rows.length,
        validRows,
        skippedRows: skipped.length,
        importedRows: 0,
        updatedRows: 0
      })),
      parsedPayload: toJsonValue(parsed.input),
      ...(errors.length || skipped.length
        ? {
            issues: {
              createMany: {
                data: [
                  ...errors.slice(0, 500).map((error) => ({
                    organizationId: organization.id,
                    rowNumber: error.rowNumber,
                    severity: "error",
                    code: "advertising_import_error",
                    message: error.message,
                    rawData: Prisma.JsonNull
                  })),
                  ...skipped.slice(0, 500).map((row) => ({
                    organizationId: organization.id,
                    rowNumber: row.rowNumber,
                    severity: "warning",
                    code: "advertising_import_skipped",
                    message: row.message,
                    rawData: Prisma.JsonNull
                  }))
                ]
              }
            }
          }
        : {}),
      ...(validRows.length
        ? {
            previewRows: {
              createMany: {
                data: validRows.slice(0, PREVIEW_ROW_LIMIT).map((row) => ({
                  organizationId: organization.id,
                  rowNumber: row.rowNumber,
                  status: "valid",
                  message: null,
                  rawData: { sourceRow: row.rowNumber },
                  normalizedData: row as unknown as Prisma.InputJsonValue
                }))
              }
            }
          }
        : {})
    },
    select: { id: true }
  });

  return {
    ok: !errors.length && validRows.length > 0,
    status: errors.length || !validRows.length ? "FAILED" : "IMPORTED",
    message:
      errors.length || !validRows.length
        ? "Ad spend preview found issues."
        : "Ad spend preview is ready to import.",
    importRunId: importRun.id,
    reportTypeLabel,
    totalRows: parsed.input.rows.length,
    validRows: validRows.length,
    skippedRows: skipped.length,
    importedRows: 0,
    updatedRows: 0,
    errorCount: errors.length,
    totalSpend: sumRows(validRows, (row) => row.spend),
    totalClicks: sumRows(validRows, (row) => row.clicks),
    totalImpressions: sumRows(validRows, (row) => row.impressions),
    totalAttributedSales: sumRows(validRows, (row) => row.attributedSales),
    errors,
    skippedMessages: skipped.slice(0, 100),
    previewRows: validRows.slice(0, PREVIEW_ROW_LIMIT)
  };
}

export async function importPreviewedAdSpendRows(formData: FormData): Promise<AdSpendImportResult> {
  const importRunId = String(formData.get("importRunId") ?? "").trim();
  const organization = await getCurrentOrganization();

  if (!importRunId) {
    return failedResult(0, 0, 0, [{ rowNumber: 0, message: "Preview the file before importing." }], "");
  }

  const importRun = await prisma.importRun.findFirst({
    where: {
      id: importRunId,
      organizationId: organization.id,
      importKind: "advertising"
    }
  });

  if (!importRun) {
    return failedResult(0, 0, 0, [{ rowNumber: 0, message: "Import preview was not found." }], "");
  }

  const input = decodeAdSpendImportInput(importRun.parsedPayload);
  if (input.reportType === AD_SOURCE_CONNECT && !input.rows.some((row) => "date" in row)) {
    return failedResult(
      input.rows.length,
      0,
      0,
      [
        {
          rowNumber: 0,
          message:
            "This preview was created before daily Date support was added. Choose the file and click Preview again, then Import the new preview."
        }
      ],
      getReportTypeLabel(input.reportType)
    );
  }

  return importAdSpendRows(input, importRun.id);
}

export async function importAdSpendRows(
  input: AdSpendImportInput,
  importRunId?: string
): Promise<AdSpendImportResult> {
  const marketplace = getCurrentMarketplace();
  const validated = validateAdSpendRows(input.rows, input.reportPeriod, input.reportType);
  const validRows = validated.flatMap((result) => (result.row ? [result.row] : []));
  const skippedRows = validated.filter((result) => result.skipped).length;
  const reportTypeLabel = getReportTypeLabel(input.reportType);
  const rowErrors = [
    ...(input.rows.length
      ? []
      : [{ rowNumber: 0, message: "The workbook did not contain any rows." }]),
    ...validated.flatMap((result) =>
      result.errors.map((message) => ({
        rowNumber: result.rowNumber,
        message
      }))
    )
  ];

  if (rowErrors.length || !validRows.length) {
    const organization = await getCurrentOrganization();
    await recordAdSpendImportRun({
      organizationId: organization.id,
      marketplace,
      input,
      reportTypeLabel,
      status: "FAILED",
      importRunId,
      totalRows: input.rows.length,
      validRows,
      skippedRows,
      importedRows: 0,
      updatedRows: 0,
      errors: rowErrors.length
        ? rowErrors
        : [
            {
              rowNumber: 0,
              message: "No importable advertising rows were found."
            }
          ],
      skipped: validated.filter((result) => result.skipped)
    });

    return {
      ...failedResult(
        input.rows.length,
        validRows.length,
        skippedRows,
        rowErrors.length
          ? rowErrors
          : [
              {
                rowNumber: 0,
                message: "No importable advertising rows were found."
              }
            ],
        reportTypeLabel
      ),
      importRunId,
      totalSpend: sumRows(validRows, (row) => row.spend),
      totalClicks: sumRows(validRows, (row) => row.clicks),
      totalImpressions: sumRows(validRows, (row) => row.impressions),
      totalAttributedSales: sumRows(validRows, (row) => row.attributedSales),
      skippedMessages: buildSkippedMessages(validated).slice(0, 100),
      previewRows: validRows.slice(0, PREVIEW_ROW_LIMIT)
    };
  }

  const organization = await getCurrentOrganization();
  let importedRows = 0;
  let updatedRows = 0;

  try {
    const parentSkuBySellerSku = await loadParentSkuMap({
      organizationId: organization.id,
      marketplace,
      sellerSkus: [...new Set(validRows.map((row) => row.sku))]
    });
    const existingRows = await loadExistingAdSpendRows({
      organizationId: organization.id,
      marketplace,
      source: input.reportType,
      rows: validRows
    });
    const existingByKey = new Map(
      existingRows.map((row) => [
        buildDatabaseDuplicateKey({
          reportDate: readReportDate(row.metadata) || formatReportDate(row.costDate),
          sku: row.sellerSku ?? "",
          campaignName: row.campaignName,
          itemId: readMetadataText(row.metadata, "itemId")
        }),
        row
      ])
    );
    const rowsToCreate: Prisma.AdvertisingCostCreateManyInput[] = [];

    for (const row of validRows) {
      const existing = existingByKey.get(
        buildDatabaseDuplicateKey({
          reportDate: row.reportDate,
          sku: row.sku,
          campaignName: row.campaignName,
          itemId: row.itemId
        })
      );
      const parentSku = parentSkuBySellerSku.get(row.sku) ?? null;

      if (existing) {
        await prisma.advertisingCost.update({
          where: { id: existing.id },
          data: buildAdvertisingCostUpdate({
            row,
            parentSku,
            originalFileName: input.originalFileName
          })
        });
        updatedRows += 1;
      } else {
        rowsToCreate.push(
          buildAdvertisingCostCreate({
            organizationId: organization.id,
            marketplace,
            row,
            parentSku,
            originalFileName: input.originalFileName
          })
        );
      }
    }

    for (const chunk of chunkRows(rowsToCreate, CREATE_CHUNK_SIZE)) {
      const created = await prisma.advertisingCost.createMany({
        data: chunk
      });
      importedRows += created.count;
    }

    await recordAdSpendImportRun({
      organizationId: organization.id,
      marketplace,
      input,
      reportTypeLabel,
      status: "IMPORTED",
      importRunId,
      totalRows: input.rows.length,
      validRows,
      skippedRows,
      importedRows,
      updatedRows,
      errors: [],
      skipped: validated.filter((result) => result.skipped)
    });
  } catch {
    return {
      ...failedResult(
        input.rows.length,
        validRows.length,
        skippedRows,
        [
          {
            rowNumber: 0,
            message: "The upload could not be saved. Check the database connection and migrations."
          }
        ],
        reportTypeLabel
      ),
      importRunId,
      totalSpend: sumRows(validRows, (row) => row.spend),
      totalClicks: sumRows(validRows, (row) => row.clicks),
      totalImpressions: sumRows(validRows, (row) => row.impressions),
      totalAttributedSales: sumRows(validRows, (row) => row.attributedSales),
      skippedMessages: buildSkippedMessages(validated).slice(0, 100),
      previewRows: validRows.slice(0, PREVIEW_ROW_LIMIT)
    };
  }

  revalidatePath("/pnl/sku");
  revalidatePath("/pnl/parent");

  return {
    ok: true,
    status: "IMPORTED",
    message: "Advertising import completed.",
    importRunId,
    reportTypeLabel,
    totalRows: input.rows.length,
    validRows: validRows.length,
    skippedRows,
    importedRows,
    updatedRows,
    errorCount: 0,
    totalSpend: sumRows(validRows, (row) => row.spend),
    totalClicks: sumRows(validRows, (row) => row.clicks),
    totalImpressions: sumRows(validRows, (row) => row.impressions),
    totalAttributedSales: sumRows(validRows, (row) => row.attributedSales),
    errors: [],
    skippedMessages: buildSkippedMessages(validated).slice(0, 100),
    previewRows: validRows.slice(0, PREVIEW_ROW_LIMIT)
  };
}

async function parseAdSpendUploadFormData(formData: FormData): Promise<ParsedAdSpendUpload> {
  const reportType = parseAdSpendReportType(formData.get("reportType"));
  const reportPeriod = {
    date: String(formData.get("reportDate") ?? "").trim(),
    startDate: String(formData.get("reportStartDate") ?? "").trim(),
    endDate: String(formData.get("reportEndDate") ?? "").trim(),
    month: String(formData.get("reportMonth") ?? "").trim(),
    year: String(formData.get("reportYear") ?? "").trim()
  };
  const reportTypeLabel = getReportTypeLabel(reportType);
  const file = formData.get("file");

  if (!isValidDateOnly(reportPeriod.startDate) || !isValidDateOnly(reportPeriod.endDate)) {
    return {
      error: failedResult(
        0,
        0,
        0,
        [{ rowNumber: 0, message: "Choose a valid reporting period before previewing." }],
        reportTypeLabel
      )
    };
  }

  if (reportPeriod.endDate < reportPeriod.startDate) {
    return {
      error: failedResult(
        0,
        0,
        0,
        [{ rowNumber: 0, message: "The reporting period end date must be on or after the start date." }],
        reportTypeLabel
      )
    };
  }

  if (!(file instanceof File) || file.size === 0) {
    return {
      error: failedResult(
        0,
        0,
        0,
        [{ rowNumber: 0, message: "Choose a Walmart Connect report to upload." }],
        reportTypeLabel
      )
    };
  }

  if (file.size > AD_SPEND_UPLOAD_MAX_BYTES) {
    return {
      error: failedResult(
        0,
        0,
        0,
        [
          {
            rowNumber: 0,
            message: `The selected file is too large. Maximum file size: ${AD_SPEND_UPLOAD_MAX_LABEL}.`
          }
        ],
        reportTypeLabel
      )
    };
  }

  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
    return {
      error: failedResult(
        0,
        0,
        0,
        [{ rowNumber: 0, message: "Upload a .csv, .xlsx, or .xls file." }],
        reportTypeLabel
      )
    };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet) {
      return {
        error: failedResult(
          0,
          0,
          0,
          [{ rowNumber: 0, message: "The file does not contain a worksheet." }],
          reportTypeLabel
        )
      };
    }

    const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: ""
    });
    const headers = (headerRows[0] ?? []).map((header) => String(header));
    const missingColumns = missingAdSpendColumns(headers, reportType);

    if (missingColumns.length) {
      return {
        error: failedResult(
          0,
          0,
          0,
          [{ rowNumber: 0, message: `Missing required columns: ${missingColumns.join(", ")}.` }],
          reportTypeLabel
        )
      };
    }

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: ""
    });
    const rows = rawRows
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(({ row }) => Object.values(row).some((value) => String(value ?? "").trim()))
      .map(({ row, rowNumber }) => normalizeRawAdSpendRow(row, rowNumber, reportType));

    return {
      input: {
        originalFileName: file.name,
        fileHash: createHash("sha256").update(buffer).digest("hex"),
        reportType,
        reportPeriod,
        rows
      }
    };
  } catch {
    return {
      error: failedResult(
        0,
        0,
        0,
        [{ rowNumber: 0, message: "The file could not be read. Confirm it is a valid CSV or Excel file." }],
        reportTypeLabel
      )
    };
  }
}

async function recordAdSpendImportRun({
  organizationId,
  marketplace,
  input,
  reportTypeLabel,
  status,
  importRunId,
  totalRows,
  validRows,
  skippedRows,
  importedRows,
  updatedRows,
  errors,
  skipped
}: {
  organizationId: string;
  marketplace: string;
  input: AdSpendImportInput;
  reportTypeLabel: string;
  status: "IMPORTED" | "FAILED";
  importRunId?: string;
  totalRows: number;
  validRows: ValidatedAdSpendImportRow[];
  skippedRows: number;
  importedRows: number;
  updatedRows: number;
  errors: Array<{ rowNumber: number; message: string }>;
  skipped: Array<{ rowNumber: number; skipReason?: string }>;
}) {
  const importRunData = {
    organizationId,
    marketplace,
    importKind: "advertising",
    reportType: input.reportType,
    reportTypeLabel,
    source: "upload",
    originalFileName: input.originalFileName || "advertising-upload",
    fileHash: input.fileHash || buildFallbackImportHash(input),
    status,
    rowCount: totalRows,
    validCount: validRows.length,
    importedCount: importedRows + updatedRows,
    rejectedCount: errors.length + skippedRows,
    importedAt: status === "IMPORTED" ? new Date() : null,
    options: {
      reportDate: input.reportPeriod.date,
      reportStartDate: input.reportPeriod.startDate,
      reportEndDate: input.reportPeriod.endDate,
      reportMonth: buildReportMonth(input.reportPeriod),
      reportType: input.reportType
    },
    summary: {
      reportType: input.reportType,
      reportTypeLabel,
      totalRows,
      validRows: validRows.length,
      skippedRows,
      importedRows,
      updatedRows,
      totalSpend: sumRows(validRows, (row) => row.spend),
      totalClicks: sumRows(validRows, (row) => row.clicks),
      totalImpressions: sumRows(validRows, (row) => row.impressions),
      totalAttributedSales: sumRows(validRows, (row) => row.attributedSales)
    },
    parsedPayload: toJsonValue(input)
  };
  const importRun = importRunId
    ? await prisma.importRun.update({
        where: { id: importRunId },
        data: importRunData,
        select: { id: true }
      })
    : await prisma.importRun.create({
        data: importRunData,
        select: { id: true }
      });

  const issues = [
    ...errors.map((error) => ({
      organizationId,
      importRunId: importRun.id,
      rowNumber: error.rowNumber,
      severity: "error",
      code: "advertising_import_error",
      message: error.message,
      rawData: Prisma.JsonNull
    })),
    ...skipped.map((row) => ({
      organizationId,
      importRunId: importRun.id,
      rowNumber: row.rowNumber,
      severity: "warning",
      code: "advertising_import_skipped",
      message: row.skipReason ?? "Row skipped.",
      rawData: Prisma.JsonNull
    }))
  ];

  await prisma.importRunIssue.deleteMany({
    where: { organizationId, importRunId: importRun.id }
  });
  await prisma.importRunPreviewRow.deleteMany({
    where: { organizationId, importRunId: importRun.id }
  });

  if (issues.length) {
    await prisma.importRunIssue.createMany({
      data: issues.slice(0, 500)
    });
  }

  if (validRows.length) {
    await prisma.importRunPreviewRow.createMany({
        data: validRows.slice(0, PREVIEW_ROW_LIMIT).map((row) => ({
        organizationId,
        importRunId: importRun.id,
        rowNumber: row.rowNumber,
        status: "valid",
        message: null,
        rawData: { sourceRow: row.rowNumber },
        normalizedData: row as unknown as Prisma.InputJsonValue
      }))
    });
  }
}

async function loadParentSkuMap({
  organizationId,
  marketplace,
  sellerSkus
}: {
  organizationId: string;
  marketplace: string;
  sellerSkus: string[];
}) {
  const parentSkuBySellerSku = new Map<string, string | null>();

  if (!sellerSkus.length) {
    return parentSkuBySellerSku;
  }

  const [listings, products] = await Promise.all([
    prisma.listing.findMany({
      where: {
        organizationId,
        marketplace,
        sellerSku: { in: sellerSkus }
      },
      select: { sellerSku: true, parentSku: true }
    }),
    prisma.product.findMany({
      where: {
        organizationId,
        internalSku: { in: sellerSkus }
      },
      select: { internalSku: true, parentSku: true }
    })
  ]);

  for (const product of products) {
    if (product.internalSku) {
      parentSkuBySellerSku.set(product.internalSku, product.parentSku);
    }
  }

  for (const listing of listings) {
    parentSkuBySellerSku.set(listing.sellerSku, listing.parentSku);
  }

  return parentSkuBySellerSku;
}

async function loadExistingAdSpendRows({
  organizationId,
  marketplace,
  source,
  rows
}: {
  organizationId: string;
  marketplace: string;
  source: AdSpendReportType;
  rows: ValidatedAdSpendImportRow[];
}) {
  const sellerSkus = [...new Set(rows.map((row) => row.sku).filter(Boolean))];
  const costDates = [...new Set(rows.map((row) => new Date(row.costDate).toISOString()))].map(
    (date) => new Date(date)
  );

  if (!costDates.length) {
    return [];
  }

  return prisma.advertisingCost.findMany({
    where: {
      organizationId,
      marketplace,
      source,
      ...(sellerSkus.length
        ? { OR: [{ sellerSku: { in: sellerSkus } }, { sellerSku: null }] }
        : { sellerSku: null }),
      costDate: { in: costDates }
    },
    select: {
      id: true,
      sellerSku: true,
      campaignName: true,
      costDate: true,
      metadata: true
    }
  });
}

function buildAdvertisingCostCreate({
  organizationId,
  marketplace,
  row,
  parentSku,
  originalFileName
}: {
  organizationId: string;
  marketplace: string;
  row: ValidatedAdSpendImportRow;
  parentSku: string | null;
  originalFileName: string;
}): Prisma.AdvertisingCostCreateManyInput {
  return {
    organizationId,
    marketplace,
    source: row.reportType,
    sellerSku: row.sku || null,
    parentSku,
    campaignId: null,
    campaignName: row.campaignName || null,
    costDate: new Date(row.costDate),
    amount: row.spend,
    currency: row.currency,
    metadata: buildMetadata({ row, originalFileName })
  };
}

function buildAdvertisingCostUpdate({
  row,
  parentSku,
  originalFileName
}: {
  row: ValidatedAdSpendImportRow;
  parentSku: string | null;
  originalFileName: string;
}): Prisma.AdvertisingCostUpdateInput {
  return {
    amount: row.spend,
    currency: row.currency,
    parentSku,
    campaignId: null,
    campaignName: row.campaignName || null,
    costDate: new Date(row.costDate),
    metadata: buildMetadata({ row, originalFileName })
  };
}

function buildMetadata({
  row,
  originalFileName
}: {
  row: ValidatedAdSpendImportRow;
  originalFileName: string;
}): Prisma.InputJsonValue {
  return {
    source: row.reportType,
    reportType: getReportTypeLabel(row.reportType),
    reportMonth: row.reportMonth,
    reportDate: row.reportDate,
    date: row.reportDate,
    grain: "daily",
    reportGrain: "daily",
    originalFileName,
    sourceRow: row.rowNumber,
    itemId: row.itemId,
    itemName: row.itemName,
    campaignName: row.campaignName,
    campaignType: row.campaignType,
    clicks: row.clicks,
    impressions: row.impressions,
    attributedOrders: row.attributedOrders,
    attributedSales: row.attributedSales,
    attributedUnits: row.attributedUnits,
    averageCpc: row.averageCpc,
    roas: row.roas,
    duplicateKey: row.duplicateKey
  };
}

function buildDatabaseDuplicateKey({
  reportDate,
  sku,
  campaignName,
  itemId
}: {
  reportDate: string;
  sku: string;
  campaignName: string | null;
  itemId: string;
}) {
  return buildConnectDuplicateKey({
    reportDate,
    sku,
    campaignName: campaignName ?? "",
    itemId
  });
}

function readReportDate(metadata: unknown) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const reportDate = (metadata as Record<string, unknown>).reportDate;
    return typeof reportDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reportDate)
      ? reportDate
      : "";
  }

  return "";
}

function readMetadataText(metadata: unknown, key: string) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }

  return "";
}

function getReportTypeLabel(reportType: AdSpendReportType) {
  return adSpendReportTypes.find((report) => report.value === reportType)?.label ?? reportType;
}

function buildReportMonthFromString(value: string) {
  const [year, month] = value.split("-");
  return buildReportMonth({ year, month });
}

function formatReportDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatReportMonth(date: Date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function failedResult(
  totalRows: number,
  validRows: number,
  skippedRows: number,
  errors: Array<{ rowNumber: number; message: string }>,
  reportTypeLabel: string
): AdSpendImportResult {
  return {
    ok: false,
    status: "FAILED",
    message: "Ad spend import failed validation.",
    reportTypeLabel,
    totalRows,
    validRows,
    skippedRows,
    importedRows: 0,
    updatedRows: 0,
    errorCount: errors.length,
    totalSpend: 0,
    totalClicks: 0,
    totalImpressions: 0,
    totalAttributedSales: 0,
    errors,
    skippedMessages: [],
    previewRows: []
  };
}

function buildRowErrors(
  sourceRowCount: number,
  validated: ReturnType<typeof validateAdSpendRows>
) {
  return [
    ...(sourceRowCount
      ? []
      : [{ rowNumber: 0, message: "The workbook did not contain any rows." }]),
    ...validated.flatMap((result) =>
      result.errors.map((message) => ({
        rowNumber: result.rowNumber,
        message
      }))
    )
  ];
}

function buildSkippedMessages(validated: ReturnType<typeof validateAdSpendRows>) {
  return validated
    .filter((result) => result.skipped)
    .map((result) => ({
      rowNumber: result.rowNumber,
      message: result.skipReason ?? "Row skipped."
    }));
}

function buildAdSpendSummary({
  reportType,
  reportTypeLabel,
  totalRows,
  validRows,
  skippedRows,
  importedRows,
  updatedRows
}: {
  reportType: AdSpendReportType;
  reportTypeLabel: string;
  totalRows: number;
  validRows: ValidatedAdSpendImportRow[];
  skippedRows: number;
  importedRows: number;
  updatedRows: number;
}) {
  return {
    reportType,
    reportTypeLabel,
    totalRows,
    validRows: validRows.length,
    skippedRows,
    importedRows,
    updatedRows,
    totalSpend: sumRows(validRows, (row) => row.spend),
    totalClicks: sumRows(validRows, (row) => row.clicks),
    totalImpressions: sumRows(validRows, (row) => row.impressions),
    totalAttributedSales: sumRows(validRows, (row) => row.attributedSales)
  };
}

function parseAdSpendReportType(value: FormDataEntryValue | null): AdSpendReportType {
  return value === AD_SOURCE_CONNECT ? value : AD_SOURCE_CONNECT;
}

function decodeAdSpendImportInput(payload: Prisma.JsonValue | null): AdSpendImportInput {
  const record = toRecord(payload);
  const reportPeriod = toRecord(record.reportPeriod as Prisma.JsonValue);

  return {
    originalFileName: readString(record.originalFileName) || "advertising-upload",
    fileHash: readString(record.fileHash),
    reportType: readString(record.reportType) === AD_SOURCE_CONNECT ? AD_SOURCE_CONNECT : AD_SOURCE_CONNECT,
    reportPeriod: {
      date: readString(reportPeriod.date),
      startDate: readString(reportPeriod.startDate),
      endDate: readString(reportPeriod.endDate),
      month: readString(reportPeriod.month),
      year: readString(reportPeriod.year)
    },
    rows: toArray(record.rows).map((value) => decodeRawAdSpendRow(value))
  };
}

function decodeRawAdSpendRow(value: unknown): RawAdSpendImportRow {
  const row = toRecord(value as Prisma.JsonValue);

  return {
    rowNumber: Math.trunc(readNumber(row.rowNumber)),
    date: row.date,
    sku_id: row.sku_id,
    item_id: row.item_id,
    item_name: row.item_name,
    campaign_name: row.campaign_name,
    campaign_type: row.campaign_type,
    ad_spend: row.ad_spend,
    clicks: row.clicks,
    impressions: row.impressions,
    orders: row.orders,
    total_attributed_sales: row.total_attributed_sales,
    units_sold: row.units_sold,
    average_cpc: row.average_cpc,
    roas: row.roas
  };
}

function sumRows(
  rows: ValidatedAdSpendImportRow[],
  getValue: (row: ValidatedAdSpendImportRow) => number
) {
  return rows.reduce((sum, row) => sum + getValue(row), 0);
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function buildFallbackImportHash(input: AdSpendImportInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        originalFileName: input.originalFileName,
        reportType: input.reportType,
        reportPeriod: input.reportPeriod,
        rows: input.rows
      })
    )
    .digest("hex");
}
