import { PageHeader } from "@/components/page-header";
import { getCurrentMarketplaceTitleName } from "@/server/marketplaces/current";
import { AdSpendUploadClient } from "./ad-spend-upload-client";

export const dynamic = "force-dynamic";

export default function AdSpendUploadPage() {
  const marketplaceTitle = getCurrentMarketplaceTitleName();

  return (
    <>
      <PageHeader
        eyebrow="Ad Spend"
        title={`Upload ${marketplaceTitle} Connect Item Performance Report`}
        description="Choose the reporting period, then upload the Walmart Connect Item Performance file. Rows with daily dates inside that period will feed day, week, and custom P&L."
      />
      <AdSpendUploadClient marketplaceTitle={marketplaceTitle} />
    </>
  );
}
