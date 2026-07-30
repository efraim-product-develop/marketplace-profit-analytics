"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type RawCogsImportRow,
  type ValidatedCogsImportRow,
  validateCogsRows
} from "@/lib/cogs-import";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganization } from "@/server/organizations/current";

const COGS_IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;
const COGS_IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000;

export type CogsImportInput = {
  originalFileName: string;
  rows: RawCogsImportRow[];
};

export type CogsImportResult = {
  ok: boolean;
  uploadId?: string;
  status: "IMPORTED" | "NEEDS_REVIEW" | "FAILED";
  message: string;
  totalRows: number;
  importedRows: number;
  createdRows: number;
  updatedRows: number;
  batchCount: number;
  errorCount: number;
  errors: Array<{
    rowNumber: number;
    message: string;
  }>;
};

export async function importCogsRows(input: CogsImportInput): Promise<CogsImportResult> {
  const marketplace = getCurrentMarketplace();
  const originalFileName = input.originalFileName.trim() || "COGS upload.xlsx";
  const validated = validateCogsRows(input.rows);
  const validRows = validated.flatMap((result) => (result.row ? [result.row] : []));
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

  const organization = await getCurrentOrganization();

  const upload = await prisma.$transaction(
    async (tx) => {
      const createdUpload = await tx.costUpload.create({
        data: {
          organizationId: organization.id,
          marketplace,
          originalFileName,
          status: rowErrors.length ? "FAILED" : "PENDING",
          rowCount: input.rows.length,
          importedCount: 0,
          rejectedCount: rowErrors.length
        }
      });

      if (rowErrors.length) {
        await tx.costUploadIssue.createMany({
          data: rowErrors.map((error) => ({
            organizationId: organization.id,
            uploadId: createdUpload.id,
            rowNumber: error.rowNumber,
            severity: "error",
            code: "VALIDATION_ERROR",
            message: error.message,
            rawData: toJsonValue(input.rows.find((row) => row.rowNumber === error.rowNumber))
          }))
        });

        return {
          id: createdUpload.id,
          importedRows: 0,
          createdRows: 0,
          updatedRows: 0,
          batchCount: 0,
          status: "FAILED" as const
        };
      }

      const importStats = await importValidRows({
        tx,
        organizationId: organization.id,
        uploadId: createdUpload.id,
        marketplace,
        rows: validRows
      });

      const updatedUpload = await tx.costUpload.update({
        where: { id: createdUpload.id },
        data: {
          status: "IMPORTED",
          importedCount: importStats.importedRows,
          rejectedCount: 0
        }
      });

      return {
        id: updatedUpload.id,
        status: "IMPORTED" as const,
        ...importStats
      };
    },
    {
      maxWait: COGS_IMPORT_TRANSACTION_MAX_WAIT_MS,
      timeout: COGS_IMPORT_TRANSACTION_TIMEOUT_MS
    }
  );

  revalidatePath("/cogs/audit");
  revalidatePath("/pnl/sku");
  revalidatePath("/pnl/parent");

  return {
    ok: upload.status === "IMPORTED",
    uploadId: upload.id,
    status: upload.status,
    message:
      upload.status === "IMPORTED" ? "COGS import completed." : "COGS import failed validation.",
    totalRows: input.rows.length,
    importedRows: upload.importedRows,
    createdRows: upload.createdRows,
    updatedRows: upload.updatedRows,
    batchCount: upload.batchCount,
    errorCount: rowErrors.length,
    errors: rowErrors
  };
}

