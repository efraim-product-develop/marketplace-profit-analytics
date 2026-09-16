import type {
  ProductAttributionDiagnostics,
  ProfitAdvertisingCostInput,
  ProfitFeeInput,
  ProfitRefundInput
} from "./types.ts";
import { isSellerFulfilledShippingFee } from "./seller-fulfilled-shipping-types.ts";

const SELLER_CENTER_SEM_SOURCES = new Set(["walmart_seller_center_sem", "seller_center_sem"]);
const WALMART_CONNECT_AD_SOURCE = "walmart_connect_item_performance";

export function filterProductAttributableFees(fees: ProfitFeeInput[]) {
  return fees.filter(isProductAttributableFee);
}

export function filterProductAttributableRefunds(refunds: ProfitRefundInput[]) {
  return refunds.filter(isProductAttributableRefund);
}

export function filterProductAttributedAdvertisingCosts(costs: ProfitAdvertisingCostInput[]) {
  return costs.filter(isProductAttributedAdvertisingCost);
}

export function isSellerCenterSemAdvertisingCost(cost: ProfitAdvertisingCostInput) {
  return SELLER_CENTER_SEM_SOURCES.has(cost.source);
}

export function buildProductAttributionDiagnostics({
  feeAdjustments,
  refundAdjustments,
  advertisingCosts
}: {
  feeAdjustments: ProfitFeeInput[];
  refundAdjustments: ProfitRefundInput[];
  advertisingCosts: ProfitAdvertisingCostInput[];
}): ProductAttributionDiagnostics {
  const attributableFees = filterProductAttributableFees(feeAdjustments);
  const attributableRefunds = filterProductAttributableRefunds(refundAdjustments);
  const attributableAds = filterProductAttributedAdvertisingCosts(advertisingCosts);
  const allCommission = feeAdjustments.filter(isCommissionFee);
  const productCommission = attributableFees.filter(isCommissionFee);
  const allFulfillment = feeAdjustments.filter(isFulfillmentFee);
  const productFulfillment = attributableFees.filter(isFulfillmentFee);
  const allConnect = advertisingCosts.filter((cost) => cost.source === WALMART_CONNECT_AD_SOURCE);
  const productConnect = attributableAds.filter((cost) => cost.source === WALMART_CONNECT_AD_SOURCE);
  const sellerCenterSem = advertisingCosts.filter(isSellerCenterSemAdvertisingCost);
  const allOtherFees = feeAdjustments.filter(
    (fee) => !isCommissionFee(fee) && !isFulfillmentFee(fee) && !isSellerFulfilledShippingFee(fee.feeType, fee.metadata)
  );
  const sellerFulfilledShipping = feeAdjustments.filter((fee) =>
    isSellerFulfilledShippingFee(fee.feeType, fee.metadata)
  );
  const attributableWalmartConnectAdvertising = sumAds(productConnect);
  const totalWalmartConnectAdvertising = sumAds(allConnect);
  const unallocatedWalmartConnectAdvertising = roundMoney(
    totalWalmartConnectAdvertising - attributableWalmartConnectAdvertising
  );

  return {
    attributableRefunds: sumRefunds(attributableRefunds),
    unallocatedRefunds: roundMoney(sumRefunds(refundAdjustments) - sumRefunds(attributableRefunds)),
    attributableCommission: sumFeeExpense(productCommission),
    unallocatedCommission: roundMoney(sumFeeExpense(allCommission) - sumFeeExpense(productCommission)),
    attributableFulfillmentFees: sumFeeExpense(productFulfillment),
    unallocatedFulfillmentFees: roundMoney(sumFeeExpense(allFulfillment) - sumFeeExpense(productFulfillment)),
    attributableWalmartConnectAdvertising,
    unallocatedWalmartConnectAdvertising,
    totalWalmartConnectAdvertising,
    walmartConnectAdvertisingReconciliationDifference: roundMoney(
      totalWalmartConnectAdvertising -
        attributableWalmartConnectAdvertising -
        unallocatedWalmartConnectAdvertising
    ),
    sellerCenterSemAdvertising: sumAds(sellerCenterSem),
    sellerFulfilledShippingCost: sumFeeExpense(sellerFulfilledShipping),
    marketplaceOnlyOtherWalmartFees: sumFeeExpense(allOtherFees)
  };
}

function isProductAttributableRefund(refund: ProfitRefundInput) {
  return hasReliableProductAttribution(refund);
}

function isProductAttributableFee(fee: ProfitFeeInput) {
  return (
    hasReliableProductAttribution(fee) &&
    (isCommissionFee(fee) || isFulfillmentFee(fee))
  );
}

function isProductAttributedAdvertisingCost(cost: ProfitAdvertisingCostInput) {
  if (isSellerCenterSemAdvertisingCost(cost)) {
    return false;
  }

  if (cost.source !== WALMART_CONNECT_AD_SOURCE) {
    return false;
  }

  return Boolean(cost.sellerSku?.trim());
}

function hasReliableProductAttribution(
  row: ProfitFeeInput | ProfitRefundInput
) {
  return (
    Boolean(row.sellerSku?.trim()) &&
    row.metadata?.productAttributionReliable === true &&
    row.metadata?.attributionScope === "product"
  );
}

function isCommissionFee(fee: ProfitFeeInput) {
  return getFeeCategory(fee.feeType) === "commission";
}

function isFulfillmentFee(fee: ProfitFeeInput) {
  return getFeeCategory(fee.feeType) === "fulfillment";
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

  return "other";
}

function sumRefunds(refunds: ProfitRefundInput[]) {
  return roundMoney(refunds.reduce((sum, refund) => sum + Math.abs(refund.amount), 0));
}

function sumAds(costs: ProfitAdvertisingCostInput[]) {
  return roundMoney(costs.reduce((sum, cost) => sum + cost.amount, 0));
}

function sumFeeExpense(fees: ProfitFeeInput[]) {
  return roundMoney(fees.reduce((sum, fee) => sum + getFeeExpenseAmount(fee), 0));
}

function getFeeExpenseAmount(fee: ProfitFeeInput) {
  if (fee.metadata?.amountSignConvention === "negative_expense_positive_credit") {
    return -fee.amount;
  }

  return fee.amount < 0 ? Math.abs(fee.amount) : fee.amount;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
