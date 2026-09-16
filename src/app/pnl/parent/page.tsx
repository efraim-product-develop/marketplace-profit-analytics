import Link from "next/link";
import type { Route } from "next";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import {
  buildParentPnlQueryString,
  getParentPnlReconciliationLabel,
  getParentPnlSourceLabel,
  parseParentPnlSearchParams,
  type ParentPnlSearchParams
} from "@/server/pnl/parent-page";
import { getParentPnl } from "@/server/pnl/queries";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import {
  formatDateInput,
  getRollingPeriodDateRange,
  type RollingPnlComparisonPeriod
} from "@/server/pnl/periods";
import type {
  OtherFeeCategoryBreakdownRow,
  ParentSkuFilterOption,
  ProductAttributionDiagnostics,
  PnlSalesSourceSummary,
  SettlementPayoutHistoryRow
} from "@/server/pnl/types";
import { ParentPnlTable } from "./parent-pnl-table";

export const dynamic = "force-dynamic";

export default async function ParentPnlPage({
  searchParams
}: {
  searchParams?: ParentPnlSearchParams;
}) {
  const parsed = parseParentPnlSearchParams(searchParams);
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const shouldLoadSkuRows = Boolean(parsed.filters.parentSku || parsed.selectedSku);
  const {
    rows,
    skuRows,
    periodTiles,
    parentOptions,
    summary,
    salesSource,
    settlementAllocation,
    attributionDiagnostics,
    dataQuality,
    diagnostic,
    settlementCommissionDiagnostic,
    settlementPayouts,
    orderDrilldownRows
  } = await getParentPnl({
    dateRange: parsed.filters.dateRange,
    comparisonPeriod: parsed.filters.comparisonPeriod,
    marketplace,
    parentSku: parsed.filters.parentSku,
    selectedSku: parsed.selectedSku,
    includeSkuRows: shouldLoadSkuRows
  });
  const currentQueryString = buildParentPnlQueryString(parsed.formValues, {
    ...(parsed.selectedSku ? { sku: parsed.selectedSku } : {})
  });
  const exportQueryString = buildParentPnlQueryString(parsed.formValues);
  const isMarketplaceSummary = !parsed.filters.parentSku;

  return (
    <>
      <PageHeader
        eyebrow="Profit"
        title={`${marketplaceTitle} Parent P&L`}
        description="Marketplace profit summary with parent SKU rollup below."
        action={
          <a
            className="grid h-10 place-items-center rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink/90"
            href={`/pnl/parent/export${exportQueryString ? `?${exportQueryString}` : ""}`}
          >
            Export CSV
          </a>
        }
      />
      <SalesSourceNotice salesSource={salesSource} />
      <SettlementAllocationNotice
        settlementAllocation={settlementAllocation}
        settlementCommissionDiagnostic={settlementCommissionDiagnostic}
      />
      <ProductAttributionNotice diagnostics={attributionDiagnostics} />
      <DataQualityNotice dataQuality={dataQuality} diagnostic={diagnostic} />
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard
          label="Gross Sales"
          value={formatCurrency(summary.grossRevenue)}
          detail="Valid PO sales before refunds"
        />
        <KpiCard
          label="Refunds"
          value={formatCurrency(summary.salesRefunds)}
          detail="Source: Walmart Settlement"
        />
        <KpiCard
          label="Sales"
          value={formatCurrency(summary.netRevenue)}
          detail="Gross Sales - Refunds"
        />
        <KpiCard label="COGS" value={formatCurrency(summary.cogs)} detail="Source: Effective COGS" />
      </section>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard
          label="Marketplace Commission"
          value={formatCurrency(summary.commissionFees)}
          detail="Source: Walmart Settlement"
        />
        <KpiCard
          label="Fulfillment Fees"
          value={formatCurrency(summary.fulfillmentFees)}
          detail="Source: Walmart Settlement"
        />
        <KpiCard
          label="Walmart Connect Advertising"
          value={formatCurrency(summary.walmartConnectAdvertisingCost)}
          detail={
            isMarketplaceSummary
              ? `Attributed ${formatCurrency(
                  attributionDiagnostics.attributableWalmartConnectAdvertising
                )} + unallocated ${formatCurrency(
                  attributionDiagnostics.unallocatedWalmartConnectAdvertising
                )}`
              : "SKU-attributed only"
          }
        />
        <KpiCard
          label="SEM Advertising"
          value={formatCurrency(attributionDiagnostics.sellerCenterSemAdvertising)}
          detail="Marketplace-level"
        />
        <KpiCard
          label="Seller Shipping"
          value={formatCurrency(summary.sellerFulfilledShippingCost)}
          detail="Marketplace-level"
        />
        <KpiCard
          label="Other Fees"
          value={formatCurrency(attributionDiagnostics.marketplaceOnlyOtherWalmartFees)}
          detail="Marketplace-level"
        />
        <KpiCard label="Profit" value={formatCurrency(summary.netProfit)} tone="good" />
      </section>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Profit Margin %" value={formatPercent(summary.netMarginPercent)} />
        <KpiCard label="Units" value={formatNumber(summary.quantity)} />
        <KpiCard label="Profit / Unit" value={formatCurrency(summary.profitPerUnit)} />
        <KpiCard
          label="Missing COGS"
          value={formatNumber(summary.missingCogsUnits)}
          detail={`${formatNumber(summary.missingCogsLineCount)} affected order lines`}
          tone={summary.missingCogsUnits > 0 ? "warn" : "good"}
        />
      </section>
      <SettlementPayoutPanel payouts={settlementPayouts} />

      <ParentPnlControls
        formValues={parsed.formValues}
        parentOptions={parentOptions}
      />

      <ParentPnlTileGrid tiles={periodTiles} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-ink">Parent Rollup</h2>
          <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-500">
            {shouldLoadSkuRows ? "Expand a parent to view SKUs and order history" : "Open a parent to load SKU detail"}
          </span>
        </div>
        <ParentPnlTable
          currentQueryString={currentQueryString}
          orderHistoryRows={orderDrilldownRows}
          rows={rows}
          selectedSku={parsed.selectedSku}
          skuRows={skuRows}
          skuRowsLoaded={shouldLoadSkuRows}
        />
      </section>
    </>
  );
}

