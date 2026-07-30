import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { listMarketplaceImportParsers } from "@/server/connectors/registry";
import { importDb } from "@/server/imports/db";
import type {
  ImportCommitResult,
  ImportKind,
  ImportKindConfig,
  ImportParseOptions,
  ImportReportParser,
  ParsedImportIssue,
  ParsedImportPreviewRow
} from "@/server/imports/types";
import { toJsonValue, toRecord } from "@/server/imports/utils";

const PREVIEW_ROW_LIMIT = 100;

export const importKindConfigs: Record<ImportKind, ImportKindConfig> = {
  sales: {
    kind: "sales",
    eyebrow: "Imports",
    title: "Sales Reports",
    description: "Upload daily marketplace sales reports, preview detected rows, then import them into P&L.",
    fileHelp: "Supports Walmart daily Item Sales reports. PO/order reports remain available for audit imports."
  },
  settlements: {
    kind: "settlements",
    eyebrow: "Imports",
    title: "Settlement Reports",
    description: "Upload marketplace settlement reports through the shared import pipeline.",
    fileHelp: "Supports Walmart Payments New reports for fulfillment fees, settlement fees, and SEM spend."
  },
  advertising: {
    kind: "advertising",
    eyebrow: "Imports",
    title: "Advertising Reports",
    description: "Upload advertising reports through the shared import pipeline.",
    fileHelp: "Ready for future advertising report parsers."
  },
  inventory: {
    kind: "inventory",
    eyebrow: "Imports",
    title: "Inventory Reports",
    description: "Upload inventory reports through the shared import pipeline.",
    fileHelp: "Ready for future inventory report parsers."
  }
};

export async function createImportPreview({
  organizationId,
  marketplace,
  importKind,
  originalFileName,
  buffer,
  options
}: {
  organizationId: string;
  marketplace: string;
  importKind: ImportKind;
  originalFileName: string;
  buffer: Buffer;
  options: ImportParseOptions;
}) {
  const fileHash = hashBuffer(buffer);
  const parser = findParser({ marketplace, importKind, originalFileName, buffer, options });

  if (!parser) {
    return createUnsupportedImportRun({
      organizationId,
      marketplace,
      importKind,
      originalFileName,
      fileHash,
      options
    });
  }

  const parsed = parser.parse({
    marketplace,
    importKind,
    fileName: originalFileName,
    buffer,
    options
  });

  const duplicate = await findDuplicateImport({
    organizationId,
    marketplace,
    importKind,
    reportType: parsed.reportType,
    fileHash
  });

  if (duplicate && shouldBlockDuplicateImport(duplicate, parsed.duplicateVersion)) {
    const previewRows = buildPreviewRowData(organizationId, parsed.previewRows);
    return importDb.importRun.create({
      data: {
        organizationId,
        marketplace,
        importKind,
        reportType: parsed.reportType,
        reportTypeLabel: parsed.reportTypeLabel,
        originalFileName,
        fileHash,
        status: "FAILED",
        rowCount: parsed.rowCount,
        validCount: parsed.validCount,
        rejectedCount: parsed.rejectedCount + 1,
        duplicateOfId: duplicate.id,
        options: toJsonValue(options),
        summary: toJsonValue({
          ...parsed.summary,
          ...(parsed.duplicateVersion ? { duplicateVersion: parsed.duplicateVersion } : {}),
          duplicateOf: duplicate.id
        }),
        parsedPayload: parsed.payload,
        issues: {
          create: {
            organizationId,
            rowNumber: 0,
            severity: "error",
            code: "DUPLICATE_IMPORT",
            message: `This file was already imported on ${duplicate.createdAt.toLocaleString("en-US")}.`
          }
        },
        ...(previewRows.length ? { previewRows: { createMany: { data: previewRows } } } : {})
      }
    });
  }

  const issues = parsed.issues.map((issue) => ({
    organizationId,
    rowNumber: issue.row,
    severity: issue.severity ?? "error",
    code: issue.code,
    message: issue.message,
    rawData: issue.rawData ? toJsonValue(issue.rawData) : undefined
  }));
  const previewRows = buildPreviewRowData(organizationId, parsed.previewRows);

  return importDb.importRun.create({
    data: {
      organizationId,
      marketplace,
      importKind,
      reportType: parsed.reportType,
      reportTypeLabel: parsed.reportTypeLabel,
      originalFileName,
      fileHash,
      status: "PENDING",
      rowCount: parsed.rowCount,
      validCount: parsed.validCount,
      rejectedCount: parsed.rejectedCount,
      options: toJsonValue(options),
      summary: toJsonValue({
        ...parsed.summary,
        ...(parsed.duplicateVersion ? { duplicateVersion: parsed.duplicateVersion } : {})
      }),
      parsedPayload: parsed.payload,
      ...(issues.length ? { issues: { createMany: { data: issues } } } : {}),
      ...(previewRows.length ? { previewRows: { createMany: { data: previewRows } } } : {})
    }
  });
}

