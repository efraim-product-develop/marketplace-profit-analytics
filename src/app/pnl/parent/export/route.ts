import { NextResponse } from "next/server";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { buildParentPnlCsv, parseParentPnlSearchParams } from "@/server/pnl/parent-page";
import { getParentPnl } from "@/server/pnl/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseParentPnlSearchParams({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
    parent: url.searchParams.get("parent") ?? undefined
  });
  const { rows, skuRows, monthlyComparisonRows } = await getParentPnl({
    dateRange: parsed.filters.dateRange,
    comparisonPeriod: parsed.filters.comparisonPeriod,
    marketplace: getCurrentMarketplace(),
    parentSku: parsed.filters.parentSku
  });
  const csv = buildParentPnlCsv(rows, skuRows, monthlyComparisonRows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildExportFilename(parsed.formValues.from, parsed.formValues.to)}"`
    }
  });
}

function buildExportFilename(from: string, to: string) {
  const suffix = from || to ? `-${from || "start"}-to-${to || "end"}` : "";
  return `parent-pnl${suffix}.csv`;
}
