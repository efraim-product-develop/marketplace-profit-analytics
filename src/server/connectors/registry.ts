import type { MarketplaceConnector } from "./types";
import { walmartConnector } from "./walmart";

const connectors: MarketplaceConnector[] = [walmartConnector];

export function listMarketplaceConnectors() {
  return connectors;
}

export function getMarketplaceConnector(marketplace: string) {
  return connectors.find(
    (connector) => connector.marketplace.toLowerCase() === marketplace.toLowerCase()
  );
}

export function listMarketplaceImportParsers(marketplace: string) {
  return getMarketplaceConnector(marketplace)?.importParsers ?? [];
}
