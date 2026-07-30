import { NextResponse } from "next/server";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getSkuPnl } from "@/server/pnl/queries";
import { buildSkuPnlCsv, parseSkuPnlSearchParams } from "@/server/pnl/sku-page";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseSkuPnlSearchParams({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
    parent: url.searchParams.get("parent") ?? undefined,
    brand: url.searchParams.get("brand") ?? undefined,
    department: url.searchParams.get("department") ?? undefined
  });
  const { rows } = await getSkuPnl({ ...parsed.filters, marketplace: getCurrentMarketplace() });
  const csv = buildSkuPnlCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildExportFilename(parsed.formValues.from, parsed.formValues.to)}"`
    }
  });
}

function buildExportFilename(from: string, to: string) {
  const suffix = from || to ? `-${from || "start"}-to-${to || "end"}` : "";
  return `sku-pnl${suffix}.csv`;
}
