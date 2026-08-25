import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";
import {
  getWalmartDataQualityAudit,
  type AuditStatus,
  type WalmartDataQualityAudit
} from "@/server/audit/walmart-data-quality";

export const dynamic = "force-dynamic";

type AuditSearchParams = {
  from?: string | string[];
  to?: string | string[];
};

export default async function WalmartImportAuditPage({
  searchParams
}: {
  searchParams?: AuditSearchParams;
}) {
  const organizationId = await getCurrentOrganizationId();
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const dateRange = parseAuditDateRange(searchParams);
  const audit = await getWalmartDataQualityAudit({
    organizationId,
    marketplace,
    dateRange
  });
  const isReady = audit.overallStatus === "P&L Data Ready";

  return (
    <>
      <PageHeader
        eyebrow="Data Quality"
        title={`${marketplaceTitle} Import Audit`}
        description="Check whether the selected period has the source data needed for reliable Walmart P&L."
      />

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
        <form className="grid gap-4 md:grid-cols-[repeat(2,minmax(180px,240px))_auto]" method="get">
          <FilterInput label="From" name="from" value={formatInputDate(audit.dateRange.from)} />
          <FilterInput label="To" name="to" value={formatInputDate(audit.dateRange.to)} />
          <div className="flex items-end">
            <button className="h-10 rounded-md bg-ocean px-4 text-sm font-semibold text-white transition hover:bg-ocean/90">
              Apply
            </button>
          </div>
        </form>
      </section>

      <section
        className={`mb-6 rounded-md border p-5 shadow-panel ${
          isReady
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              {isReady ? (
                <CheckCircle2 aria-hidden className="h-5 w-5 text-emerald-700" />
              ) : (
                <AlertTriangle aria-hidden className="h-5 w-5 text-amber-700" />
              )}
              <h2 className="text-lg font-semibold text-ink">{audit.overallStatus}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {formatDate(audit.dateRange.from)} - {formatDate(audit.dateRange.to)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <StatusPill label="PO Sales" status={audit.checklist.poSales} />
            <StatusPill label="Settlement" status={audit.checklist.settlements} />
            <StatusPill label="COGS" status={audit.checklist.cogs} />
            <StatusPill label="SEM" status={audit.checklist.sellerCenterSem} />
            <StatusPill label="Walmart Connect" status={audit.checklist.walmartConnect} />
          </div>
        </div>
        {audit.missingReasons.length ? (
          <div className="mt-4 rounded-md bg-white/70 p-3">
            <div className="text-sm font-semibold text-ink">Missing or uncertain</div>
            <ul className="mt-2 grid gap-1 text-sm text-slate-700">
              {audit.missingReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
        <SourceCard
          title="PO Sales"
          status={audit.poSales.status}
          detail={audit.poSales.statusReason}
          href="/imports/sales"
          action="Upload PO"
        >
          <Metric label="Rows" value={formatNumber(audit.poSales.rows)} />
          <Metric label="Sales" value={formatCurrency(audit.poSales.sales)} />
          <Metric label="Units" value={formatNumber(audit.poSales.units)} />
          <Metric label="Orders" value={formatNumber(audit.poSales.orders)} />
        </SourceCard>

        <SourceCard
          title="Settlement"
          status={audit.settlements.status}
          detail={audit.settlements.statusReason}
          href="/imports/settlements"
          action="Upload settlement"
        >
          <Metric label="Refunds" value={formatCurrency(audit.settlements.refundTotal)} />
          <Metric label="Commission" value={formatCurrency(audit.settlements.marketplaceCommission)} />
          <Metric label="Fulfillment" value={formatCurrency(audit.settlements.fulfillmentFees)} />
          <Metric label="Other fees" value={formatCurrency(audit.settlements.otherWalmartFeesAndAdjustments)} />
        </SourceCard>

        <SourceCard
          title="Seller Center SEM"
          status={audit.sellerCenterSem.status}
          detail={audit.sellerCenterSem.statusReason}
          href="/imports/advertising"
          action="Upload SEM"
        >
          <Metric label="Rows" value={formatNumber(audit.sellerCenterSem.rows)} />
          <Metric label="Spend" value={formatCurrency(audit.sellerCenterSem.spend)} />
          <Metric label="Attributed sales" value={formatCurrency(audit.sellerCenterSem.attributedSales)} />
          <Metric label="Missing dates" value={formatNumber(audit.sellerCenterSem.missingDates.length)} />
        </SourceCard>

        <SourceCard
          title="Walmart Connect"
          status={audit.walmartConnect.status}
          detail={audit.walmartConnect.statusReason}
          href="/ad-spend/upload"
          action="Upload ads"
        >
          <Metric label="Daily rows" value={formatNumber(audit.walmartConnect.rows)} />
          <Metric label="Spend" value={formatCurrency(audit.walmartConnect.spend)} />
          <Metric label="SKU-attributed" value={formatCurrency(audit.walmartConnect.skuAttributableSpend)} />
          <Metric label="Unallocated" value={formatCurrency(audit.walmartConnect.unallocatedSpend)} />
        </SourceCard>

        <SourceCard
          title="COGS"
          status={audit.cogs.status}
          detail={audit.cogs.statusReason}
          href="/cogs/upload"
          action="Update COGS"
        >
          <Metric label="SKUs sold" value={formatNumber(audit.cogs.skusSold)} />
          <Metric label="SKUs with COGS" value={formatNumber(audit.cogs.skusWithValidCogs)} />
          <Metric label="Missing SKUs" value={formatNumber(audit.cogs.skusMissingCogs)} />
          <Metric label="Units affected" value={formatNumber(audit.cogs.unitsAffectedByMissingCogs)} />
        </SourceCard>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <PnlSummaryPanel audit={audit} />
        <SourceAuthorityPanel />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <DetailsPanel title="PO Sales Details">
          <MetricGrid>
            <Metric label="Earliest PO date" value={audit.poSales.earliestOrderDate ?? "None"} />
            <Metric label="Latest PO date" value={audit.poSales.latestOrderDate ?? "None"} />
            <Metric label="Cancelled rows" value={formatNumber(audit.poSales.cancelledRows)} />
            <Metric label="Duplicate/upserted rows" value={formatNumber(audit.poSales.duplicateUpsertedRows)} />
          </MetricGrid>
          <FulfillmentBreakdown audit={audit} />
        </DetailsPanel>

        <DetailsPanel title="Settlement Details">
          {audit.settlements.relevantSettlements.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Payout</th>
                    <th className="px-3 py-2">Refunds</th>
                    <th className="px-3 py-2">Commission</th>
                    <th className="px-3 py-2">Fulfillment</th>
                    <th className="px-3 py-2">Unsupported</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.settlements.relevantSettlements.map((row, index) => (
                    <tr key={`${row.settlementPeriodStart}-${row.settlementPeriodEnd}-${index}`} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {row.settlementPeriodStart ?? "Unknown"} - {row.settlementPeriodEnd ?? "Unknown"}
                      </td>
                      <td className="px-3 py-2">{formatCurrency(row.payoutAmount)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.refundTotal)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.marketplaceCommission)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.fulfillmentFees)}</td>
                      <td className="px-3 py-2">{formatNumber(row.unsupportedFinancialRows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyText>No overlapping settlement periods found.</EmptyText>
          )}
        </DetailsPanel>

        <DetailsPanel title="Product Attribution">
          <AttributionRows audit={audit} />
        </DetailsPanel>

        <DetailsPanel title="Missing COGS SKUs">
          {audit.cogs.missingSkuRows.length ? (
            <div className="grid gap-2">
              {audit.cogs.missingSkuRows.slice(0, 20).map((row) => (
                <div key={row.sellerSku} className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-4">
                  <Metric label="SKU" value={row.sellerSku} />
                  <Metric label="Parent" value={row.parentSku ?? "Unassigned"} />
                  <Metric label="Units" value={formatNumber(row.units)} />
                  <Metric label="Sales" value={formatCurrency(row.sales)} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyText>No missing COGS SKUs for this selected period.</EmptyText>
          )}
          <div className="mt-3">
            <Link className="text-sm font-semibold text-ocean" href="/cogs/audit">
              Open COGS audit
            </Link>
          </div>
        </DetailsPanel>
      </section>
    </>
  );
}

function FilterInput({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-600">
      {label}
      <input
        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-ink outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
        name={name}
        type="date"
        defaultValue={value}
      />
    </label>
  );
}

function StatusPill({ label, status }: { label: string; status: AuditStatus }) {
  const Icon = status === "Complete" ? CheckCircle2 : status === "Missing" ? XCircle : CircleHelp;
  const className =
    status === "Complete"
      ? "bg-emerald-100 text-emerald-800"
      : status === "Missing"
        ? "bg-rose-100 text-rose-800"
        : status === "Partial"
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";

  return (
    <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold ${className}`}>
      <Icon aria-hidden className="h-4 w-4" />
      <span>{label}: {status}</span>
    </div>
  );
}

