import { Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { formatCurrency } from "@/lib/format";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";
import { listSellerFulfilledShippingCosts } from "@/server/pnl/seller-fulfilled-shipping";
import { saveSellerFulfilledShippingCost } from "./actions";

export const dynamic = "force-dynamic";

export default async function SellerFulfilledShippingPage() {
  const organizationId = await getCurrentOrganizationId();
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const rows = await listSellerFulfilledShippingCosts({ organizationId, marketplace });

  return (
    <>
      <PageHeader
        eyebrow="Manual Imports"
        title={`${marketplaceTitle} Seller Fulfilled Shipping`}
        description="Enter monthly seller fulfilled shipping costs as marketplace-level expenses. These costs are not allocated to SKUs or parent products."
      />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form action={saveSellerFulfilledShippingCost} className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          <div className="grid gap-5">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              Monthly costs are prorated by day for partial ranges. A full month, quarter, or year includes the matching monthly amounts.
            </div>

            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Month
              <input
                name="month"
                type="month"
                required
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Seller fulfilled shipping cost
              <input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                required
                placeholder="0.00"
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Notes
              <textarea
                name="notes"
                rows={3}
                placeholder="Optional"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </label>

            <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Truck aria-hidden className="h-4 w-4 text-ocean" />
                Re-entering the same month updates the existing amount.
              </div>
              <SubmitButton>Save Cost</SubmitButton>
            </div>
          </div>
        </form>

        <div className="rounded-md border border-slate-200 bg-white shadow-panel">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-ink">Saved Monthly Costs</h2>
            <p className="mt-1 text-sm text-slate-500">
              Marketplace-level seller fulfilled shipping costs currently included in P&L.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row) => (
                <div key={row.id} className="grid gap-2 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink">{row.month}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {formatUtcDate(row.periodStart)} - {formatUtcDate(row.periodEnd)}
                      </div>
                    </div>
                    <div className="text-right text-lg font-semibold text-ink">
                      {formatCurrency(row.amount)}
                    </div>
                  </div>
                  {row.notes ? (
                    <div className="text-sm text-slate-500">{row.notes}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500">
                No seller fulfilled shipping costs saved yet.
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function formatUtcDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}
