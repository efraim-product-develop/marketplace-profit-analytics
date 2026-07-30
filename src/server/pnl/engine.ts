import type {
  ProfitAdvertisingCostInput,
  ProfitFeeInput,
  ProfitGroupKey,
  ProfitLineInput,
  ProfitRefundInput,
  ProfitRow
} from "./types";

type GroupBy = "sellerSku" | "parentSku";
const SEM_AD_SOURCES = new Set(["walmart_seller_center_sem", "seller_center_sem"]);
const WALMART_CONNECT_AD_SOURCE = "walmart_connect_item_performance";

export function calculateProfitRows(
  lines: ProfitLineInput[],
  groupBy: GroupBy,
  advertisingCosts: ProfitAdvertisingCostInput[] = [],
  additionalFees: ProfitFeeInput[] = [],
  additionalRefunds: ProfitRefundInput[] = []
): ProfitRow[] {
  const groups = new Map<string, ProfitRow>();

  for (const line of lines) {
    const key = getGroupKey(line, groupBy);
    const existing = groups.get(key.label) ?? createEmptyProfitRow(key);
    const grossRevenue = line.itemRevenue;
    const discounts = line.discountAmount ?? 0;
    const salesRefunds = (line.salesRefunds ?? 0) + sumRefunds(line.refunds ?? []);

    existing.quantity += line.quantity;
    existing.grossRevenue += grossRevenue;
    existing.discounts += discounts;
    existing.netRevenue += grossRevenue - salesRefunds;
    existing.salesRefunds += salesRefunds;
    existing.taxCollected += line.taxCollected ?? 0;
    for (const fee of line.fees ?? []) {
      applyFee(existing, fee);
    }
    existing.cogs += line.cogsTotal ?? 0;
    if (line.missingCogs) {
      existing.missingCogsUnits += line.quantity;
      existing.missingCogsLineCount += 1;
    }
    recalculateRowProfit(existing);

    groups.set(key.label, existing);
  }

  for (const fee of additionalFees) {
    const key = getFeeGroupKey(fee, groupBy);
    const existing = groups.get(key.label) ?? createEmptyProfitRow(key);
    applyFee(existing, fee);
    recalculateRowProfit(existing);
    groups.set(key.label, existing);
  }

  for (const refund of additionalRefunds) {
    const key = getRefundGroupKey(refund, groupBy);
    const existing = groups.get(key.label) ?? createEmptyProfitRow(key);
    const salesRefund = Math.abs(refund.amount);
    existing.salesRefunds += salesRefund;
    existing.netRevenue -= salesRefund;
    recalculateRowProfit(existing);
    groups.set(key.label, existing);
  }

  for (const adCost of advertisingCosts) {
    const key = getAdvertisingGroupKey(adCost, groupBy);
    const existing = groups.get(key.label) ?? createEmptyProfitRow(key);
    applyAdvertisingCost(existing, adCost);
    recalculateRowProfit(existing);
    groups.set(key.label, existing);
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.grossProfit - a.grossProfit
  );
}

export function summarizeProfit(rows: ProfitRow[]) {
  const summary = rows.reduce(
    (total, row) => {
      total.quantity += row.quantity;
      total.grossRevenue += row.grossRevenue;
      total.discounts += row.discounts;
      total.netRevenue += row.netRevenue;
      total.refunds += row.refunds;
      total.salesRefunds += row.salesRefunds;
      total.taxCollected += row.taxCollected;
      total.marketplaceFees += row.marketplaceFees;
      total.commissionFees += row.commissionFees;
      total.fulfillmentFees += row.fulfillmentFees;
      total.shippingFees += row.shippingFees;
      total.storageFees += row.storageFees;
      total.returnFees += row.returnFees;
      total.adjustmentFees += row.adjustmentFees;
      total.otherFees += row.otherFees;
      total.semAdvertisingCost += row.semAdvertisingCost;
      total.walmartConnectAdvertisingCost += row.walmartConnectAdvertisingCost;
      total.advertisingCost += row.advertisingCost;
      total.cogs += row.cogs;
      total.grossProfit += row.grossProfit;
      total.grossProfitPerUnit += row.grossProfitPerUnit;
      total.missingCogsUnits += row.missingCogsUnits;
      total.missingCogsLineCount += row.missingCogsLineCount;
      total.contributionProfit += row.contributionProfit;
      total.netProfit += row.netProfit;
      total.profitPerUnit += row.profitPerUnit;
      return total;
    },
    {
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
    }
  );

  summary.grossProfit = summary.netRevenue - summary.marketplaceFees - summary.cogs;
  summary.contributionProfit = summary.grossProfit - summary.advertisingCost;
  summary.netProfit = summary.contributionProfit;
  summary.grossMarginPercent =
    summary.netRevenue === 0
      ? 0
      : (summary.grossProfit / summary.netRevenue) * 100;
  summary.grossProfitPerUnit =
    summary.quantity === 0 ? 0 : summary.grossProfit / summary.quantity;
  summary.marginPercent =
    summary.netRevenue === 0
      ? 0
      : (summary.netProfit / summary.netRevenue) * 100;
  summary.netMarginPercent = summary.marginPercent;
  summary.profitPerUnit =
    summary.quantity === 0 ? 0 : summary.netProfit / summary.quantity;

  return summary;
}

function getAdvertisingGroupKey(
  adCost: ProfitAdvertisingCostInput,
  groupBy: GroupBy
): ProfitGroupKey {
  if (groupBy === "parentSku") {
    const parentSku = adCost.parentSku || "Unassigned parent";
    return {
      marketplace: adCost.marketplace,
      parentSku,
      label: `${adCost.marketplace}:${parentSku}`
    };
  }

  const sellerSku = adCost.sellerSku || "Unassigned SKU";
  return {
    marketplace: adCost.marketplace,
    sellerSku,
    parentSku: adCost.parentSku ?? undefined,
    label: `${adCost.marketplace}:${sellerSku}`
  };
}

