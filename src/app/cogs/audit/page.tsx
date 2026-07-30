import { PageHeader } from "@/components/page-header";
import { getCostAuditData } from "@/server/cogs/queries";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import {
  CogsAuditTable,
  CogsIssueTable,
  CogsUploadHistoryTable
} from "./cogs-audit-table";

export const dynamic = "force-dynamic";

export default async function CogsAuditPage() {
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const data = await getCostAuditData(marketplace);

  return (
    <>
      <PageHeader
        eyebrow="Cost Inputs"
        title={`${marketplaceTitle} COGS Audit`}
        description="Review effective-dated unit costs, upload history, row issues, and product/listing matching."
      />
      <section className="grid gap-6">
        <AuditSection title="Cost Records" count={data.rows.length}>
          <CogsAuditTable rows={data.rows} />
        </AuditSection>
        <AuditSection title="Upload History" count={data.uploads.length}>
          <CogsUploadHistoryTable rows={data.uploads} />
        </AuditSection>
        <AuditSection title="Row Issues" count={data.issues.length}>
          <CogsIssueTable rows={data.issues} />
        </AuditSection>
      </section>
    </>
  );
}

function AuditSection({
  title,
  count,
  children
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-500">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}
