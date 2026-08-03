import type { ProfitRow } from "./types";

export function reconcileParentAdvertisingFromSkuRows(
  parentRows: ProfitRow[],
  skuRows: ProfitRow[]
) {
  const childAdvertisingByParent = new Map<string, number>();
  const childParentBySellerSku = new Map<string, string>();

  for (const row of skuRows) {
    const parentKey = getParentRowKey(row.marketplace, row.parentSku);
    if (row.sellerSku && row.parentSku) {
      childParentBySellerSku.set(getSkuKey(row.marketplace, row.sellerSku), row.parentSku);
    }
    childAdvertisingByParent.set(
      parentKey,
      (childAdvertisingByParent.get(parentKey) ?? 0) + row.walmartConnectAdvertisingCost
    );
  }

  return parentRows.flatMap((row) => {
    if (isDuplicateChildSkuAdvertisingParentRow(row, childParentBySellerSku)) {
      return [];
    }

    const childWalmartConnectAdvertising =
      childAdvertisingByParent.get(getParentRowKey(row.marketplace, row.parentSku)) ?? 0;
    const missingChildAdvertising = roundMoney(
      childWalmartConnectAdvertising - row.walmartConnectAdvertisingCost
    );

    if (missingChildAdvertising <= 0) {
      return [row];
    }

    return [recalculateAfterWalmartConnectAdjustment(row, missingChildAdvertising)];
  });
}

function isDuplicateChildSkuAdvertisingParentRow(
  row: ProfitRow,
  childParentBySellerSku: Map<string, string>
) {
  if (!row.parentSku) {
    return false;
  }

  const realParentSku = childParentBySellerSku.get(getSkuKey(row.marketplace, row.parentSku));

  return Boolean(
    realParentSku &&
      realParentSku !== row.parentSku &&
      row.quantity === 0 &&
      row.grossRevenue === 0 &&
      row.netRevenue === 0 &&
      row.salesRefunds === 0 &&
      row.marketplaceFees === 0 &&
      row.cogs === 0 &&
      row.semAdvertisingCost === 0 &&
      row.walmartConnectAdvertisingCost > 0
  );
}

function recalculateAfterWalmartConnectAdjustment(row: ProfitRow, addedWalmartConnectAdvertising: number) {
  const next = {
    ...row,
    walmartConnectAdvertisingCost: roundMoney(
      row.walmartConnectAdvertisingCost + addedWalmartConnectAdvertising
    ),
    advertisingCost: roundMoney(row.advertisingCost + addedWalmartConnectAdvertising)
  };

  next.netProfit = roundMoney(next.grossProfit - next.advertisingCost);
  next.contributionProfit = next.netProfit;
  next.marginPercent = next.netRevenue === 0 ? 0 : (next.netProfit / next.netRevenue) * 100;
  next.netMarginPercent = next.marginPercent;
  next.profitPerUnit = next.quantity === 0 ? 0 : next.netProfit / next.quantity;

  return next;
}

function getParentRowKey(marketplace: string, parentSku?: string | null) {
  return `${marketplace}:${parentSku || "Unassigned parent"}`;
}

function getSkuKey(marketplace: string, sellerSku: string) {
  return `${marketplace}:${sellerSku}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
