import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { formatDate, formatNumber } from "@/lib/format";
import { importKindConfigs } from "@/server/imports/framework";
import { getImportHistory } from "@/server/imports/queries";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import type { ImportKind } from "@/server/imports/types";
import { previewImport } from "../actions";

const errorMessages: Record<string, string> = {
  "missing-file": "Choose a report file before previewing.",
  "missing-import": "Choose an import before continuing."
};

export async function ImportUploadPage({
  importKind,
  error
}: {
  importKind: ImportKind;
  error?: string;
}) {
  const config = importKindConfigs[importKind];
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const history = await getImportHistory(importKind, marketplace);
  const message = error ? errorMessages[error] ?? "The import could not be started." : null;

  return (
    <>
      <PageHeader
        eyebrow={config.eyebrow}
        title={buildImportPageTitle(marketplaceTitle, importKind)}
        description={config.description}
      />

      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <form action={previewImport} className="rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          <input name="importKind" type="hidden" value={importKind} />
          <div className="grid gap-5">
            {message ? (
              <div className="rounded-md border border-brick/30 bg-brick/10 px-4 py-3 text-sm font-medium text-brick">
                {message}
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Report File
              <input
                name="file"
                type="file"
                required
                accept=".xlsx,.xls,.csv"
                className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-sm text-slate-600 outline-none transition file:mr-4 file:rounded-md file:border-0 file:bg-ocean file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </label>

            <div className="flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <FileSpreadsheet aria-hidden className="h-4 w-4 text-ocean" />
                {config.fileHelp}
              </div>
              <SubmitButton>Preview</SubmitButton>
            </div>
          </div>
        </form>

        <div className="rounded-md border border-slate-200 bg-white shadow-panel">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-ink">Import History</h2>
            <p className="mt-1 text-sm text-slate-500">
              Previous previews and completed imports for this report area.
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {history.length ? (
              history.map((item) => (
                <Link
                  key={item.id}
                  href={`/imports/${importKind}/${item.id}`}
                  className="grid gap-2 px-5 py-4 transition hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink">{item.reportTypeLabel}</div>
                      <div className="mt-1 text-sm text-slate-500">{item.originalFileName}</div>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{formatDate(item.createdAt)}</span>
                    <span>{formatNumber(item.validCount)} valid</span>
                    <span>{formatNumber(item.rejectedCount)} rejected</span>
                    <span>{formatNumber(item._count.issues)} issues</span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-5 py-10 text-sm text-slate-500">
                No imports yet.
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function buildImportPageTitle(marketplaceTitle: string, importKind: ImportKind) {
  if (importKind === "sales") {
    return `Upload ${marketplaceTitle} Sales Report`;
  }

  if (importKind === "settlements") {
    return `Upload ${marketplaceTitle} Settlement Report`;
  }

  if (importKind === "advertising") {
    return `Upload ${marketplaceTitle} Seller Center SEM Report`;
  }

  if (importKind === "inventory") {
    return `Upload ${marketplaceTitle} SKU / Parent Mapping`;
  }

  return `Upload ${marketplaceTitle} Report`;
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
