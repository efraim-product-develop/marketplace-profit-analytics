import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { getCurrentMarketplaceTitleName } from "@/server/marketplaces/current";
import { uploadAdvertisingCosts } from "./actions";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  "missing-file": "Choose an Excel file before uploading.",
  "no-valid-rows": "The workbook did not contain valid ad spend rows.",
  database: "The upload could not be saved. Check the database connection and migrations."
};

export default function AdvertisingUploadPage({
  searchParams
}: {
  searchParams: { error?: string };
}) {
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const error = searchParams.error ? errorMessages[searchParams.error] : null;

  return (
    <>
      <PageHeader
        eyebrow="Ad Spend"
        title={`Upload ${marketplaceTitle} Ad Spend`}
        description="Import seller-center advertising spend for P&L reporting."
      />
      <form action={uploadAdvertisingCosts} className="max-w-3xl rounded-md border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-5">
          {error ? (
            <div className="rounded-md border border-brick/30 bg-brick/10 px-4 py-3 text-sm font-medium text-brick">
              {error}
            </div>
          ) : null}
          <label className="grid gap-2 text-sm font-medium text-slate-700">
            Excel File
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
              <Megaphone aria-hidden className="h-4 w-4 text-ocean" />
              Columns: date, SKU or parent SKU, ad spend, optional campaign
            </div>
            <SubmitButton>Upload</SubmitButton>
          </div>
        </div>
      </form>
    </>
  );
}
