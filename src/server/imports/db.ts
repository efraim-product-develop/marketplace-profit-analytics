import type { ImportStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ImportRunIssueRecord = {
  id: string;
  organizationId: string;
  importRunId: string;
  rowNumber: number;
  severity: string;
  code: string;
  message: string;
  rawData: Prisma.JsonValue | null;
  createdAt: Date;
};

export type ImportRunPreviewRowRecord = {
  id: string;
  organizationId: string;
  importRunId: string;
  rowNumber: number;
  status: string;
  message: string | null;
  rawData: Prisma.JsonValue | null;
  normalizedData: Prisma.JsonValue | null;
  createdAt: Date;
};

export type ImportRunRecord = {
  id: string;
  organizationId: string;
  marketplace: string;
  importKind: string;
  reportType: string;
  reportTypeLabel: string;
  source: string;
  originalFileName: string;
  fileHash: string;
  status: ImportStatus;
  rowCount: number;
  validCount: number;
  importedCount: number;
  rejectedCount: number;
  duplicateOfId: string | null;
  options: Prisma.JsonValue | null;
  summary: Prisma.JsonValue | null;
  parsedPayload: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  importedAt: Date | null;
};

export type ImportRunHistoryRecord = ImportRunRecord & {
  _count: { issues: number };
};

export type ImportRunDetailRecord = ImportRunRecord & {
  issues: ImportRunIssueRecord[];
  previewRows: ImportRunPreviewRowRecord[];
};

type ImportRunDelegate = {
  create(args: unknown): Promise<ImportRunRecord>;
  findFirst(args: unknown): Promise<ImportRunRecord | null>;
  findUnique(args: unknown): Promise<(ImportRunRecord & { issues: ImportRunIssueRecord[] }) | null>;
  findMany(args: unknown): Promise<ImportRunHistoryRecord[]>;
  update(args: unknown): Promise<ImportRunRecord>;
};

export const importDb = prisma as unknown as {
  importRun: ImportRunDelegate;
};
