import { prisma } from "@/lib/db";
import { listMarketplaceConnectors } from "@/server/connectors/registry";
import { getCurrentOrganizationId } from "@/server/organizations/current";

export type SettingsSummary = {
  defaultCurrency: string;
  timeZone: string;
  defaultMarketplace: string;
  inventoryCostMethod: string;
};

export async function getSettingsSummary(): Promise<SettingsSummary> {
  const organizationId = await getCurrentOrganizationId();
  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId }
  });

  return {
    defaultCurrency: settings?.defaultCurrency ?? "USD",
    timeZone: settings?.timeZone ?? "America/New_York",
    defaultMarketplace:
      settings?.defaultMarketplace ?? listMarketplaceConnectors()[0]?.marketplace ?? "marketplace",
    inventoryCostMethod: settings?.inventoryCostMethod ?? "LATEST_EFFECTIVE_DATE"
  };
}
