export const ACTIVE_MARKETPLACE_COOKIE = "marketplace_profit_active_marketplace";

export type MarketplaceOption = {
  marketplace: string;
  displayName: string;
};

export function getMarketplaceDisplayName(
  marketplace: string,
  marketplaces: MarketplaceOption[]
) {
  return marketplaces.find((option) => option.marketplace === marketplace)?.displayName ?? marketplace;
}

export function getMarketplaceTitleName(
  marketplace: string,
  marketplaces: MarketplaceOption[]
) {
  return getMarketplaceDisplayName(marketplace, marketplaces).replace(/\s+Seller Center$/i, "");
}