function getFeeGroupKey(fee: ProfitFeeInput, groupBy: GroupBy): ProfitGroupKey {
  return getAdjustmentGroupKey({
    marketplace: fee.marketplace,
    sellerSku: fee.sellerSku,
    parentSku: fee.parentSku,
    groupBy
  });
}

function getRefundGroupKey(refund: ProfitRefundInput, groupBy: GroupBy): ProfitGroupKey {
  return getAdjustmentGroupKey({
    marketplace: refund.marketplace,
    sellerSku: refund.sellerSku,
    parentSku: refund.parentSku,
    groupBy
  });
}

function getGroupKey(line: ProfitLineInput, groupBy: GroupBy): ProfitGroupKey {
  if (groupBy === "parentSku") {
    const parentSku = line.parentSku || "Unassigned parent";
    return {
      marketplace: line.marketplace,
      parentSku,
      label: `${line.marketplace}:${parentSku}`
    };
  }

  return {
    marketplace: line.marketplace,
    sellerSku: line.sellerSku,
    parentSku: line.parentSku ?? undefined,
    label: `${line.marketplace}:${line.sellerSku}`
  };
}

function getAdjustmentGroupKey({
  marketplace,
  sellerSku,
  parentSku,
  groupBy
}: {
  marketplace: string;
  sellerSku?: string | null;
  parentSku?: string | null;
  groupBy: GroupBy;
}): ProfitGroupKey {
  if (groupBy === "parentSku") {
    const resolvedParentSku = parentSku || "Unassigned parent";
    return {
      marketplace,
      parentSku: resolvedParentSku,
      label: `${marketplace}:${resolvedParentSku}`
    };
  }

  const resolvedSellerSku = sellerSku || "Unassigned SKU";
  return {
    marketplace,
    sellerSku: resolvedSellerSku,
    parentSku: parentSku ?? undefined,
    label: `${marketplace}:${resolvedSellerSku}`
  };
}

function createEmptyProfitRow(key: ProfitGroupKey): ProfitRow {
  return {
    ...key,
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

function recalculateRowProfit(row: ProfitRow) {
  row.grossProfit = row.netRevenue - row.marketplaceFees - row.cogs;
  row.netProfit = row.grossProfit - row.advertisingCost;
  row.contributionProfit = row.netProfit;
  row.grossMarginPercent =
    row.netRevenue === 0 ? 0 : (row.grossProfit / row.netRevenue) * 100;
  row.grossProfitPerUnit = row.quantity === 0 ? 0 : row.grossProfit / row.quantity;
  row.marginPercent =
    row.netRevenue === 0 ? 0 : (row.netProfit / row.netRevenue) * 100;
  row.netMarginPercent = row.marginPercent;
  row.profitPerUnit = row.quantity === 0 ? 0 : row.netProfit / row.quantity;
}

function applyAdvertisingCost(row: ProfitRow, adCost: ProfitAdvertisingCostInput) {
  row.advertisingCost += adCost.amount;

  if (SEM_AD_SOURCES.has(adCost.source)) {
    row.semAdvertisingCost += adCost.amount;
    return;
  }

  if (adCost.source === WALMART_CONNECT_AD_SOURCE) {
    row.walmartConnectAdvertisingCost += adCost.amount;
    return;
  }
}

function sumRefunds(refunds: ProfitRefundInput[]) {
  return refunds.reduce((sum, refund) => sum + Math.abs(refund.amount), 0);
}

function applyFee(row: ProfitRow, fee: ProfitFeeInput) {
  const feeAmount = getFeeExpenseAmount(fee);

  row.marketplaceFees += feeAmount;

  switch (getFeeCategory(fee.feeType)) {
    case "commission":
      row.commissionFees += feeAmount;
      break;
    case "fulfillment":
      row.fulfillmentFees += feeAmount;
      break;
    case "shipping":
      row.shippingFees += feeAmount;
      break;
    case "storage":
      row.storageFees += feeAmount;
      break;
    case "return":
      row.returnFees += feeAmount;
      break;
    case "adjustment":
      row.adjustmentFees += feeAmount;
      break;
    default:
      row.otherFees += feeAmount;
      break;
  }
}

function getFeeExpenseAmount(fee: ProfitFeeInput) {
  const amount = fee.amount;

  if (usesSignedSettlementAmount(fee)) {
    return -amount;
  }

  if (getFeeCategory(fee.feeType) === "adjustment") {
    return -amount;
  }

  return amount < 0 ? Math.abs(amount) : amount;
}

function usesSignedSettlementAmount(fee: ProfitFeeInput) {
  return fee.metadata?.amountSignConvention === "negative_expense_positive_credit";
}

function getFeeCategory(feeType: string) {
  const normalized = feeType.toLowerCase().replace(/[\s-]+/g, "_");

  if (
    normalized.includes("commission") ||
    normalized.includes("referral") ||
    normalized.includes("marketplace")
  ) {
    return "commission";
  }

  if (normalized.includes("fulfillment") || normalized.includes("wfs")) {
    return "fulfillment";
  }

  if (normalized.includes("shipping")) {
    return "shipping";
  }

  if (normalized.includes("storage")) {
    return "storage";
  }

  if (normalized.includes("return")) {
    return "return";
  }

  if (
    normalized.includes("adjustment") ||
    normalized.includes("credit") ||
    normalized.includes("reimbursement")
  ) {
    return "adjustment";
  }

  return "other";
}
