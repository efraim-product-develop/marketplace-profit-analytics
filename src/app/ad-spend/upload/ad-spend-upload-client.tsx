"use client";

import { CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useState, useTransition } from "react";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  AD_SOURCE_CONNECT,
  getAdSpendRequiredColumns,
  type AdSpendReportType,
  type ValidatedAdSpendImportRow
} from "@/lib/ad-spend-import";
import { AD_SPEND_UPLOAD_MAX_BYTES, AD_SPEND_UPLOAD_MAX_LABEL } from "@/lib/upload-limits";
import {
  importPreviewedAdSpendRows,
  previewAdSpendFile,
  type AdSpendImportResult
} from "./actions";

export function AdSpendUploadClient({
  marketplaceTitle
}: {
  marketplaceTitle: string;
}) {
  const reportType: AdSpendReportType = AD_SOURCE_CONNECT;
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const defaultPeriod = getDefaultReportPeriod();
  const [reportStartDate, setReportStartDate] = useState(defaultPeriod.startDate);
  const [reportEndDate, setReportEndDate] = useState(defaultPeriod.endDate);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [result, setResult] = useState<AdSpendImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const previewRows = result?.previewRows ?? [];
  const canPreview = Boolean(file) && fileErrors.length === 0;
  const canImport = Boolean(result?.ok && result.importRunId && fileErrors.length === 0);

  async function handleFileChange(file: File | undefined) {
    setResult(null);
    setFileErrors([]);

    if (!file) {
      setFile(null);
      setFileName("");
      return;
    }

    setFile(file);
    setFileName(file.name);

    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      setFileErrors(["Upload a .csv, .xlsx, or .xls file."]);
      return;
    }

    if (file.size > AD_SPEND_UPLOAD_MAX_BYTES) {
      setFileErrors([`The selected file is too large. Maximum file size: ${AD_SPEND_UPLOAD_MAX_LABEL}.`]);
    }
  }

  function handlePreview() {
    if (!file) {
      setFileErrors(["Choose a Walmart Connect report to upload."]);
      return;
    }

    if (!reportStartDate || !reportEndDate) {
      setFileErrors(["Choose the reporting period for this Walmart Connect file."]);
      return;
    }

    if (reportEndDate < reportStartDate) {
      setFileErrors(["The reporting period end date must be on or after the start date."]);
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("reportType", reportType);
      formData.set("reportStartDate", reportStartDate);
      formData.set("reportEndDate", reportEndDate);
      setResult(await previewAdSpendFile(formData));
    });
  }

  function handleImport() {
    if (!result?.importRunId) {
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("importRunId", result.importRunId ?? "");
      setResult(await importPreviewedAdSpendRows(formData));
    });
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-5 lg:grid-cols-[minmax(160px,190px)_minmax(160px,190px)_1fr_auto_auto] lg:items-end">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            From
            <input
              type="date"
              value={reportStartDate}
              onChange={(event) => {
                setResult(null);
                setReportStartDate(event.target.value);
                setFileErrors((errors) =>
                  errors.filter((error) => !error.toLowerCase().includes("reporting period"))
                );
              }}
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-700">
            To
            <input
              type="date"
              value={reportEndDate}
              onChange={(event) => {
                setResult(null);
                setReportEndDate(event.target.value);
                setFileErrors((errors) =>
                  errors.filter((error) => !error.toLowerCase().includes("reporting period"))
                );
              }}
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {marketplaceTitle} Walmart Connect Item Performance file
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(event) => handleFileChange(event.target.files?.[0])}
              className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-600 outline-none file:mr-4 file:rounded-md file:border-0 file:bg-ocean file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            />
          </label>

          <button
            type="button"
            disabled={!canPreview || isPending}
            onClick={handlePreview}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ocean px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#066a74] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UploadCloud aria-hidden className="h-4 w-4" />
            {isPending ? "Previewing" : "Preview"}
          </button>

          <button
            type="button"
            disabled={!canImport || isPending}
            onClick={handleImport}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UploadCloud aria-hidden className="h-4 w-4" />
            {isPending ? "Importing" : "Import"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          <span className="rounded-md bg-slate-100 px-2 py-1">
            Maximum file size: {AD_SPEND_UPLOAD_MAX_LABEL}
          </span>
          <span className="rounded-md bg-slate-100 px-2 py-1">
            Rows outside the selected period are skipped
          </span>
          {getAdSpendRequiredColumns(reportType).map((column) => (
            <span key={column} className="rounded-md bg-slate-100 px-2 py-1">
              {column}
            </span>
          ))}
          <span className="rounded-md bg-slate-100 px-2 py-1">campaign_name</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">clicks</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">impressions</span>
          <span className="rounded-md bg-slate-100 px-2 py-1">total_attributed_sales</span>
        </div>
      </section>

      {fileErrors.length ? (
        <MessagePanel tone="bad" title="File Errors" messages={fileErrors} />
      ) : null}

      {result ? <ImportSummary result={result} /> : null}

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Rows Read" value={formatNumber(result?.totalRows ?? 0)} />
        <Metric label="Valid" value={formatNumber(result?.validRows ?? 0)} />
        <Metric label="Skipped" value={formatNumber(result?.skippedRows ?? 0)} />
        <Metric
          label="Errors"
          value={formatNumber(result?.errorCount ?? 0)}
          tone={result?.errorCount ? "bad" : "good"}
        />
        <Metric label="Spend" value={formatCurrency(result?.totalSpend ?? 0)} />
        <Metric label="Clicks" value={formatNumber(result?.totalClicks ?? 0)} />
        <Metric label="Impressions" value={formatNumber(result?.totalImpressions ?? 0)} />
        <Metric label="Attributed Sales" value={formatCurrency(result?.totalAttributedSales ?? 0)} />
      </section>

      <PreviewTable rows={previewRows} hasRows={Boolean(result)} />

      {result?.errors.length ? (
        <MessagePanel
          tone="bad"
          title="Row Errors"
          messages={result.errors.slice(0, 100).map((row) => {
            return `Row ${row.rowNumber}: ${row.message}`;
          })}
        />
      ) : null}

      {result?.skippedMessages.length ? (
        <MessagePanel
          tone="neutral"
          title="Skipped Rows"
          messages={result.skippedMessages.slice(0, 100).map((row) => {
            return `Row ${row.rowNumber}: ${row.message}`;
          })}
        />
      ) : null}
    </div>
  );
}