export async function commitImportRun({
  organizationId,
  importRunId
}: {
  organizationId: string;
  importRunId: string;
}) {
  const importRun = await importDb.importRun.findFirst({
    where: { id: importRunId, organizationId }
  });

  if (!importRun) {
    throw new Error("Import run not found.");
  }

  if (importRun.status !== "PENDING") {
    return importRun;
  }

  const duplicate = await findDuplicateImport({
    organizationId,
    marketplace: importRun.marketplace,
    importKind: importRun.importKind as ImportKind,
    reportType: importRun.reportType,
    fileHash: importRun.fileHash,
    excludeId: importRun.id
  });

  const duplicateVersion = optionalString(toRecord(importRun.summary).duplicateVersion);

  if (duplicate && shouldBlockDuplicateImport(duplicate, duplicateVersion)) {
    return importDb.importRun.update({
      where: { id: importRun.id },
      data: {
        status: "FAILED",
        duplicateOfId: duplicate.id,
        rejectedCount: importRun.rejectedCount + 1,
        issues: {
          create: {
            organizationId,
            rowNumber: 0,
            severity: "error",
            code: "DUPLICATE_IMPORT",
            message: `This file was already imported on ${duplicate.createdAt.toLocaleString("en-US")}.`
          }
        }
      }
    });
  }

  const parser = findParserByReportType({
    marketplace: importRun.marketplace,
    importKind: importRun.importKind as ImportKind,
    reportType: importRun.reportType
  });

  let commitResult: ImportCommitResult = { importedCount: importRun.validCount };

  if (parser?.commit) {
    commitResult = await parser.commit(
      {
        organizationId,
        importRunId: importRun.id,
        marketplace: importRun.marketplace,
        originalFileName: importRun.originalFileName,
        options: toRecord(importRun.options) as ImportParseOptions
      },
      importRun.parsedPayload ?? {}
    );
  }

  const mergedSummary = {
    ...toRecord(importRun.summary),
    ...(commitResult.summary ?? {})
  };

  return importDb.importRun.update({
    where: { id: importRun.id },
    data: {
      status:
        commitResult.importedCount <= 0
          ? "FAILED"
          : importRun.rejectedCount > 0
            ? "NEEDS_REVIEW"
            : "IMPORTED",
      importedCount: commitResult.importedCount,
      importedAt: new Date(),
      summary: toJsonValue(mergedSummary)
    }
  });
}

function findParser({
  marketplace,
  importKind,
  originalFileName,
  buffer,
  options
}: {
  marketplace: string;
  importKind: ImportKind;
  originalFileName: string;
  buffer: Buffer;
  options: ImportParseOptions;
}) {
  const context = {
    marketplace,
    importKind,
    fileName: originalFileName,
    buffer,
    options
  };

  return listMarketplaceImportParsers(marketplace)
    .filter((parser) => parser.importKind === importKind)
    .map((parser) => ({ parser, score: parser.detect(context) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.parser;
}

function shouldBlockDuplicateImport(
  duplicate: { summary: Prisma.JsonValue | null },
  duplicateVersion?: string
) {
  if (!duplicateVersion) {
    return true;
  }

  return optionalString(toRecord(duplicate.summary).duplicateVersion) === duplicateVersion;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function findParserByReportType({
  marketplace,
  importKind,
  reportType
}: {
  marketplace: string;
  importKind: ImportKind;
  reportType: string;
}) {
  return listMarketplaceImportParsers(marketplace).find(
    (parser) => parser.importKind === importKind && parser.reportType === reportType
  );
}

async function createUnsupportedImportRun({
  organizationId,
  marketplace,
  importKind,
  originalFileName,
  fileHash,
  options
}: {
  organizationId: string;
  marketplace: string;
  importKind: ImportKind;
  originalFileName: string;
  fileHash: string;
  options: ImportParseOptions;
}) {
  return importDb.importRun.create({
    data: {
      organizationId,
      marketplace,
      importKind,
      reportType: "unsupported",
      reportTypeLabel: "Unsupported report",
      originalFileName,
      fileHash,
      status: "FAILED",
      rowCount: 0,
      validCount: 0,
      rejectedCount: 1,
      options: toJsonValue(options),
      summary: toJsonValue({
        message: "No parser matched this file yet."
      }),
      issues: {
        create: {
          organizationId,
          rowNumber: 0,
          severity: "error",
          code: "UNSUPPORTED_REPORT",
          message:
            "This report type is not supported yet. Add a parser in the marketplace connector to enable it."
        }
      }
    }
  });
}

function buildPreviewRowData(
  organizationId: string,
  previewRows: ParsedImportPreviewRow[]
) {
  return previewRows.slice(0, PREVIEW_ROW_LIMIT).map((row) => ({
    organizationId,
    rowNumber: row.rowNumber,
    status: row.status,
    message: row.message,
    rawData: row.rawData ? toJsonValue(row.rawData) : undefined,
    normalizedData: row.normalizedData ? toJsonValue(row.normalizedData) : undefined
  }));
}

async function findDuplicateImport({
  organizationId,
  marketplace,
  importKind,
  reportType,
  fileHash,
  excludeId
}: {
  organizationId: string;
  marketplace: string;
  importKind: ImportKind;
  reportType: string;
  fileHash: string;
  excludeId?: string;
}) {
  return importDb.importRun.findFirst({
    where: {
      organizationId,
      marketplace,
      importKind,
      reportType,
      fileHash,
      status: { in: ["PENDING", "IMPORTED", "NEEDS_REVIEW"] },
      ...(excludeId ? { id: { not: excludeId } } : {})
    },
    orderBy: { createdAt: "desc" }
  });
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
