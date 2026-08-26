import type { ProfitRow } from "./types";

export type ParentCatalogChildSku = {
  marketplace?: string | null;
  parentSku: string | null;
  sellerSku: string | null;
};

export function appendMissingCatalogChildSkuRows(
  skuRows: ProfitRow[],
  catalogChildren: ParentCatalogChildSku[],
  defaultMarketplace: string
) {
  const rows = [...skuRows];
  const existingSkuKeys = new Set(
    rows
      .filter((row) => row.sellerSku)
      .map((row) => getSkuKey(row.marketplace, row.sellerSku!))
  );

  for (const child of catalogChildren) {
    const sellerSku = child.sellerSku?.trim();
    const parentSku = child.parentSku?.trim();
    const marketplace = child.marketplace?.trim() || defaultMarketplace;

    if (!sellerSku || !parentSku || !marketplace) {
      continue;
    }

    const key = getSkuKey(marketplace, sellerSku);

    if (existingSkuKeys.has(key)) {
      continue;
    }

    rows.push(createEmptyCatalogChildSkuRow({ marketplace, parentSku, sellerSku }));
    existingSkuKeys.add(key);
  }

  return rows;
}

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

function createEmptyCatalogChildSkuRow({
  marketplace,
  parentSku,
  sellerSku
}: {
  marketplace: string;
  parentSku: string;
  sellerSku: string;
}): ProfitRow {
  return {
    marketplace,
    parentSku,
    sellerSku,
    label: getSkuKey(marketplace, sellerSku),
    salesSource: "none",
    quantity: 0,
    grossRevenue: 0,
    discounts: 0,
    netRevenue: 0,
    refunds: 0,
    salesRefunds: 0,
    taxCollected: 0,
    marketplaceFees: 0,
    commissionFees: 0,
    fulfillmentFees: 0,
    shippingFees: 0,
    storageFees: 0,
    returnFees: 0,
    adjustmentFees: 0,
    otherFees: 0,
    otherFeeCategoryBreakdown: [],
    semAdvertisingCost: 0,
    walmartConnectAdvertisingCost: 0,
    advertisingCost: 0,
    cogs: 0,
    grossProfit: 0,
    grossMarginPercent: 0,
    grossProfitPerUnit: 0,
    missingCogsUnits: 0,
    missingCogsLineCount: 0,
    contributionProfit: 0,
    netProfit: 0,
    marginPercent: 0,
    netMarginPercent: 0,
    profitPerUnit: 0
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
