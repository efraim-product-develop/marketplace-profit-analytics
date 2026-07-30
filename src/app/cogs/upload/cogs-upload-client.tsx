"use client";

import * as XLSX from "xlsx";
import { CheckCircle2, Download, FileSpreadsheet, UploadCloud, XCircle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  missingCogsColumns,
  normalizeRawCogsRow,
  requiredCogsColumns,
  type RawCogsImportRow,
  validateCogsRows
} from "@/lib/cogs-import";
import { importCogsRows, type CogsImportResult } from "./actions";

export function CogsUploadClient({ marketplaceTitle }: { marketplaceTitle: string }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<RawCogsImportRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [result, setResult] = useState<CogsImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const validation = useMemo(() => validateCogsRows(rows), [rows]);
  const validRows = validation.filter((row) => row.row);
  const errorRows = validation.filter((row) => row.errors.length);
  const costDateCount = new Set(validRows.map((row) => row.row?.effectiveDate.slice(0, 10))).size;
  const exportUrl = "/cogs/export";
  const canImport = rows.length > 0 && fileErrors.length === 0 && errorRows.length === 0;

  async function handleFileChange(file: File | undefined) {
    setResult(null);
    setRows([]);
    setFileErrors([]);

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setFileErrors(["Upload an .xlsx file."]);
      return;
    }

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: true
      });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        setFileErrors(["The workbook does not contain a worksheet."]);
        return;
      }

      const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: ""
      });
      const headers = (headerRows[0] ?? []).map((header) => String(header));
      const missingColumns = missingCogsColumns(headers);

      if (missingColumns.length) {
        setFileErrors([`Missing required columns: ${missingColumns.join(", ")}.`]);
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: ""
      });
      setRows(rawRows.map((row, index) => normalizeRawCogsRow(row, index + 2)));
    } catch {
      setFileErrors(["The workbook could not be read. Confirm it is a valid .xlsx file."]);
    }
  }

  function handleImport() {
    startTransition(async () => {
      const importResult = await importCogsRows({
        originalFileName: fileName,
        rows
      });
      setResult(importResult);
    });
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-5 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            {marketplaceTitle} COGS Workbook
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => handleFileChange(event.target.files?.[0])}
              className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-600 outline-none file:mr-4 file:rounded-md file:border-0 file:bg-ocean file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white focus:border-ocean focus:ring-2 focus:ring-ocean/20"
            />
          </label>
          <a
            href={exportUrl}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-ocean hover:text-ocean"
          >
            <Download aria-hidden className="h-4 w-4" />
            Download Current
          </a>
          <button
            type="button"
            disabled={!canImport || isPending}
            onClick={handleImport}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-ocean px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#066a74] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UploadCloud aria-hidden className="h-4 w-4" />
            {isPending ? "Importing" : "Import"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          {requiredCogsColumns.map((column) => (
            <span key={column} className="rounded-md bg-slate-100 px-2 py-1">
              {column}
            </span>
          ))}
        </div>
      </section>

      {fileErrors.length ? (
        <MessagePanel tone="bad" title="Workbook Errors" messages={fileErrors} />
      ) : null}

      {result ? <ImportSummary result={result} /> : null}

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Rows" value={rows.length.toString()} />
        <Metric label="Valid" value={validRows.length.toString()} />
        <Metric
          label="Errors"
          value={errorRows.length.toString()}
          tone={errorRows.length ? "bad" : "good"}
        />
        <Metric label="Cost Dates" value={costDateCount.toString()} />
      </section>

      <PreviewTable validation={validation} />
    </div>
  );
}

function ImportSummary({ result }: { result: CogsImportResult }) {
  const messages = [
    `${result.importedRows} rows imported.`,
    `${result.createdRows} created, ${result.updatedRows} updated.`,
    `${result.batchCount} cost batches touched.`,
    `${result.errorCount} validation errors.`
  ];

  return (
    <MessagePanel
      tone={result.ok ? "good" : "bad"}
      title={result.message}
      messages={[
        ...messages,
        ...result.errors.map((error) => `Row ${error.rowNumber}: ${error.message}`)
      ]}
    />
  );
}

function PreviewTable({ validation }: { validation: ReturnType<typeof validateCogsRows> }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <FileSpreadsheet aria-hidden className="h-4 w-4 text-ocean" />
          Preview
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Row</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Effective</th>
              <th className="px-4 py-3">Unit COGS</th>
              <th className="px-4 py-3">Errors</th>
            </tr>
          </thead>
          <tbody>
            {validation.length ? (
              validation.slice(0, 100).map((result) => (
                <tr key={result.rowNumber} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    {result.errors.length ? (
                      <XCircle aria-label="Invalid" className="h-4 w-4 text-brick" />
                    ) : (
                      <CheckCircle2 aria-label="Valid" className="h-4 w-4 text-ocean" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{result.rowNumber}</td>
                  <td className="px-4 py-3">{result.row?.sku ?? "-"}</td>
                  <td className="px-4 py-3">
                    {result.row?.effectiveDate ? formatDate(result.row.effectiveDate) : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {result.row ? formatCurrency(result.row.unitCogs) : "-"}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-brick">{result.errors.join(" ")}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  Choose an .xlsx workbook to preview rows.
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
  tone: "good" | "bad";
}) {
  return (
    <section
      className={
        tone === "good"
          ? "rounded-md border border-ocean/30 bg-ocean/10 p-4 text-ocean"
          : "rounded-md border border-brick/30 bg-brick/10 p-4 text-brick"
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