function SourceCard({
  title,
  status,
  detail,
  href,
  action,
  children
}: {
  title: string;
  status: AuditStatus;
  detail: string;
  href: Route;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <article className="grid gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <div className="mt-2">
            <StatusPill label="Status" status={status} />
          </div>
        </div>
        <Link
          className="rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-ocean transition hover:border-ocean/40"
          href={href}
        >
          {action}
        </Link>
      </div>
      <p className="text-xs leading-5 text-slate-600">{detail}</p>
      <div className="grid gap-2">{children}</div>
    </article>
  );
}

function PnlSummaryPanel({ audit }: { audit: WalmartDataQualityAudit }) {
  return (
    <DetailsPanel title="P&L Summary">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">Marketplace P&L</div>
          <MetricGrid>
            <Metric label="Gross Sales" value={formatCurrency(audit.marketplacePnl.grossSales)} />
            <Metric label="Refunds" value={formatCurrency(audit.marketplacePnl.refunds)} />
            <Metric label="Sales" value={formatCurrency(audit.marketplacePnl.sales)} />
            <Metric label="COGS" value={formatCurrency(audit.marketplacePnl.cogs)} />
            <Metric label="Commission" value={formatCurrency(audit.marketplacePnl.marketplaceCommission)} />
            <Metric label="Fulfillment" value={formatCurrency(audit.marketplacePnl.fulfillmentFees)} />
            <Metric label="SEM" value={formatCurrency(audit.marketplacePnl.sellerCenterSem)} />
            <Metric label="Walmart Connect" value={formatCurrency(audit.marketplacePnl.walmartConnectAdvertising)} />
            <Metric label="Other fees" value={formatCurrency(audit.marketplacePnl.otherWalmartFeesAndAdjustments)} />
            <Metric label="Profit" value={formatCurrency(audit.marketplacePnl.profit)} />
            <Metric label="Settlement payout" value={formatCurrency(audit.marketplacePnl.settlementPayout)} />
          </MetricGrid>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">Product P&L Aggregate</div>
          <MetricGrid>
            <Metric label="Gross Sales" value={formatCurrency(audit.productPnl.grossSales)} />
            <Metric label="Refunds" value={formatCurrency(audit.productPnl.refunds)} />
            <Metric label="Sales" value={formatCurrency(audit.productPnl.sales)} />
            <Metric label="COGS" value={formatCurrency(audit.productPnl.cogs)} />
            <Metric label="Commission" value={formatCurrency(audit.productPnl.marketplaceCommission)} />
            <Metric label="Fulfillment" value={formatCurrency(audit.productPnl.fulfillmentFees)} />
            <Metric label="Walmart Connect" value={formatCurrency(audit.productPnl.walmartConnectAdvertising)} />
            <Metric label="Profit" value={formatCurrency(audit.productPnl.profit)} />
            <Metric
              label="Margin"
              value={formatPercent(
                audit.productPnl.sales === 0 ? 0 : (audit.productPnl.profit / audit.productPnl.sales) * 100
              )}
            />
          </MetricGrid>
        </div>
      </div>
    </DetailsPanel>
  );
}