function ParentPnlTileGrid({
  tiles
}: {
  tiles: Awaited<ReturnType<typeof getParentPnl>>["periodTiles"];
}) {
  const accents = ["border-t-blue-500", "border-t-cyan-500", "border-t-teal-500", "border-t-emerald-500"];

  return (
    <section className="mb-6 grid gap-3 xl:grid-cols-4">
      {tiles.map((tile, index) => (
        <article
          key={tile.periodKey}
          className={`overflow-hidden rounded-md border border-slate-200 border-t-4 bg-white shadow-panel ${accents[index] ?? "border-t-ocean"}`}
        >
          <div className="grid gap-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">{tile.label}</h2>
                <div className="mt-1 text-xs font-medium text-slate-500">{tile.dateLabel}</div>
              </div>
              <div className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-normal text-slate-600">
                {getParentPnlSourceLabel(tile.salesSource.kind)}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              {getParentPnlReconciliationLabel(tile.salesSource, tile.missingCogsUnits)}
            </div>

            <div className="grid gap-2">
              <TileMetric label="Gross Sales" value={formatCurrency(tile.grossRevenue)} />
              <TileMetric label="Refunds" value={formatCurrency(tile.salesRefunds)} muted />
            </div>

            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                Sales <PercentDelta value={tile.netRevenueChangePercent} />
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink">
                {formatCurrency(tile.netRevenue)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <TileMetric label="Orders" value={formatNumber(tile.orderCount)} />
              <TileMetric label="Units" value={formatNumber(tile.units)} />
              <TileMetric label="Returns" value={formatNumber(tile.refundUnits)} muted />
              <TileMetric label="COGS" value={formatCurrency(tile.cogs)} muted />
            </div>

            <div className="grid gap-2 rounded-md bg-slate-50 p-3">
              <CostLine label="Commission" value={formatCurrency(tile.commissionFees)} />
              <CostLine label="Fulfillment" value={formatCurrency(tile.fulfillmentFees)} />
              <CostLine label="COGS" value={formatCurrency(tile.cogs)} />
              <CostLine
                label="Seller shipping"
                value={formatCurrency(tile.sellerFulfilledShippingCost)}
              />
              <CostLine
                label="Walmart Connect ads"
                value={formatCurrency(tile.walmartConnectAdvertisingCost)}
              />
              <CostLine label="SEM ads" value={formatCurrency(tile.semAdvertisingCost)} />
              <CostLine label="TACOS" value={formatPercent(tile.tacosPercent)} />
              <ExpandableOtherFeesLine
                label="Other fees"
                value={formatCurrency(tile.otherWalmartFeesAndAdjustments)}
                breakdown={tile.otherFeeCategoryBreakdown}
              />
            </div>

            <div className="grid gap-1 border-t border-slate-200 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-slate-500">
                  Profit <PercentDelta value={tile.netProfitChangePercent} />
                </div>
                <div className="text-xs font-semibold text-slate-500">
                  {formatPercent(tile.marginPercent)}
                </div>
              </div>
              <div className="text-lg font-semibold text-ink">{formatCurrency(tile.netProfit)}</div>
              {tile.missingCogsUnits > 0 ? (
                <div className="text-xs font-medium text-amber-700">
                  Missing COGS on {formatNumber(tile.missingCogsUnits)} units
                </div>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}

function ProductAttributionNotice({
  diagnostics
}: {
  diagnostics: ProductAttributionDiagnostics;
}) {
  return (
    <details className="mb-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
      <summary className="cursor-pointer font-semibold text-ink">
        Product attribution
      </summary>
      <p className="mt-2 max-w-4xl text-xs leading-5 text-slate-600">
        Seller Center SEM and unallocated marketplace expenses are included in overall
        Marketplace P&L, but are not fabricated onto individual SKUs or parent products.
      </p>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <AttributionMetric
          label="Attributable refunds"
          value={diagnostics.attributableRefunds}
        />
        <AttributionMetric
          label="Unallocated refunds"
          value={diagnostics.unallocatedRefunds}
        />
        <AttributionMetric
          label="Attributable commission"
          value={diagnostics.attributableCommission}
        />
        <AttributionMetric
          label="Unallocated commission"
          value={diagnostics.unallocatedCommission}
        />
        <AttributionMetric
          label="Attributable fulfillment"
          value={diagnostics.attributableFulfillmentFees}
        />
        <AttributionMetric
          label="Unallocated fulfillment"
          value={diagnostics.unallocatedFulfillmentFees}
        />
        <AttributionMetric
          label="Attributable Walmart Connect"
          value={diagnostics.attributableWalmartConnectAdvertising}
        />
        <AttributionMetric
          label="Unallocated Walmart Connect"
          value={diagnostics.unallocatedWalmartConnectAdvertising}
        />
        <AttributionMetric
          label="Total Walmart Connect"
          value={diagnostics.totalWalmartConnectAdvertising}
        />
        <AttributionMetric
          label="Walmart Connect check"
          value={diagnostics.walmartConnectAdvertisingReconciliationDifference}
        />
        <AttributionMetric
          label="Seller Center SEM"
          value={diagnostics.sellerCenterSemAdvertising}
        />
        <AttributionMetric
          label="Other Walmart fees"
          value={diagnostics.marketplaceOnlyOtherWalmartFees}
        />
      </div>
    </details>
  );
}

function AttributionMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="font-medium text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-ink">{formatCurrency(value)}</div>
    </div>
  );
}

function DataQualityNotice({
  dataQuality,
  diagnostic
}: {
  dataQuality: Awaited<ReturnType<typeof getParentPnl>>["dataQuality"];
  diagnostic: Awaited<ReturnType<typeof getParentPnl>>["diagnostic"];
}) {
  const isComplete = dataQuality.length === 1 && dataQuality[0] === "Complete";

  return (
    <details
      className={`mb-4 rounded-md border px-4 py-3 text-sm ${
        isComplete
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <summary className="cursor-pointer font-semibold">
        Data quality: {dataQuality.join(", ")}
      </summary>
      {diagnostic ? (
        <div className="mt-3 grid gap-2 text-xs leading-5">
          <div>
            Sales: {formatNumber(diagnostic.sales.orderRowsIncluded)} PO/settlement sales rows,
            {" "}{formatCurrency(diagnostic.sales.gmvIncluded)} GMV.
          </div>
          <div>
            COGS: {formatNumber(diagnostic.cogs.orderLinesCosted)} lines costed,
            {" "}{formatNumber(diagnostic.cogs.missingCogsCount)} missing.
          </div>
          <div>
            Commission: {formatNumber(diagnostic.commission.settlementTransactionsIncluded)} settlement rows,
            {" "}{formatCurrency(diagnostic.commission.allocatedAmount)} allocated.
          </div>
          <div>
            Fulfillment: {formatNumber(diagnostic.fulfillment.settlementTransactionsIncluded)} settlement rows,
            {" "}{formatCurrency(diagnostic.fulfillment.allocatedAmount)} allocated.
          </div>
          <div>
            SEM: {formatNumber(diagnostic.sem.settlementTransactionsIncluded)} settlement rows,
            {" "}{formatCurrency(diagnostic.sem.allocatedAmount)} allocated.
          </div>
          <div>
            Walmart Connect: {formatNumber(diagnostic.walmartConnect.dailyAdRowsIncluded)} daily rows,
            {" "}{formatCurrency(diagnostic.walmartConnect.totalSpend)} spend,
            {" "}{formatNumber(diagnostic.walmartConnect.monthlyRowsIgnored)} monthly rows ignored.
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5">
          Full-month views use the monthly source-selection path, so no daily diagnostic is needed.
        </p>
      )}
    </details>
  );
}

function SalesSourceNotice({ salesSource }: { salesSource: PnlSalesSourceSummary }) {
  return (
    <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">{salesSource.label}</div>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
            {salesSource.note}
          </p>
        </div>
        {salesSource.suppressedDetailRowCount > 0 ? (
          <div
            className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600"
            title={salesSource.note}
          >
            Obsolete sales rows ignored: {formatNumber(salesSource.suppressedDetailRowCount)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SettlementPayoutPanel({ payouts }: { payouts: SettlementPayoutHistoryRow[] }) {
  const latest = payouts[0];

  return (
    <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div>
        <div>
          <div className="text-sm font-semibold text-ink">Settlement Payout</div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Cash-flow metric from Walmart settlement reports. It is shown separately and is not included in Profit.
          </p>
        </div>
      </div>

      {latest ? (
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <PayoutInfo label="Latest period" value={formatPayoutPeriod(latest)} />
          <PayoutInfo
            label="Payout date"
            value={latest.payoutDate ? formatDate(latest.payoutDate) : "Not provided"}
          />
          <PayoutInfo label="Imported" value={formatDate(latest.importedAt)} />
        </div>
      ) : (
        <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          No settlement payout records are available for this view yet.
        </div>
      )}

      {payouts.length ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            Payout history
          </summary>
          <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3">Settlement period</th>
                  <th className="border-b border-slate-200 px-4 py-3">Payout</th>
                  <th className="border-b border-slate-200 px-4 py-3">Payout date</th>
                  <th className="border-b border-slate-200 px-4 py-3">Source / imported</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-slate-700">{formatPayoutPeriod(payout)}</td>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {formatCurrency(payout.payoutAmount)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {payout.payoutDate ? formatDate(payout.payoutDate) : "Not provided"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <div>{payout.originalFileName ?? payout.source}</div>
                      <div>{formatDate(payout.importedAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function PayoutInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-semibold text-ink">{value}</div>
    </div>
  );
}

function formatPayoutPeriod(payout: SettlementPayoutHistoryRow) {
  if (!payout.settlementPeriodStart && !payout.settlementPeriodEnd) {
    return "Period not provided";
  }

  return `${payout.settlementPeriodStart ? formatDate(payout.settlementPeriodStart) : "Unknown"} - ${
    payout.settlementPeriodEnd ? formatDate(payout.settlementPeriodEnd) : "Unknown"
  }`;
}

function SettlementAllocationNotice({
  settlementAllocation,
  settlementCommissionDiagnostic
}: {
  settlementAllocation: Awaited<ReturnType<typeof getParentPnl>>["settlementAllocation"];
  settlementCommissionDiagnostic: Awaited<
    ReturnType<typeof getParentPnl>
  >["settlementCommissionDiagnostic"];
}) {
  if (
    !settlementAllocation.allocatedCount &&
    !settlementAllocation.fallbackCount &&
    !settlementCommissionDiagnostic
  ) {
    return null;
  }

  return (
    <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
      <div className="font-semibold text-ink">
        Estimated daily allocation from Walmart settlement period.
      </div>
      {settlementAllocation.fallbackCount > 0 ? (
        <p className="mt-1">
          Some settlement rows lack payout-period dates and use posting date.
        </p>
      ) : null}
      {settlementCommissionDiagnostic ? (
        <div className="mt-3 grid gap-2 rounded-md bg-slate-50 p-3 text-xs md:grid-cols-2">
          <DiagnosticLine
            label="Original commission"
            value={formatCurrency(settlementCommissionDiagnostic.originalCommissionAmount)}
          />
          <DiagnosticLine
            label="Settlement period"
            value={`${settlementCommissionDiagnostic.settlementStart ?? "Unknown"} - ${
              settlementCommissionDiagnostic.settlementEnd ?? "Unknown"
            }`}
          />
          <DiagnosticLine
            label="Settlement days"
            value={formatNumber(settlementCommissionDiagnostic.totalSettlementDays)}
          />
          <DiagnosticLine
            label="Selected range"
            value={`${settlementCommissionDiagnostic.selectedRangeStart ?? "Open"} - ${
              settlementCommissionDiagnostic.selectedRangeEnd ?? "Open"
            }`}
          />
          <DiagnosticLine
            label="Overlap days"
            value={formatNumber(settlementCommissionDiagnostic.overlapDays)}
          />
          <DiagnosticLine
            label="Commission included"
            value={formatCurrency(settlementCommissionDiagnostic.allocatedCommissionIncluded)}
          />
        </div>
      ) : null}
    </section>
  );
}

function DiagnosticLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  return (
    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
      {getParentPnlSourceLabel(source)}
    </span>
  );
}

function CostLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={muted ? "text-[11px] font-medium text-slate-500" : "text-xs font-medium text-slate-500"}>
        {label}
      </span>
      <span className={muted ? "text-xs font-semibold text-slate-600" : "font-semibold text-ink"}>
        {value}
      </span>
    </div>
  );
}

function ExpandableOtherFeesLine({
  label,
  value,
  breakdown
}: {
  label: string;
  value: string;
  breakdown: OtherFeeCategoryBreakdownRow[];
}) {
  if (breakdown.length === 0) {
    return <CostLine label={label} value={value} />;
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm marker:hidden">
        <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-slate-500">
          <span>{label}</span>
          <span
            aria-hidden="true"
            className="text-[10px] text-slate-400 transition group-open:rotate-180"
          >
            v
          </span>
        </span>
        <span className="font-semibold text-ink">{value}</span>
      </summary>
      <div className="mt-2 grid gap-1 border-t border-slate-200 pt-2">
        {breakdown.map((line) => (
          <div
            key={line.category}
            className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-[11px] leading-4"
          >
            <span className="min-w-0 truncate font-medium text-slate-500">
              {line.categoryName}
            </span>
            <span className="font-semibold text-slate-700">
              {formatCurrency(line.netAmount)}
            </span>
            <span className="text-slate-400">
              {formatNumber(line.transactionCount)} transactions
            </span>
            <span className="text-right text-slate-400">
              Charges {formatCurrency(line.charges)}
              {line.credits > 0 ? ` / Credits ${formatCurrency(line.credits)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function TileMetric({
  label,
  value,
  muted = false
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={muted ? "mt-1 text-sm font-semibold text-blue-600" : "mt-1 text-sm font-semibold text-ink"}>
        {value}
      </div>
    </div>
  );
}

function PercentDelta({ value }: { value: number | null }) {
  if (value === null) {
    return null;
  }

  return (
    <span className={value >= 0 ? "text-emerald-600" : "text-brick"}>
      {value >= 0 ? "+" : ""}
      {formatPercent(value)}
    </span>
  );
}

function ParentPnlControls({
  formValues,
  parentOptions
}: {
  formValues: ReturnType<typeof parseParentPnlSearchParams>["formValues"];
  parentOptions: ParentSkuFilterOption[];
}) {
  const rollingPeriods: Array<{ value: RollingPnlComparisonPeriod; label: string }> = [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
    { value: "quarter", label: "Quarter" }
  ];

  return (
    <section className="mb-6 grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex flex-wrap items-center gap-2">
        {rollingPeriods.map((option) => (
          <Link
            key={option.value}
            aria-current={formValues.period === option.value ? "page" : undefined}
            className={
              formValues.period === option.value
                ? "rounded-md bg-ocean px-4 py-2 text-sm font-semibold text-white"
                : "rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-ocean hover:text-ocean"
            }
            href={buildRollingPeriodHref(formValues, option.value)}
          >
            {option.label}
          </Link>
        ))}
        <span
          className={
            formValues.period === "custom"
              ? "rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
              : "rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
          }
        >
          Custom
        </span>
      </div>

      <form
        className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,1.2fr)_auto_auto]"
        method="get"
      >
        <input type="hidden" name="period" value="custom" />
        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          From
          <input
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            name="from"
            type="date"
            defaultValue={formValues.from}
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          To
          <input
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            name="to"
            type="date"
            defaultValue={formValues.to}
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-slate-700">
          Parent SKU
          <select
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            name="parent"
            defaultValue={formValues.parent}
          >
            <option value="">All parent SKUs</option>
            {parentOptions.map((option) => (
              <option key={option.parentSku} value={option.parentSku}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button
            className="h-10 rounded-md bg-ocean px-4 text-sm font-semibold text-white transition hover:bg-ocean/90"
            type="submit"
          >
            Apply Custom
          </button>
        </div>

        <div className="flex items-end">
          <Link
            className="grid h-10 place-items-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:border-ocean hover:text-ocean"
            href="/pnl/parent"
          >
            Reset
          </Link>
        </div>
      </form>
    </section>
  );
}

function buildRollingPeriodHref(
  formValues: ReturnType<typeof parseParentPnlSearchParams>["formValues"],
  period: RollingPnlComparisonPeriod
): Route {
  const range = getRollingPeriodDateRange(period);
  const query = buildParentPnlQueryString({
    ...formValues,
    period,
    from: formatDateInput(range.from),
    to: formatDateInput(range.to)
  });

  return `/pnl/parent${query ? `?${query}` : ""}` as Route;
}
