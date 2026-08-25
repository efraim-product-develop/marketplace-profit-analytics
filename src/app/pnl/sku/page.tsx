import Link from "next/link";
import type { Route } from "next";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getSkuPnl, getSkuPnlFilterOptions } from "@/server/pnl/queries";
import {
  buildSkuPnlQueryString,
  getSkuPnlSourceLabel,
  parseSkuPnlSearchParams,
  type SkuPnlSearchParams
} from "@/server/pnl/sku-page";
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
  ProductAttributionDiagnostics,
  PnlSalesSourceSummary,
  SkuPnlFilterOptions,
  SkuPnlOrderDrilldownRow
} from "@/server/pnl/types";
import { SkuPnlTable } from "./sku-pnl-table";

export const dynamic = "force-dynamic";

export default async function SkuPnlPage({
  searchParams
}: {
  searchParams?: SkuPnlSearchParams;
}) {
  const parsed = parseSkuPnlSearchParams(searchParams);
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const [
    {
      rows,
      summary,
      salesSource,
      settlementAllocation,
      attributionDiagnostics,
      dataQuality,
      diagnostic,
      settlementCommissionDiagnostic,
      orderDrilldownRows
    },
    filterOptions
  ] = await Promise.all([
    getSkuPnl({ ...parsed.filters, marketplace }, parsed.selectedSku),
    getSkuPnlFilterOptions(marketplace)
  ]);
  const currentQueryString = buildSkuPnlQueryString(parsed.formValues, {
    ...(parsed.selectedSku ? { sku: parsed.selectedSku } : {})
  });
  const exportQueryString = buildSkuPnlQueryString(parsed.formValues);

  return (
    <>
      <PageHeader
        eyebrow="Profit"
        title={`${marketplaceTitle} SKU P&L`}
        description="Profit by seller SKU across marketplace sales, fees, costs, and ad spend."
        action={
          <a
            className="grid h-10 place-items-center rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-ink/90"
            href={`/pnl/sku/export${exportQueryString ? `?${exportQueryString}` : ""}`}
          >
            Export CSV
          </a>
        }
      />
      <SkuPnlControls formValues={parsed.formValues} filterOptions={filterOptions} />
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
        <KpiCard label="COGS" value={formatCurrency(summary.cogs)} />
      </section>
      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Marketplace Commission" value={formatCurrency(summary.commissionFees)} />
        <KpiCard label="Fulfillment Fees" value={formatCurrency(summary.fulfillmentFees)} />
        <KpiCard
          label="Walmart Connect Advertising"
          value={formatCurrency(summary.walmartConnectAdvertisingCost)}
          detail="SKU-attributed only"
        />
        <KpiCard
          label="SEM Advertising"
          value={formatCurrency(attributionDiagnostics.sellerCenterSemAdvertising)}
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
      <SkuPnlTable rows={rows} currentQueryString={currentQueryString} />
      {parsed.selectedSku ? (
        <SkuOrderDrilldown
          rows={orderDrilldownRows}
          selectedSku={parsed.selectedSku}
          clearHref={`/pnl/sku${exportQueryString ? `?${exportQueryString}` : ""}`}
        />
      ) : null}
    </>
  );
}

function SkuPnlControls({
  formValues,
  filterOptions
}: {
  formValues: ReturnType<typeof parseSkuPnlSearchParams>["formValues"];
  filterOptions: SkuPnlFilterOptions;
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
            href={buildSkuRollingPeriodHref(formValues, option.value)}
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
        className="grid gap-4 md:grid-cols-[repeat(2,minmax(0,1fr))_repeat(3,minmax(180px,1fr))_auto_auto]"
        method="get"
      >
        <input type="hidden" name="period" value="custom" />
        <FilterInput label="From" name="from" type="date" value={formValues.from} />
        <FilterInput label="To" name="to" type="date" value={formValues.to} />
        <FilterSelect label="Parent" name="parent" value={formValues.parent}>
          <option value="">All parents</option>
          {filterOptions.parents.map((option) => (
            <option key={option.parentSku} value={option.parentSku}>
              {option.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Brand" name="brand" value={formValues.brand}>
          <option value="">All brands</option>
          {filterOptions.brands.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Department" name="department" value={formValues.department}>
          <option value="">All departments</option>
          {filterOptions.departments.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </FilterSelect>
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
            href="/pnl/sku"
          >
            Reset
          </Link>
        </div>
      </form>
    </section>
  );
}

function buildSkuRollingPeriodHref(
  formValues: ReturnType<typeof parseSkuPnlSearchParams>["formValues"],
  period: RollingPnlComparisonPeriod
): Route {
  const range = getRollingPeriodDateRange(period);
  const query = buildSkuPnlQueryString({
    ...formValues,
    period,
    from: formatDateInput(range.from),
    to: formatDateInput(range.to)
  });

  return `/pnl/sku${query ? `?${query}` : ""}` as Route;
}

function FilterInput({
  label,
  name,
  type,
  value
}: {
  label: string;
  name: string;
  type: string;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-slate-700">
      {label}
      <input
        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
        defaultValue={value}
        name={name}
        type={type}
      />
    </label>
  );
}

function FilterSelect({
  children,
  label,
  name,
  value
}: {
  children: React.ReactNode;
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-slate-700">
      {label}
      <select
        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
        defaultValue={value}
        name={name}
      >
        {children}
      </select>
    </label>
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
        Seller Center SEM and unallocated marketplace expenses are included in Marketplace
        P&L only because they cannot be reliably attributed to individual SKUs.
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
          label="Seller Center SEM excluded"
          value={diagnostics.sellerCenterSemAdvertising}
        />
        <AttributionMetric
          label="Other Walmart fees excluded"
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

function SettlementAllocationNotice({
  settlementAllocation,
  settlementCommissionDiagnostic
}: {
  settlementAllocation: Awaited<ReturnType<typeof getSkuPnl>>["settlementAllocation"];
  settlementCommissionDiagnostic: Awaited<ReturnType<typeof getSkuPnl>>["settlementCommissionDiagnostic"];
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

function DataQualityNotice({
  dataQuality,
  diagnostic
}: {
  dataQuality: Awaited<ReturnType<typeof getSkuPnl>>["dataQuality"];
  diagnostic: Awaited<ReturnType<typeof getSkuPnl>>["diagnostic"];
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

function SkuOrderDrilldown({
  rows,
  selectedSku,
  clearHref
}: {
  rows: SkuPnlOrderDrilldownRow[];
  selectedSku: string;
  clearHref: string;
}) {
  return (
    <section className="mt-6 rounded-md border border-slate-200 bg-white shadow-panel">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Order Drill-down</h2>
          <p className="mt-1 text-sm text-slate-600">{selectedSku}</p>
        </div>
        <a
          className="text-sm font-semibold text-ocean transition hover:text-ocean/80"
          href={clearHref}
        >
          Clear selection
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Order</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Date</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Source</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Status</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Units</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Sales</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Refunds</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Commission</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Fulfillment</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">COGS</th>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{row.externalOrderId ?? "Summary"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.orderDate ? formatDate(row.orderDate) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <SourcePill
                      label={getSkuPnlSourceLabel(row.salesSource)}
                      muted={!row.dashboardIncluded}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.orderStatus ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-700">{formatNumber(row.quantity)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.netRevenue)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.salesRefunds)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.commissionFees)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.fulfillmentFees)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.cogs)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {formatCurrency(row.netProfit)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={11}>
                  No order rows match this SKU and filter set.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SourcePill({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500"
          : "rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700"
      }
    >
      {muted ? `${label} audit` : label}
    </span>
  );
}
