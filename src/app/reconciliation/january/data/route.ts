import { NextResponse } from "next/server";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getJanuaryGmvReconciliation } from "@/server/reconciliation/january-gmv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const report = await getJanuaryGmvReconciliation({
    marketplace: getCurrentMarketplace(),
    reportMonth: parseMonth(url.searchParams.get("month")),
    sellerCenterGmv: parseMoney(url.searchParams.get("sellerCenterGmv")) ?? undefined
  });

  return NextResponse.json(report);
}

function parseMonth(value: string | null) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : "2026-01";
}

function parseMoney(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