function ImportSummary({ result }: { result: AdSpendImportResult }) {
  return (
    <MessagePanel
      tone={result.ok ? "good" : "bad"}
      title={result.message}
      messages={[
        result.reportTypeLabel,
        `${formatNumber(result.totalRows)} rows read.`,
        `${formatNumber(result.validRows)} valid rows.`,
        `${formatNumber(result.skippedRows)} rows skipped.`,
        `${formatNumber(result.importedRows)} rows imported.`,
        `${formatNumber(result.updatedRows)} rows updated.`,
        `${formatCurrency(result.totalSpend)} spend.`,
        `${formatCurrency(result.totalAttributedSales)} attributed sales.`,
        ...result.errors.map((error) => `Row ${error.rowNumber}: ${error.message}`)
      ]}
    />
  );
}

function PreviewTable({
  rows,
  hasRows
}: {
  rows: ValidatedAdSpendImportRow[];
  hasRows: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileSpreadsheet aria-hidden className="h-4 w-4 text-ocean" />
          Preview
        </div>
        <p className="mt-1 text-xs text-slate-500">Showing the first 50 valid rows.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Row</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Spend</th>
              <th className="px-4 py-3 text-right">Clicks</th>
              <th className="px-4 py-3 text-right">Impressions</th>
              <th className="px-4 py-3 text-right">Attributed Sales</th>
              <th className="px-4 py-3">Campaign</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) =>
                row ? (
                  <tr
                    key={`${row.rowNumber}-${row.duplicateKey}`}
                    className="border-t border-slate-100"
                  >
                    <td className="px-4 py-3">
                      <CheckCircle2 aria-label="Valid" className="h-4 w-4 text-ocean" />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.rowNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{row.reportDate}</td>
                    <td className="px-4 py-3 font-medium text-ink">{row.sku}</td>
                    <td className="px-4 py-3 text-slate-600">{row.itemName || row.itemId || "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(row.spend, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatNumber(row.clicks)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatNumber(row.impressions)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">
                      {formatCurrency(row.attributedSales, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.campaignName || "-"}</td>
                  </tr>
                ) : null
              )
            ) : (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                  {hasRows
                    ? "Fix row errors to preview valid rows."
                    : "Choose an advertising file to preview rows."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div
        className={
          tone === "bad"
            ? "mt-2 text-2xl font-semibold text-brick"
            : tone === "good"
              ? "mt-2 text-2xl font-semibold text-ocean"
              : "mt-2 text-2xl font-semibold text-ink"
        }
      >
        {value}
      </div>
    </div>
  );
}

function MessagePanel({
  title,
  messages,
  tone
}: {
  title: string;
  messages: string[];
  tone: "good" | "bad" | "neutral";
}) {
  return (
    <section
      className={
        tone === "good"
          ? "rounded-md border border-ocean/30 bg-ocean/10 p-4 text-ocean"
          : tone === "bad"
            ? "rounded-md border border-brick/30 bg-brick/10 p-4 text-brick"
            : "rounded-md border border-slate-200 bg-white p-4 text-slate-700 shadow-panel"
      }
    >
      <div className="text-sm font-semibold">{title}</div>
      <ul className="mt-2 grid gap-1 text-sm">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </section>
  );
}

function getDefaultReportPeriod() {
  const date = new Date();
  const startDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    "01"
  ].join("-");
  const endDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");

  return { startDate, endDate };
}
