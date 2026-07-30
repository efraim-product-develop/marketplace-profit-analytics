import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { getSettingsSummary } from "@/server/settings/queries";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getSettingsSummary();

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage local workspace defaults that every scoped query and import uses."
      />
      <form action={saveSettings} className="grid max-w-4xl gap-4 rounded-md border border-slate-200 bg-white p-5 shadow-panel md:grid-cols-2">
        <Field label="Default Currency">
          <input
            name="defaultCurrency"
            defaultValue={settings.defaultCurrency}
            maxLength={3}
            className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          />
        </Field>
        <Field label="Time Zone">
          <input
            name="timeZone"
            defaultValue={settings.timeZone}
            className="h-11 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          />
        </Field>
        <Field label="Cost Method">
          <select
            name="inventoryCostMethod"
            defaultValue={settings.inventoryCostMethod}
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20"
          >
            <option value="LATEST_EFFECTIVE_DATE">Latest effective date</option>
            <option value="WEIGHTED_AVERAGE">Weighted average</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <SubmitButton>Save Settings</SubmitButton>
        </div>
      </form>
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
