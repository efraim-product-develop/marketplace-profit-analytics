import { notFound } from "next/navigation";
import { ImportRunDetail } from "../../_components/import-run-detail";
import { getImportRun } from "@/server/imports/queries";
import { getCurrentMarketplace } from "@/server/marketplaces/current";

export const dynamic = "force-dynamic";

export default async function SalesImportDetailPage({
  params
}: {
  params: { importRunId: string };
}) {
  const importRun = await getImportRun("sales", params.importRunId, getCurrentMarketplace());

  if (!importRun) {
    notFound();
  }

  return <ImportRunDetail importKind="sales" importRun={importRun} />;
}
