import { PageHeader } from "@/components/page-header";
import { getCurrentMarketplaceTitleName } from "@/server/marketplaces/current";
import { SalesUploadForm } from "./sales-upload-form";

export const dynamic = "force-dynamic";

export default function SalesUploadPage() {
  const marketplaceTitle = getCurrentMarketplaceTitleName();

  return (
    <>
      <PageHeader
        eyebrow="Sales Inputs"
        title={`Upload ${marketplaceTitle} Sales Report`}
        description="Preview and import marketplace order exports into generic orders, order lines, fees, and refunds."
      />
      <SalesUploadForm marketplaceTitle={marketplaceTitle} />
    </>
  );
}
