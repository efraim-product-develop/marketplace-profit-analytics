import { cookies } from "next/headers";
import {
  ACTIVE_MARKETPLACE_COOKIE,
  getMarketplaceDisplayName,
  getMarketplaceTitleName,
  type MarketplaceOption
} from "@/lib/marketplace-context";
import { getMarketplaceConnector, listMarketplaceConnectors } from "@/server/connectors/registry";

export function getMarketplaceOptions(): MarketplaceOption[] {
  return listMarketplaceConnectors().map((connector) => ({
    marketplace: connector.marketplace,
    displayName: connector.displayName
  }));
}

export function getCurrentMarketplace() {
  const rawMarketplace = cookies().get(ACTIVE_MARKETPLACE_COOKIE)?.value?.trim().toLowerCase();
  const cookieConnector = rawMarketplace ? getMarketplaceConnector(rawMarketplace) : null;

  return cookieConnector?.marketplace ?? listMarketplaceConnectors()[0]?.marketplace ?? "marketplace";
}

export function getCurrentMarketplaceDisplayName() {
  return getMarketplaceDisplayName(getCurrentMarketplace(), getMarketplaceOptions());
}

export function getCurrentMarketplaceTitleName() {
  return getMarketplaceTitleName(getCurrentMarketplace(), getMarketplaceOptions());
}
