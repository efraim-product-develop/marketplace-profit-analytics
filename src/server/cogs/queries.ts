import { prisma } from "@/lib/db";
import { getCurrentOrganizationId } from "@/server/organizations/current";

export type CostAuditRow = {
  id: string;
  sellerSku: string;
  parentSku: string;
  parentProduct: string;
  shipmentId: string;
  variationName: string;
  unitCogs: number;
  inboundFreightPerUnit: number;
  prepCostPerUnit: number;
  packagingCostPerUnit: number;
  unitCost: number;
  currency: string;
  effectiveDate: string;
  isActiveNow: boolean;
  notes: string;
};

export type CostUploadHistoryRow = {
  id: string;
  marketplace: string;
  originalFileName: string;
  status: string;
  rowCount: number;
  importedCount: number;
  rejectedCount: number;
  issueCount: number;
  batchCount: number;
  createdAt: string;
};

export type CostUploadIssueRow = {
  id: string;
  uploadFileName: string;
  rowNumber: number;
  severity: string;
  code: string;
  message: string;
  createdAt: string;
};

export type CostAuditData = {
  rows: CostAuditRow[];
  uploads: CostUploadHistoryRow[];
  issues: CostUploadIssueRow[];
};

export async function getCostAuditData(marketplace?: string): Promise<CostAuditData> {
  const organizationId = await getCurrentOrganizationId();
  const [records, uploads, issues] = await Promise.all([
    prisma.costRecord.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {})
      },
      include: { upload: true, product: true, listing: true, batch: true },
      orderBy: [
        { sellerSku: "asc" },
        { effectiveDate: "desc" },
        { updatedAt: "desc" },
        { createdAt: "desc" }
      ],
      take: 1000
    }),
    prisma.costUpload.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {})
      },
      include: { _count: { select: { issues: true, batches: true } } },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.costUploadIssue.findMany({
      where: {
        organizationId,
        ...(marketplace ? { upload: { marketplace } } : {})
      },
      include: { upload: true },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);

  const parentSkus = Array.from(
    new Set(records.map((record) => record.parentSku).filter((sku): sku is string => Boolean(sku)))
  );
  const parentProducts = parentSkus.length
    ? await prisma.product.findMany({
        where: { organizationId, internalSku: { in: parentSkus } },
        select: { internalSku: true, title: true }
      })
    : [];
  const parentProductTitleBySku = new Map(
    parentProducts.map((product) => [product.internalSku, product.title])
  );

  const now = new Date();
  const activeRecordIds = new Set<string>();
  const activeSkuKeys = new Set<string>();
  for (const record of records) {
    if (record.status !== "ACTIVE" || record.effectiveDate > now) {
      continue;
    }

    if (!activeSkuKeys.has(record.sellerSku)) {
      activeSkuKeys.add(record.sellerSku);
      activeRecordIds.add(record.id);
    }
  }

  return {
    rows: records.map((record) => ({
      id: record.id,
      sellerSku: record.sellerSku,
      parentSku: record.parentSku ?? "Unassigned",
      parentProduct:
        record.productName ??
        parentProductTitleBySku.get(record.parentSku ?? "") ??
        record.parentSku ??
        "Unassigned",
      shipmentId: record.shipmentId ?? record.batch?.shipmentId ?? "Unassigned",
      variationName: record.variationName ?? record.listing?.title ?? "Unassigned",
      unitCogs: toNumber(record.unitCogs),
      inboundFreightPerUnit: toNumber(record.inboundFreightPerUnit),
      prepCostPerUnit: toNumber(record.prepCostPerUnit),
      packagingCostPerUnit: toNumber(record.packagingCostPerUnit),
      unitCost: toNumber(record.unitCost),
      currency: record.currency,
      effectiveDate: record.effectiveDate.toISOString(),
      isActiveNow: activeRecordIds.has(record.id),
      notes: record.notes ?? ""
    })),
    uploads: uploads.map((upload) => ({
      id: upload.id,
      marketplace: upload.marketplace ?? "unassigned",
      originalFileName: upload.originalFileName,
      status: upload.status,
      rowCount: upload.rowCount,
      importedCount: upload.importedCount,
      rejectedCount: upload.rejectedCount,
      issueCount: upload._count.issues,
      batchCount: upload._count.batches,
      createdAt: upload.createdAt.toISOString()
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      uploadFileName: issue.upload.originalFileName,
      rowNumber: issue.rowNumber,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      createdAt: issue.createdAt.toISOString()
    }))
  };
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }

  return 0;
}
