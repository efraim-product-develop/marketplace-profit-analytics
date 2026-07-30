import { ImportUploadPage } from "../_components/import-upload-page";

export const dynamic = "force-dynamic";

export default function InventoryImportsPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return <ImportUploadPage importKind="inventory" error={searchParams?.error} />;
}
