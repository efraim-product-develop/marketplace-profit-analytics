import { importDb, type ImportRunDetailRecord } from "@/server/imports/db";
import { getCurrentOrganizationId } from "@/server/organizations/current";
import type { ImportKind } from "@/server/imports/types";

export async function getImportHistory(importKind: ImportKind, marketplace?: string) {
  const organizationId = await getCurrentOrganizationId();

  return importDb.importRun.findMany({
    where: {
      organizationId,
      importKind,
      ...(marketplace ? { marketplace } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      _count: {
        select: { issues: true }
      }
    }
  });
}

export async function getImportRun(importKind: ImportKind, importRunId: string, marketplace?: string) {
  const organizationId = await getCurrentOrganizationId();

  return importDb.importRun.findFirst({
    where: {
      id: importRunId,
      organizationId,
      importKind,
      ...(marketplace ? { marketplace } : {})
    },
    include: {
      issues: {
        orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
        take: 200
      },
      previewRows: {
        orderBy: [{ rowNumber: "asc" }, { createdAt: "asc" }],
        take: 100
      }
    }
  }) as Promise<ImportRunDetailRecord | null>;
}
