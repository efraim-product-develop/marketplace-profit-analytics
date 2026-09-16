import Link from "next/link";
import type { Route } from "next";
import {
  ArrowRight,
  ClipboardCheck,
  FileSpreadsheet,
  Megaphone,
  PackageOpen,
  ReceiptText,
  Truck,
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
    href: "/imports/audit" as Route,
    title: "Data quality audit",
    description: "Check whether PO, settlement, SEM, Walmart Connect, and COGS data are complete for a period.",
    icon: ClipboardCheck
  },
  {
    href: "/cogs/upload",
    title: "COGS",
    description: "Upload effective-dated SKU costs for P&L calculations.",
    icon: UploadCloud
  },
  {
    href: "/imports/sales",
    title: "Sales reports",
    description: "Import Walmart PO reports as the Walmart sales source.",
    icon: ReceiptText
  },
  {
    href: "/imports/settlements",
    title: "Settlement reports",
    description: "Import Walmart payment reports for payouts, refunds, fulfillment, and fees.",
    icon: FileSpreadsheet
  },
  {
    href: "/ad-spend/upload",
    title: "Walmart Connect ads",
    description: "Upload daily Item Performance reports for advertising spend.",
    icon: Megaphone
  },
  {
    href: "/imports/seller-shipping",
    title: "Seller fulfilled shipping",
    description: "Enter monthly seller fulfilled shipping costs as marketplace-level P&L expenses.",
    icon: Truck
  },
  {
    href: "/imports/inventory",
    title: "SKU / Parent Mapping",
    description: "Import Walmart Item Sales only to map SKUs to parent products.",
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
