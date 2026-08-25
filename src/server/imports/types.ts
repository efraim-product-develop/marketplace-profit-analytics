import type { Prisma } from "@prisma/client";

export type ImportKind = "sales" | "settlements" | "advertising" | "inventory";

export type ImportParserContext = {
  marketplace: string;
  importKind: ImportKind;
  fileName: string;
  buffer: Buffer;
  options: ImportParseOptions;
};

export type ImportCommitContext = {
  organizationId: string;
  importRunId: string;
  marketplace: string;
  originalFileName: string;
  options: ImportParseOptions;
};

export type ImportParseOptions = {
  reportMonth?: string;
  reportDate?: string;
  reportStartDate?: string;
  reportEndDate?: string;
  createMissingCatalog?: boolean;
  activateForPnl?: boolean;
  importSource?: string;
};

export type ParsedImportIssue = {
  row: number;
  code: string;
  message: string;
  severity?: "error" | "warning";
  rawData?: Record<string, unknown>;
};

export type ParsedImportPreviewRow = {
  rowNumber: number;
  status: "valid" | "error" | "warning";
  message?: string;
  rawData?: Record<string, unknown>;
  normalizedData?: Record<string, unknown>;
};

export type ParsedImportReport = {
  importKind: ImportKind;
  reportType: string;
  reportTypeLabel: string;
  rowCount: number;
  validCount: number;
  rejectedCount: number;
  issues: ParsedImportIssue[];
  previewRows: ParsedImportPreviewRow[];
  summary: Record<string, unknown>;
  payload: Prisma.InputJsonValue;
  duplicateVersion?: string;
  allowDuplicateFileImport?: boolean;
};

export type ImportCommitResult = {
  importedCount: number;
  summary?: Record<string, unknown>;
};

export type ImportReportParser = {
  importKind: ImportKind;
  reportType: string;
  reportTypeLabel: string;
  detect: (context: ImportParserContext) => number;
  parse: (context: ImportParserContext) => ParsedImportReport;
  commit?: (
    context: ImportCommitContext,
    payload: Prisma.JsonValue
  ) => Promise<ImportCommitResult>;
};

export type ImportKindConfig = {
  kind: ImportKind;
  title: string;
  eyebrow: string;
  description: string;
  fileHelp: string;
};
