import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";

export const dynamic = "force-dynamic";

export async function GET() {
  const organizationId = await getCurrentOrganizationId();
  const marketplace = getCurrentMarketplace();
  const now = new Date();

  const records = await prisma.costRecord.findMany({
    where: {
      organizationId,
      marketplace,
      status: "ACTIVE",
      effectiveDate: {
        lte: now
      }
    },
    select: {
      sellerSku: true,
      effectiveDate: true,
      unitCost: true
    },
    orderBy: [
      { sellerSku: "asc" },
      { effectiveDate: "desc" },
      { updatedAt: "desc" },
      { createdAt: "desc" }
    ]
  });

  const latestBySku = new Map<string, (typeof records)[number]>();

  for (const record of records) {
    if (!latestBySku.has(record.sellerSku)) {
      latestBySku.set(record.sellerSku, record);
    }
  }

  const exportRows = Array.from(latestBySku.values()).map((record) => ({
    sku: record.sellerSku,
    effective_date: record.effectiveDate.toISOString().slice(0, 10),
    unit_cogs: Number(record.unitCost.toString())
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(exportRows, {
    header: ["sku", "effective_date", "unit_cogs"]
  });
  worksheet["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Current COGS");

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer"
  }) as Buffer;
  const safeMarketplace = marketplace.replace(/[^a-z0-9-]+/g, "-");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="current-cogs-${safeMarketplace}.xlsx"`,
      "Cache-Control": "no-store"
    }
  });
}
