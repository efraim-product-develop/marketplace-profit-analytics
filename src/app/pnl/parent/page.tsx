import Link from "next/link";
import type { Route } from "next";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
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
  ParentSkuFilterOption,
  PnlSalesSourceSummary
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
  const {
    rows,
    skuRows,
    periodTiles,
    parentOptions,
    summary,
    salesSource,
    settlementAllocation,
    dataQuality,
    diagnostic,
    settlementCommissionDiagnostic,
    orderDrilldownRows
  } = await getParentPnl({
    dateRange: parsed.filters.dateRange,
    comparisonPeriod: parsed.filters.comparisonPeriod,
    marketplace,
    parentSku: parsed.filters.parentSku,
    selectedSku: parsed.selectedSku
  });
  const currentQueryString = buildParentPnlQueryString(parsed.formValues, {
    ...(parsed.selectedSku ? { sku: parsed.selectedSku } : {})
  });
  const exportQueryString = buildParentPnlQueryString(parsed.formValues);

  return (
    <>
      <PageHeader
        eyebrow="Profit"
        title={`${marketplaceTitle} Parent P&L`}
        description="Roll up SKU-level sales, fees, costs, and ad spend by parent SKU."
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
      <DataQualityNotice dataQuality={dataQuality} diagnostic={diagnostic} />
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Sales / GMV" value={formatCurrency(summary.netRevenue)} />
        <KpiCard
          label="Refund Sales"
          value={formatCurrency(summary.salesRefunds)}
          detail="Refunds come from imported order or settlement data when available."
        />
        <KpiCard label="COGS" value={formatCurrency(summary.cogs)} />
        <KpiCard label="Marketplace Commission" value={formatCurrency(summary.commissionFees)} />
      </section>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Fulfillment Fees" value={formatCurrency(summary.fulfillmentFees)} />
        <KpiCard
          label="Other Settlement Fees"
          value={formatCurrency(getOtherSettlementFees(summary))}
        />
        <KpiCard label="Refund Adjustments" value={formatCurrency(summary.refunds)} />
        <KpiCard label="Walmart Connect Advertising" value={formatCurrency(summary.walmartConnectAdvertisingCost)} />
      </section>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="SEM Advertising" value={formatCurrency(summary.semAdvertisingCost)} />
        <KpiCard label="Profit" value={formatCurrency(summary.netProfit)} tone="good" />
        <KpiCard label="Profit Margin" value={formatPercent(summary.netMarginPercent)} />
        <KpiCard label="Units" value={formatNumber(summary.quantity)} />
      </section>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Profit / Unit" value={formatCurrency(summary.profitPerUnit)} />
        <KpiCard
          label="Missing COGS"
          value={formatNumber(summary.missingCogsUnits)}
          detail={`${formatNumber(summary.missingCogsLineCount)} affected order lines`}
          tone={summary.missingCogsUnits > 0 ? "warn" : "good"}
        />
      </section>

      <ParentPnlControls
        formValues={parsed.formValues}
        parentOptions={parentOptions}
      />

      <ParentPnlTileGrid tiles={periodTiles} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-ink">Parent Rollup</h2>
          <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-500">
            Expand a parent to view SKUs and order history
          </span>
        </div>
        <ParentPnlTable
          currentQueryString={currentQueryString}
          orderHistoryRows={orderDrilldownRows}
          rows={rows}
          selectedSku={parsed.selectedSku}
          skuRows={skuRows}
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

            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                GMV <PercentDelta value={tile.netRevenueChangePercent} />
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink">
                {formatCurrency(tile.netRevenue)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <TileMetric label="Orders" value={formatNumber(tile.orderCount)} />
              <TileMetric label="Units" value={formatNumber(tile.units)} />
              <TileMetric label="Returns" value={formatNumber(tile.refundUnits)} muted />
              <TileMetric label="Refund sales" value={formatCurrency(tile.salesRefunds)} muted />
            </div>

            <div className="grid gap-2 rounded-md bg-slate-50 p-3">
              {tile.refunds > 0 ? (
                <CostLine label="Refund adjustments" value={formatCurrency(tile.refunds)} />
              ) : null}
              <CostLine label="Commission" value={formatCurrency(tile.commissionFees)} />
              <CostLine label="Fulfillment" value={formatCurrency(tile.fulfillmentFees)} />
              <CostLine label="Other settlement fees" value={formatCurrency(getOtherSettlementFees(tile))} />
              <SettlementFeeBreakdown row={tile} />
              <CostLine label="COGS" value={formatCurrency(tile.cogs)} />
              <CostLine
                label="Walmart Connect ads"
                value={formatCurrency(tile.walmartConnectAdvertisingCost)}
              />
              <CostLine label="SEM ads" value={formatCurrency(tile.semAdvertisingCost)} />
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
            Sales: {formatNumber(diagnostic.sales.orderRowsIncluded)} PO/order rows,
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
            Additional PO/order rows: {formatNumber(salesSource.suppressedDetailRowCount)}
          </div>
        ) : null}
      </div>
    </section>
  );
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

function getOtherSettlementFees({
  commissionFees,
  fulfillmentFees,
  marketplaceFees
}: {
  commissionFees: number;
  fulfillmentFees: number;
  marketplaceFees: number;
}) {
  return marketplaceFees - commissionFees - fulfillmentFees;
}

type SettlementFeeBreakdownRow = {
  shippingFees?: number;
  storageFees?: number;
  returnFees?: number;
  adjustmentFees?: number;
  otherFees?: number;
};

function SettlementFeeBreakdown({ row }: { row: SettlementFeeBreakdownRow }) {
  const lines = [
    { label: "Shipping", value: row.shippingFees ?? 0 },
    { label: "Storage", value: row.storageFees ?? 0 },
    { label: "Return processing", value: row.returnFees ?? 0 },
    { label: "Adjustments / credits", value: row.adjustmentFees ?? 0 },
    { label: "Misc fees", value: row.otherFees ?? 0 }
  ].filter((line) => Math.abs(line.value) >= 0.005);

  if (!lines.length) {
    return null;
  }

  return (
    <div className="grid gap-1 border-l border-slate-200 pl-3">
      {lines.map((line) => (
        <CostLine
          key={line.label}
          label={line.label}
          value={formatCurrency(line.value)}
          muted
        />
      ))}
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
