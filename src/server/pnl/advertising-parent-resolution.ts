export function resolveAdvertisingCostParentSku(
  cost: { sellerSku?: string | null; parentSku?: string | null },
  parentSkuBySellerSku: Map<string, string | null>,
  selectedParentSku?: string
) {
  const sellerSku = cost.sellerSku?.trim() || null;

  return cost.parentSku || selectedParentSku || (sellerSku ? parentSkuBySellerSku.get(sellerSku) : null);
}
