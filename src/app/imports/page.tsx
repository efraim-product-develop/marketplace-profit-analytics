import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  FileSpreadsheet,
  Megaphone,
  PackageOpen,
  ReceiptText,
  UploadCloud
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getCurrentMarketplaceTitleName } from "@/server/marketplaces/current";

const importOptions: Array<{
  href: Route;
  title: string;
  description: string;
  icon: typeof UploadCloud;
}> = [
  {
    href: "/cogs/upload",
    title: "COGS",
    description: "Upload effective-dated SKU costs for P&L calculations.",
    icon: UploadCloud
  },
  {
    href: "/imports/sales",
    title: "Sales reports",
    description: "Import daily Walmart Item Sales reports as the P&L sales source.",
    icon: ReceiptText
  },
  {
    href: "/imports/settlements",
    title: "Settlement reports",
    description: "Import Walmart payment reports for fulfillment, fees, refunds, and SEM.",
    icon: FileSpreadsheet
  },
  {
    href: "/ad-spend/upload",
    title: "Walmart Connect ads",
    description: "Upload daily Item Performance reports for advertising spend.",
    icon: Megaphone
  },
  {
    href: "/imports/inventory",
    title: "Inventory reports",
    description: "Upload inventory reports as new marketplace parsers are added.",
    icon: PackageOpen
  }
];

export const dynamic = "force-dynamic";

export default function ManualImportsPage() {
  const marketplaceTitle = getCurrentMarketplaceTitleName();

  return (
    <>
      <PageHeader
        eyebrow="Manual Imports"
        title={`${marketplaceTitle} Manual Imports`}
        description="Upload marketplace files from one place. Choose the report type, preview the rows, then import when the data looks right."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {importOptions.map((option) => {
          const Icon = option.icon;

          return (
            <Link
              key={option.href}
              href={option.href}
              className="group flex min-h-40 flex-col justify-between rounded-md border border-slate-200 bg-white p-5 shadow-panel transition hover:border-ocean/40 hover:bg-slate-50"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-ocean/10 text-ocean">
                    <Icon aria-hidden className="h-5 w-5" />
                  </span>
                  <h2 className="text-base font-semibold text-ink">{option.title}</h2>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{option.description}</p>
              </div>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-ocean">
                Open upload
                <ArrowRight
                  aria-hidden
                  className="h-4 w-4 transition group-hover:translate-x-0.5"
                />
              </div>
            </Link>
          );
        })}
      </section>
    </>
  );
}
