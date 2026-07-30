"use client";

import { useMemo } from "react";
import { useFormState } from "react-dom";
import { AlertCircle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import {
  importSalesUpload,
  previewSalesUpload,
  type SalesUploadActionState
} from "./actions";

const initialState: SalesUploadActionState = { status: "idle" };

export function SalesUploadForm({
  marketplaceTitle
}: {
  marketplaceTitle: string;
}) {
  const [previewState, previewAction] = useFormState(previewSalesUpload, initialState);
  const [importState, importAction] = useFormState(importSalesUpload, initialState);
  const activeState = importState.status === "imported" ? importState : previewState;
  const summaryCards = useMemo(() => buildSummaryCards(activeState), [activeState]);

  return (
    <div className="grid gap-5">
      <form action={previewAction} className="max-w-4xl rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-5">
          {activeState.status === "error" && activeState.message ? (
            <StatusMessage tone="error" message={activeState.message} />
          ) : null}

          {activeState.status === "preview" && activeState.message ? (
            <StatusMessage tone="info" message={activeState.message} />
          ) : null}

          {activeState.status === "imported" && activeState.message ? (
            <StatusMessage tone="success" message={activeState.message} />
          ) : null}

          <div className="grid gap-5">
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              {marketplaceTitle} sales / order export
              <input
                name="file"
                type="file"
                required
                accept=".xlsx,.xls,.csv"
                className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 outline-none transition file:mr-4 file:rounded-md file:border-0 file:bg-ocean file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <FileSpreadsheet aria-hidden className="h-4 w-4 text-ocean" />
              Supports Walmart Seller Center .xlsx and .csv order exports
            </div>
            <SubmitButton>Preview Upload</SubmitButton>
          </div>
        </div>
      </form>

      {activeState.summary ? (
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">Import Summary</h2>
              <p className="text-sm text-slate-500">
                {activeState.fileName ? activeState.fileName : "Uploaded sales file"}
              </p>
            </div>
            {activeState.status === "preview" && activeState.payload ? (
              <form action={importAction}>
                <input type="hidden" name="payload" value={activeState.payload} />
                <SubmitButton>Import Rows</SubmitButton>
              </form>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                  {card.label}
                </div>
                <div className="mt-1 text-xl font-semibold text-ink">{card.value}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeState.previewRows?.length ? (
        <section className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Preview Rows</h2>
            <p className="text-sm text-slate-500">Showing the first 50 valid rows.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Gross Sales</th>
                  <th className="px-3 py-2 text-right">Fee Total</th>
                  <th className="px-3 py-2 text-right">Refund</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {activeState.previewRows.map((row) => (
                  <tr key={`${row.rowNumber}-${row.orderId}-${row.sku}`} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-medium text-ink">{row.orderId}</td>
                    <td className="px-3 py-2 text-slate-600">{row.lineId || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{formatDate(row.orderDate)}</td>
                    <td className="px-3 py-2 text-slate-800">{row.sku}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{row.quantity}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatMoney(row.grossSales)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatMoney(row.fees)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{formatMoney(row.refund)}</td>
                    <td className="px-3 py-2 text-slate-600">{row.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeState.issues?.length ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle aria-hidden className="h-4 w-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-amber-950">Row Issues</h2>
          </div>
          <div className="grid gap-2 text-sm">
            {activeState.issues.map((issue) => (
              <div key={`${issue.row}-${issue.code}-${issue.message}`} className="rounded-md bg-white px-3 py-2 text-amber-950">
                <span className="font-semibold">Row {issue.row}:</span> {issue.message}{" "}
                <span className="text-xs uppercase text-amber-700">({issue.severity})</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatusMessage({ tone, message }: { tone: "error" | "info" | "success"; message: string }) {
  const styles = {
    error: "border-brick/30 bg-brick/10 text-brick",
    info: "border-ocean/30 bg-ocean/10 text-ocean",
    success: "border-emerald-300 bg-emerald-50 text-emerald-800"
  };

  return (
    <div className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-medium ${styles[tone]}`}>
      {tone === "success" ? <CheckCircle2 aria-hidden className="h-4 w-4" /> : null}
      {message}
    </div>
  );
}

function buildSummaryCards(state: SalesUploadActionState) {
  const summary = state.summary;

  if (!summary) {
    return [];
  }

  return [
    { label: "Rows", value: `${summary.validRows} valid / ${summary.totalRowsRead} read` },
    { label: "Units", value: formatNumber(summary.totalUnits) },
    { label: "Gross Sales", value: formatMoney(summary.totalGrossSales) },
    { label: "Fee Total", value: formatMoney(summary.totalFees) },
    { label: "Refunds", value: formatMoney(summary.totalRefunds) },
    { label: "Issues", value: formatNumber(summary.rejectedRows) },
    { label: "Created", value: formatNumber(summary.importedRows ?? 0) },
    { label: "Updated", value: formatNumber(summary.updatedRows ?? 0) }
  ];
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-US", { timeZone: "UTC" });
}
