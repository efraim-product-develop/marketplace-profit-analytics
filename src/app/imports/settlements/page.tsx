import { ImportUploadPage } from "../_components/import-upload-page";

export const dynamic = "force-dynamic";

export default function SettlementImportsPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return <ImportUploadPage importKind="settlements" error={searchParams?.error} />;
}
