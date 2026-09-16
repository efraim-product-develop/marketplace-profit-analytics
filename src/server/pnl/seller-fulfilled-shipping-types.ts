export const SELLER_FULFILLED_SHIPPING_FEE_TYPE = "seller_fulfilled_shipping";
export const SELLER_FULFILLED_SHIPPING_SOURCE = "manual_seller_fulfilled_shipping";

export function isSellerFulfilledShippingFee(
  feeType: string,
  metadata?: Record<string, unknown>
) {
  return (
    feeType === SELLER_FULFILLED_SHIPPING_FEE_TYPE ||
    readMetadataText(metadata, "source") === SELLER_FULFILLED_SHIPPING_SOURCE ||
    readMetadataText(metadata, "manualCostType") === SELLER_FULFILLED_SHIPPING_FEE_TYPE
  );
}

export function isSellerFulfilledShippingMetadata(metadata?: Record<string, unknown>) {
  return readMetadataText(metadata, "source") === SELLER_FULFILLED_SHIPPING_SOURCE;
}

function readMetadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