function SourceAuthorityPanel() {
  const rows = [
    ["Sales", "PO Reports"],
    ["Refunds", "Settlement"],
    ["Marketplace Commission", "Settlement"],
    ["Fulfillment Fees", "Settlement"],
    ["Other Walmart Fees & Adjustments", "Settlement"],
    ["Settlement Payout", "Settlement"],
    ["SEM Advertising", "Seller Center SEM"],
    ["Walmart Connect Advertising", "Walmart Connect"],
    ["COGS", "Effective COGS"]
  ];

  return (
    <DetailsPanel title="Source Authority">
      <div className="grid gap-2">
        {rows.map(([metric, source]) => (
          <div key={metric} className="flex items-center justify-between gap-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-600">{metric}</span>
            <span className="font-semibold text-ink">{source}</span>
          </div>
        ))}
      </div>
    </DetailsPanel>
  );
}

function FulfillmentBreakdown({ audit }: { audit: WalmartDataQualityAudit }) {
  const rows = [
    ["WFS", audit.poSales.wfs],
    ["Seller Fulfilled", audit.poSales.sellerFulfilled],
    ["Unknown", audit.poSales.unknownFulfillment]
  ] as const;

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {rows.map(([label, row]) => (
        <div key={label} className="rounded-md bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">{label}</div>
          <MetricGrid>
            <Metric label="Rows" value={formatNumber(row.rows)} />
            <Metric label="Sales rows" value={formatNumber(row.salesRows)} />
            <Metric label="Cancelled" value={formatNumber(row.cancelledRows)} />
            <Metric label="Sales" value={formatCurrency(row.sales)} />
          </MetricGrid>
        </div>
      ))}
    </div>
  );
}

