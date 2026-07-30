import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { formatDate, formatNumber } from "@/lib/format";
import { importKindConfigs } from "@/server/imports/framework";
import type { ImportKind } from "@/server/imports/types";
import { toRecord } from "@/server/imports/utils";
import { importPreviewedReport } from "../actions";
import type { getImportRun } from "@/server/imports/queries";

type ImportRun = NonNullable<Awaited<ReturnType<typeof getImportRun>>>;

export function ImportRunDetail({
  importKind,
  importRun
}: {
  importKind: ImportKind;
  importRun: ImportRun;
}) {
  const config = importKindConfigs[importKind];
  const canImport = importRun.status === "PENDING" && importRun.validCount > 0;

  return (
    <>
      <PageHeader
        eyebrow={config.eyebrow}
        title={importRun.reportTypeLabel}
        description={`${importRun.originalFileName} previewed on ${formatDate(importRun.createdAt)}.`}
        action={
          <Link
            className="grid h-10 place-items-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:border-ocean hover:text-ocean"
            href={`/imports/${importKind}`}
          >
            Back to imports
          </Link>
        }
      />

      <section className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Rows" value={formatNumber(importRun.rowCount)} />
        <KpiCard label="Valid" value={formatNumber(importRun.validCount)} tone="good" />
        <KpiCard
          label="Rejected"
          value={formatNumber(importRun.rejectedCount)}
          tone={importRun.rejectedCount ? "warn" : "neutral"}
        />
        <KpiCard
          label="Imported"
          value={formatNumber(importRun.importedCount)}
          detail={importRun.status.replace("_", " ")}
          tone={importRun.status === "FAILED" ? "bad" : importRun.status === "PENDING" ? "neutral" : "good"}
        />
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Import Summary</h2>
              <p className="mt-1 text-sm text-slate-500">
                Detected automatically from the uploaded file.
              </p>
            </div>
            <StatusBadge status={importRun.status} />
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryItem label="Marketplace" value={importRun.marketplace} />
            <SummaryItem label="Report type" value={importRun.reportType} />
            <SummaryItem label="File hash" value={importRun.fileHash.slice(0, 12)} />
            <SummaryItem label="Imported at" value={importRun.importedAt ? formatDate(importRun.importedAt) : "Not imported"} />
            {Object.entries(toRecord(importRun.summary)).map(([key, value]) => (
              <SummaryItem key={key} label={formatSummaryLabel(key)} value={formatSummaryValue(value)} />
            ))}
          </dl>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          <h2 className="text-base font-semibold text-ink">Next Step</h2>
          {canImport ? (
            <>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review the preview rows and validation messages. Importing will save this report and update the connected records for this report type.
              </p>
              <form action={importPreviewedReport} className="mt-4">
                <input name="importKind" type="hidden" value={importKind} />
                <input name="importRunId" type="hidden" value={importRun.id} />
                <SubmitButton>Import Report</SubmitButton>
              </form>
            </>
          ) : importRun.status === "PENDING" ? (
            <EmptyState
              icon="warn"
              title="Nothing ready to import"
              message="Fix the validation issues or use a report with importable rows."
            />
          ) : (
            <EmptyState
              icon={importRun.status === "FAILED" ? "warn" : "ok"}
              title={importRun.status === "FAILED" ? "Import blocked" : "Import complete"}
              message={importRun.status === "FAILED" ? "This run was not imported." : "This run is saved in import history."}
            />
          )}
        </div>
      </section>

      <section className="mb-6 rounded-md border border-slate-200 bg-white shadow-panel">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">Preview Rows</h2>
          <p className="mt-1 text-sm text-slate-500">
            Showing the first validated rows stored for this import.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3">Row</th>
                <th className="border-b border-slate-200 px-4 py-3">Status</th>
                <th className="border-b border-slate-200 px-4 py-3">Data</th>
                <th className="border-b border-slate-200 px-4 py-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {importRun.previewRows.length ? (
                importRun.previewRows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-slate-700">{row.rowNumber}</td>
                    <td className="px-4 py-3">
                      <RowStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatPreviewData(toRecord(row.normalizedData))}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{row.message ?? ""}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    No preview rows stored.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white shadow-panel">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">Validation Issues</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {importRun.issues.length ? (
            importRun.issues.map((issue) => (
              <div key={issue.id} className="grid gap-1 px-5 py-4 text-sm">
                <div className="font-semibold text-ink">
                  Row {issue.rowNumber}: {issue.code}
                </div>
                <div className="text-slate-600">{issue.message}</div>
              </div>
            ))
          ) : (
            <div className="px-5 py-6 text-sm text-slate-500">
              No validation issues found.
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  message
}: {
  icon: "ok" | "warn";
  title: string;
  message: string;
}) {
  const Icon = icon === "ok" ? CheckCircle2 : AlertTriangle;

  return (
    <div className="mt-4 rounded-md bg-slate-50 p-4">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <Icon aria-hidden className={icon === "ok" ? "h-4 w-4 text-emerald-600" : "h-4 w-4 text-amber-600"} />
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "IMPORTED"
      ? "bg-emerald-100 text-emerald-800"
      : status === "NEEDS_REVIEW"
        ? "bg-amber-100 text-amber-800"
        : status === "FAILED"
          ? "bg-brick/10 text-brick"
          : "bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${className}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function RowStatusBadge({ status }: { status: string }) {
  const className =
    status === "valid"
      ? "bg-emerald-100 text-emerald-800"
      : status === "warning"
        ? "bg-amber-100 text-amber-800"
        : "bg-brick/10 text-brick";

  return (
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

function formatPreviewData(data: Record<string, unknown>) {
  const entries = Object.entries(data);

  if (!entries.length) {
    return "";
  }

  return entries
    .slice(0, 8)
    .map(([key, value]) => `${formatSummaryLabel(key)}: ${formatSummaryValue(value)}`)
    .join(" | ");
}

function formatSummaryLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSummaryValue(value: unknown) {
  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}
