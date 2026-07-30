import { PageHeader } from "@/components/page-header";
import { getCurrentMarketplaceTitleName } from "@/server/marketplaces/current";
import { CogsUploadClient } from "./cogs-upload-client";

export const dynamic = "force-dynamic";

export default function CogsUploadPage() {
  const marketplaceTitle = getCurrentMarketplaceTitleName();

  return (
    <>
      <PageHeader
        eyebrow="Cost Inputs"
        title={`Upload ${marketplaceTitle} COGS`}
        description="Preview, validate, and import effective-dated SKU costs."
      />
      <CogsUploadClient marketplaceTitle={marketplaceTitle} />
    </>
  );
}
