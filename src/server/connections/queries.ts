import { prisma } from "@/lib/db";
import { listMarketplaceConnectors } from "@/server/connectors/registry";
import { getCurrentOrganizationId } from "@/server/organizations/current";

export type ConnectionRow = {
  id: string;
  marketplace: string;
  displayName: string;
  externalAccountId: string;
  status: string;
  syncMode: string;
  capabilities: string[];
  lastSyncedAt: string | null;
};

export async function getConnectionRows(marketplace?: string): Promise<ConnectionRow[]> {
  const organizationId = await getCurrentOrganizationId();
  const connectors = listMarketplaceConnectors();
  const connections = await prisma.marketplaceConnection.findMany({
    where: {
      organizationId,
      ...(marketplace ? { marketplace } : {})
    },
    orderBy: [{ marketplace: "asc" }, { displayName: "asc" }]
  });

  return connections.map((connection) => {
    const connector = connectors.find(
      (candidate) => candidate.marketplace === connection.marketplace
    );

    return {
      id: connection.id,
      marketplace: connection.marketplace,
      displayName: connection.displayName,
      externalAccountId: connection.externalAccountId ?? "",
      status: connection.status,
      syncMode: connection.syncMode,
      capabilities: connector ? capabilityLabels(connector.capabilities) : ["Manual"],
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null
    };
  });
}

function capabilityLabels(capabilities: {
  cogsUpload: boolean;
  orderImport: boolean;
  settlementImport: boolean;
  apiConnection: boolean;
}) {
  const labels = [];

  if (capabilities.cogsUpload) labels.push("COGS upload");
  if (capabilities.orderImport) labels.push("Order import");
  if (capabilities.settlementImport) labels.push("Settlement import");
  if (capabilities.apiConnection) labels.push("API");

  return labels.length ? labels : ["Manual"];
}
