import { ImportUploadPage } from "../_components/import-upload-page";

export const dynamic = "force-dynamic";

export default function SalesImportsPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return <ImportUploadPage importKind="sales" error={searchParams?.error} />;
}