function AttributionRows({ audit }: { audit: WalmartDataQualityAudit }) {
  const rows = [
    ["Refunds", audit.attribution.refunds],
    ["Marketplace Commission", audit.attribution.marketplaceCommission],
    ["Fulfillment Fees", audit.attribution.fulfillmentFees],
    ["Walmart Connect Advertising", audit.attribution.walmartConnectAdvertising]
  ] as const;

  return (
    <div className="grid gap-3">
      {rows.map(([label, row]) => (
        <div key={label} className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-3">
          <Metric label={`${label} total`} value={formatCurrency(row.total)} />
          <Metric label="SKU-attributable" value={formatCurrency(row.skuAttributable)} />
          <Metric label="Unallocated" value={formatCurrency(row.unallocated)} />
        </div>
      ))}
      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        <div className="font-semibold text-ink">Seller Center SEM</div>
        <p className="mt-1">{audit.attribution.sellerCenterSem.note}</p>
      </div>
      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
        <div className="font-semibold text-ink">Other Walmart Fees & Adjustments</div>
        <p className="mt-1">{audit.attribution.otherWalmartFeesAndAdjustments.note}</p>
      </div>
    </div>
  );
}

function DetailsPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md border border-slate-200 bg-white p-4 shadow-panel" open>
      <summary className="cursor-pointer text-base font-semibold text-ink">{title}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 grid gap-2 sm:grid-cols-2">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

function parseAuditDateRange(searchParams?: AuditSearchParams) {
  const now = new Date();
  const fromText = getSearchValue(searchParams?.from) ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const toText = getSearchValue(searchParams?.to) ?? formatInputDate(now);

  return {
    from: parseInputDate(fromText),
    to: parseInputDate(toText)
  };
}

function getSearchValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseInputDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
