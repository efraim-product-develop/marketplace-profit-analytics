import { prisma } from "@/lib/db";
import { listMarketplaceConnectors } from "@/server/connectors/registry";

export const LOCAL_ORGANIZATION_SLUG = "local-workspace";

const localOrganization = {
  name: "Local Workspace",
  slug: LOCAL_ORGANIZATION_SLUG
};

export async function getCurrentOrganization() {
  const defaultMarketplace = listMarketplaceConnectors()[0]?.marketplace ?? "marketplace";

  return prisma.organization.upsert({
    where: { slug: LOCAL_ORGANIZATION_SLUG },
    update: {},
    create: {
      ...localOrganization,
      settings: {
        create: {
          defaultCurrency: "USD",
          timeZone: "America/New_York",
          defaultMarketplace
        }
      }
    }
  });
}

export async function getCurrentOrganizationId() {
  const organization = await getCurrentOrganization();
  return organization.id;
}
