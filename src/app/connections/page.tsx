import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { getConnectionRows } from "@/server/connections/queries";
import {
  getCurrentMarketplace,
  getCurrentMarketplaceTitleName
} from "@/server/marketplaces/current";
import { getWalmartApiCredentialStatus } from "@/server/connectors/walmart/api-client";
import {
  saveConnection,
  saveWalmartApiCredentials,
  testApiConnection
} from "./actions";
import { ConnectionsTable } from "./connections-table";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams
}: {
  searchParams?: { apiError?: string };
}) {
  const marketplace = getCurrentMarketplace();
  const marketplaceTitle = getCurrentMarketplaceTitleName();
  const rows = await getConnectionRows(marketplace);
  const walmartApiStatus = marketplace === "walmart" ? getWalmartApiCredentialStatus() : null;
  const apiError = typeof searchParams?.apiError === "string" ? searchParams.apiError : null;

  return (
    <>
      <PageHeader
        eyebrow="Sources"
        title={`${marketplaceTitle} Connections`}
        description="Create and maintain marketplace source records while connector-specific logic stays outside the P&L core."
      />
      {walmartApiStatus ? (
        <section className="mb-6 rounded-md border border-slate-200 bg-white p-5 shadow-panel">
          {apiError ? (
            <div className="mb-5 rounded-md border border-brick/30 bg-brick/10 px-4 py-3 text-sm font-medium text-brick">
              {apiError}
            </div>
          ) : null}
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ocean">
                API Connection
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">
                Walmart Marketplace API
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Credentials stay in your local <code>.env</code> file. The app only saves
                connection status and test results.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                <StatusPill label="Client ID" ready={walmartApiStatus.clientId} />
                <StatusPill label="Client Secret" ready={walmartApiStatus.clientSecret} />
                <StatusPill
                  label={`Market: ${walmartApiStatus.market.toUpperCase()}`}
                  ready
                />
                <StatusPill
                  label="Channel Type"
                  ready={walmartApiStatus.consumerChannelType}
                  optional
                />
              </div>
              {walmartApiStatus.missing.length ? (
                <p className="mt-3 text-sm text-amber-700">
                  Add {walmartApiStatus.missing.join(" and ")} below, then test the connection.
                </p>
              ) : null}
            </div>
            <form action={testApiConnection}>
              <SubmitButton>Test API connection</SubmitButton>
            </form>
          </div>
          <form action={saveWalmartApiCredentials} className="mt-5 grid gap-4 border-t border-slate-200 pt-5 md:grid-cols-2">
            <Field label="Client ID">
              <input
                name="clientId"
                placeholder={walmartApiStatus.clientId ? "Configured - leave blank to keep" : "Paste Client ID"}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <Field label="Client Secret">
              <input
                name="clientSecret"
                type="password"
                placeholder={walmartApiStatus.clientSecret ? "Configured - leave blank to keep" : "Paste Client Secret"}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <Field label="Market">
              <input
                name="market"
                defaultValue={walmartApiStatus.market}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <Field label="API Base URL">
              <input
                name="baseUrl"
                defaultValue={walmartApiStatus.baseUrl}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <Field label="Service Name">
              <input
                name="serviceName"
                defaultValue="Walmart Marketplace"
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <Field label="Seller ID">
              <input
                name="sellerId"
                placeholder={walmartApiStatus.sellerId ?? "Optional"}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <Field label="Consumer Channel Type">
              <input
                name="consumerChannelType"
                placeholder={walmartApiStatus.consumerChannelType ? "Configured - leave blank to keep" : "Optional"}
                className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
              />
            </Field>
            <div className="flex items-end">
              <SubmitButton>Save API credentials</SubmitButton>
            </div>
          </form>
          <div className="mt-5 border-t border-slate-200 pt-5">
            <p className="text-sm text-slate-600">
              API credential testing is available here. Sales sync is paused while the Walmart
              API architecture is rebuilt around PO/order-style sales data and settlement
              financial data.
            </p>
          </div>
        </section>
      ) : null}
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

function StatusPill({
  label,
  ready,
  optional = false
}: {
  label: string;
  ready: boolean;
  optional?: boolean;
}) {
  const className = ready
    ? "bg-emerald-100 text-emerald-800"
    : optional
      ? "bg-slate-100 text-slate-600"
      : "bg-amber-100 text-amber-800";

  return (
    <span className={`rounded-md px-2.5 py-1 ${className}`}>
      {label}: {ready ? "Ready" : optional ? "Optional" : "Needed"}
    </span>
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
