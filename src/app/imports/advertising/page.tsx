import { ImportUploadPage } from "../_components/import-upload-page";

export const dynamic = "force-dynamic";

export default function AdvertisingImportsPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  return <ImportUploadPage importKind="advertising" error={searchParams?.error} />;
}
