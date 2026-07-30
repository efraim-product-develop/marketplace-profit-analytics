import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { getConnectionRows } from "@/server/connections/queries";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import { saveConnection } from "./actions";
import { ConnectionsTable } from "./connections-table";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const rows = await getConnectionRows(marketplace);

  return (
    <>
      <PageHeader
        eyebrow="Sources"
        title={`${marketplaceTitle} Connections`}
        description="Create and maintain marketplace source records while connector-specific logic stays outside the P&L core."
      />
      <form action={saveConnection} className="mb-6 grid gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-panel md:grid-cols-4">
        <Field label="Display Name">
          <input name="displayName" required placeholder="Primary Marketplace" className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20" />
        </Field>
        <Field label="External Account">
          <input name="externalAccountId" placeholder="Seller ID" className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20" />
        </Field>
        <Field label="Status">
          <select name="status" className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20">
            <option value="DRAFT">Draft</option>
            <option value="CONNECTED">Connected</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </Field>
        <div className="flex items-end">
          <SubmitButton>Save</SubmitButton>
        </div>
      </form>
      <ConnectionsTable rows={rows} />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}