async function importValidRows({
  tx,
  organizationId,
  uploadId,
  marketplace,
  rows
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  uploadId: string;
  marketplace: string;
  rows: ValidatedCogsImportRow[];
}) {
  let createdRows = 0;
  let updatedRows = 0;
  const batchIds = new Set<string>();

  for (const row of rows) {
    const batch = await tx.cogsBatch.upsert({
      where: {
        organizationId_marketplace_shipmentId: {
          organizationId,
          marketplace,
          shipmentId: row.shipmentId
        }
      },
      update: {
        uploadId,
        notes: row.notes || undefined
      },
      create: {
        organizationId,
        uploadId,
        marketplace,
        shipmentId: row.shipmentId,
        notes: row.notes || undefined
      }
    });
    batchIds.add(batch.id);

    const existingSkuProduct = await tx.product.findUnique({
      where: {
        organizationId_internalSku: {
          organizationId,
          internalSku: row.sku
        }
      }
    });
    const existingListing = await tx.listing.findUnique({
      where: {
        organizationId_marketplace_sellerSku: {
          organizationId,
          marketplace,
          sellerSku: row.sku
        }
      }
    });
    const resolvedParentSku =
      row.parentSku || existingListing?.parentSku || existingSkuProduct?.parentSku || row.sku;
    const resolvedProductName =
      row.productName || existingSkuProduct?.title || existingListing?.title || null;
    const resolvedVariationName = row.variationName || resolvedProductName || row.sku;

    if (resolvedParentSku && resolvedParentSku !== row.sku) {
      await tx.product.upsert({
        where: {
          organizationId_internalSku: {
            organizationId,
            internalSku: resolvedParentSku
          }
        },
        update: row.productName ? { title: row.productName } : {},
        create: {
          organizationId,
          internalSku: resolvedParentSku,
          title: row.productName || null
        }
      });
    }

    const skuProduct = await tx.product.upsert({
      where: {
        organizationId_internalSku: {
          organizationId,
          internalSku: row.sku
        }
      },
      update: {
        parentSku: resolvedParentSku,
        ...(row.variationName || row.productName ? { title: resolvedVariationName } : {})
      },
      create: {
        organizationId,
        internalSku: row.sku,
        parentSku: resolvedParentSku,
        title: resolvedVariationName
      }
    });

    const listing = await tx.listing.upsert({
      where: {
        organizationId_marketplace_sellerSku: {
          organizationId,
          marketplace,
          sellerSku: row.sku
        }
      },
      update: {
        productId: skuProduct.id,
        parentSku: resolvedParentSku,
        ...(row.variationName || row.productName ? { title: resolvedVariationName } : {})
      },
      create: {
        organizationId,
        productId: skuProduct.id,
        marketplace,
        sellerSku: row.sku,
        parentSku: resolvedParentSku,
        title: resolvedVariationName
      }
    });

    const existing = await tx.costRecord.findUnique({
      where: {
        organizationId_marketplace_sellerSku_shipmentId_effectiveDate: {
          organizationId,
          marketplace,
          sellerSku: row.sku,
          shipmentId: row.shipmentId,
          effectiveDate: new Date(row.effectiveDate)
        }
      }
    });

    await tx.costRecord.upsert({
      where: {
        organizationId_marketplace_sellerSku_shipmentId_effectiveDate: {
          organizationId,
          marketplace,
          sellerSku: row.sku,
          shipmentId: row.shipmentId,
          effectiveDate: new Date(row.effectiveDate)
        }
      },
      update: {
        uploadId,
        batchId: batch.id,
        productId: skuProduct.id,
        listingId: listing.id,
        parentSku: resolvedParentSku,
        productName: resolvedProductName,
        variationName: resolvedVariationName,
        unitCost: row.unitCost,
        unitCogs: row.unitCogs,
        inboundFreightPerUnit: row.inboundFreightPerUnit,
        prepCostPerUnit: row.prepCostPerUnit,
        packagingCostPerUnit: row.packagingCostPerUnit,
        notes: row.notes || null,
        sourceRow: row.rowNumber,
        status: "ACTIVE"
      },
      create: {
        organizationId,
        uploadId,
        batchId: batch.id,
        productId: skuProduct.id,
        listingId: listing.id,
        marketplace,
        sellerSku: row.sku,
        parentSku: resolvedParentSku,
        shipmentId: row.shipmentId,
        productName: resolvedProductName,
        variationName: resolvedVariationName,
        unitCost: row.unitCost,
        unitCogs: row.unitCogs,
        inboundFreightPerUnit: row.inboundFreightPerUnit,
        prepCostPerUnit: row.prepCostPerUnit,
        packagingCostPerUnit: row.packagingCostPerUnit,
        currency: "USD",
        effectiveDate: new Date(row.effectiveDate),
        sourceRow: row.rowNumber,
        notes: row.notes || null,
        status: "ACTIVE"
      }
    });

    if (existing) {
      updatedRows += 1;
    } else {
      createdRows += 1;
    }
  }

  return {
    importedRows: rows.length,
    createdRows,
    updatedRows,
    batchCount: batchIds.size
  };
}

function failedResult(
  totalRows: number,
  errors: Array<{ rowNumber: number; message: string }>
): CogsImportResult {
  return {
    ok: false,
    status: "FAILED",
    message: "COGS import failed validation.",
    totalRows,
    importedRows: 0,
    createdRows: 0,
    updatedRows: 0,
    batchCount: 0,
    errorCount: errors.length,
    errors
  };
}

function toJsonValue(value: unknown) {
  return value ? (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue) : undefined;
}
