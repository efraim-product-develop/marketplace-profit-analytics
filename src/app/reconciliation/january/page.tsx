import { PageHeader } from "@/components/page-header";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import { getJanuaryGmvReconciliation } from "@/server/reconciliation/january-gmv";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type SearchParams = {
  month?: string;
  sellerCenterGmv?: string;
};

export default async function JanuaryReconciliationPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const report = await getJanuaryGmvReconciliation({
    marketplace,
    reportMonth: parseMonth(searchParams?.month),
    sellerCenterGmv: parseMoney(searchParams?.sellerCenterGmv) ?? undefined
  });

  return (
    <>
      <PageHeader
        eyebrow="Reconciliation"
        title={`${marketplaceTitle} January GMV Reconciliation`}
        description="Read-only comparison of Seller Center GMV, imported report sources, and dashboard-included P&L rows."
      />

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <MetricCard label="Seller Center GMV" value={formatCurrency(report.sellerCenterGmv)} />
        <MetricCard label="Dashboard GMV" value={formatCurrency(report.dashboardGmv)} />
        <MetricCard
          label="Difference"
          value={formatCurrency(report.difference)}
          tone={Math.abs(report.difference) > 0.01 ? "warn" : "good"}
        />
      </section>

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-base font-semibold text-ink">Dashboard Source</h2>
        <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
          <InfoLine label="Active source" value={report.dashboardSource.activeSalesSourceLabel} />
          <InfoLine label="Tables" value={report.dashboardSource.tables.join(", ")} />
          <InfoLine label="Date field" value={report.dashboardSource.dateField} />
          <InfoLine label="Formula" value={report.dashboardFormula} />
          <InfoLine
            label="Detailed rows excluded"
            value={formatNumber(report.dashboardSource.excludedWhenMonthlySummaryExists)}
          />
        </div>
        <p className="mt-4 text-sm text-slate-600">{report.dashboardSource.sourcePreference}</p>
        <p className="mt-2 text-sm text-slate-600">{report.dashboardSource.suppressionNote}</p>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Source Totals">
          <DataTable
            headers={[
              "Source",
              "GMV",
              "Rows",
              "Orders",
              "Units",
              "Refunds",
              "Cancelled",
              "Dashboard"
            ]}
            rows={report.sourceSummaries.map((summary) => [
              summary.label,
              formatCurrency(summary.gmv),
              formatNumber(summary.rows),
              formatNumber(summary.orders),
              formatNumber(summary.units),
              formatCurrency(summary.refunds),
              formatCurrency(summary.cancelledSales),
              summary.includedInDashboard ? "Yes" : "No"
            ])}
          />
        </Panel>

        <Panel title="Difference Checks">
          <DataTable
            headers={["Check", "Amount", "Notes"]}
            rows={report.sourceDifference.map((row) => [
              row.label,
              formatCurrency(row.amount),
              row.notes
            ])}
          />
        </Panel>
      </section>

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-base font-semibold text-ink">Required Questions</h2>
        <div className="mt-4 grid gap-3">
          {report.answerChecklist.map((item) => (
            <div key={item.question} className="rounded-md bg-slate-50 p-3">
              <div className="text-sm font-semibold text-ink">{item.question}</div>
              <div className="mt-1 text-sm text-slate-700">{item.answer}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Skipped Rows">
          <IssueSection title="Item Sales Report" issues={report.skippedRows.itemSales} />
          <IssueSection title="PO / Order Reports" issues={report.skippedRows.orderReports} />
          <IssueSection title="Direct Sales Upload" issues={report.skippedRows.salesUpload} />
          <h3 className="mb-2 text-sm font-semibold text-ink">
            Order Rows Omitted Before Validation
          </h3>
          <DataTable
            headers={["File", "Rows", "Valid", "Rejected", "Omitted"]}
            rows={report.skippedRows.silentOrderReportSkips.map((run) => [
              run.originalFileName,
              formatNumber(run.rowCount),
              formatNumber(run.validCount),
              formatNumber(run.rejectedCount),
              formatNumber(run.omittedBeforeValidation)
            ])}
            emptyText="No silent order-row omissions found."
          />
        </Panel>

        <Panel title="Breakdown">
          <DataTable
            headers={["Category", "Amount"]}
            rows={[
              ["Cancelled sales metadata", formatCurrency(report.breakdown.cancelledSales)],
              ["Refund sales metadata", formatCurrency(report.breakdown.refundSales)],
              ["Order-report refunds", formatCurrency(report.breakdown.orderReportRefunds)],
              ["Duplicate import runs", formatNumber(report.duplicateHandling.duplicateImportRuns)],
              ["Duplicate row issues", formatNumber(report.duplicateHandling.duplicateIssueCount)]
            ]}
          />
        </Panel>
      </section>

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-base font-semibold text-ink">Largest SKU Differences</h2>
        <DataTable
          headers={["SKU", "Item Sales GMV", "Order Report GMV", "Dashboard GMV", "Difference"]}
          rows={report.breakdown.missingSkus.map((row) => [
            row.sku,
            formatCurrency(row.itemSalesGmv),
            formatCurrency(row.orderReportGmv),
            formatCurrency(row.dashboardGmv),
            formatCurrency(row.differenceFromDashboard)
          ])}
          emptyText="No SKU-level gaps found from imported rows."
        />
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <h2 className="text-base font-semibold text-ink">Import Runs</h2>
        <DataTable
          headers={["Report", "File", "Status", "Rows", "Valid", "Imported", "Rejected", "Created"]}
          rows={report.importRuns.map((run) => [
            run.reportType,
            run.originalFileName,
            run.status,
            formatNumber(run.rowCount),
            formatNumber(run.validCount),
            formatNumber(run.importedCount),
            formatNumber(run.rejectedCount),
            new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric"
            }).format(new Date(run.createdAt))
          ])}
          emptyText="No matching import runs found."
        />
      </section>
    </>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div
        className={
          tone === "warn"
            ? "mt-2 text-2xl font-semibold text-amber-700"
            : tone === "good"
              ? "mt-2 text-2xl font-semibold text-emerald-700"
              : "mt-2 text-2xl font-semibold text-ink"
        }
      >
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
      <h2 className="mb-4 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-medium text-ink">{value}</div>
    </div>
  );
}

function DataTable({
  headers,
  rows,
  emptyText = "No rows found."
}: {
  headers: string[];
  rows: string[][];
  emptyText?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-[0.1em] text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`} className="border-t border-slate-100">
                {row.map((cell, cellIndex) => (
                  <td key={`${cell}-${cellIndex}`} className="px-3 py-2 text-slate-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-8 text-center text-slate-500" colSpan={headers.length}>
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function IssueSection({
  title,
  issues
}: {
  title: string;
  issues: Array<{
    code: string;
    severity: string;
    count: number;
    gmvTotal: number;
    unitsTotal: number;
    sampleMessages: string[];
  }>;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <DataTable
        headers={["Code", "Severity", "Count", "GMV", "Units", "Sample"]}
        rows={issues.map((issue) => [
          issue.code,
          issue.severity,
          formatNumber(issue.count),
          formatCurrency(issue.gmvTotal),
          formatNumber(issue.unitsTotal),
          issue.sampleMessages.join(" | ")
        ])}
        emptyText="No skipped rows found."
      />
    </div>
  );
}

function parseMonth(value?: string) {
  return value && /^\d{4}-\d{2}$/.test(value) ? value : "2026-01";
}

function parseMoney(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
