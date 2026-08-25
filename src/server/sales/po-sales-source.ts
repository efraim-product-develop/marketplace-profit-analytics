export const NORMALIZED_PO_ORDER_STATUS = "PO_DETAIL";
export const PO_REPORT_METADATA_SOURCE = "walmart_po_report";

const CANCELLED_STATUS_PATTERN = /cancel/i;

export type PoSalesSourceKind = "po_report" | "none";

export type PoSalesFinancialInput = {
  quantity: number;
  unitPrice: number;
  itemRevenue: number;
  shippingRevenue?: number | null;
  taxCollected?: number | null;
  discountAmount?: number | null;
  cancelled: boolean;
};

export type PoPriceSourceKind = "unit_price" | "extended_line_amount";

export type PoGrossProductSalesInput = {
  orderedQuantity: number;
  cancelledQuantity?: number | null;
  cancelled: boolean;
  unitPrice?: number | null;
  extendedLineAmount?: number | null;
};

export type PoGrossProductSalesResult = {
  activeQuantity: number;
  originalQuantity: number;
  cancelledQuantity: number;
  unitPrice: number;
  originalGrossProductSales: number;
  grossProductSales: number;
  priceSourceKind: PoPriceSourceKind;
};

export function isPoCancellationStatus(status?: string | null) {
  return Boolean(status && CANCELLED_STATUS_PATTERN.test(status));
}

export function calculatePoGrossProductSales(
  input: PoGrossProductSalesInput
): PoGrossProductSalesResult {
  const originalQuantity = Math.max(0, Math.trunc(input.orderedQuantity));
  const explicitCancelledQuantity = Math.max(0, Math.trunc(input.cancelledQuantity ?? 0));
  const cancelledQuantity = input.cancelled
    ? originalQuantity
    : Math.min(originalQuantity, explicitCancelledQuantity);
  const activeQuantity = Math.max(0, originalQuantity - cancelledQuantity);
  const hasExtendedLineAmount =
    input.extendedLineAmount !== null && input.extendedLineAmount !== undefined;
  const priceSourceKind: PoPriceSourceKind = hasExtendedLineAmount
    ? "extended_line_amount"
    : "unit_price";
  const originalGrossProductSales = roundMoney(
    hasExtendedLineAmount
      ? input.extendedLineAmount ?? 0
      : (input.unitPrice ?? 0) * originalQuantity
  );
  const unitPrice = roundMoney(
    input.unitPrice ??
      (originalQuantity > 0 ? originalGrossProductSales / originalQuantity : originalGrossProductSales)
  );
  const grossProductSales = roundMoney(
    activeQuantity === originalQuantity
      ? originalGrossProductSales
      : unitPrice * activeQuantity
  );

  return {
    activeQuantity,
    originalQuantity,
    cancelledQuantity,
    unitPrice,
    originalGrossProductSales,
    grossProductSales,
    priceSourceKind
  };
}

export function getPoSalesFinancials(input: PoSalesFinancialInput) {
  if (!input.cancelled) {
    return {
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      itemRevenue: input.itemRevenue,
      shippingRevenue: input.shippingRevenue ?? 0,
      taxCollected: input.taxCollected ?? 0,
      discountAmount: input.discountAmount ?? 0
    };
  }

  return {
    quantity: 0,
    unitPrice: input.unitPrice,
    itemRevenue: 0,
    shippingRevenue: 0,
    taxCollected: 0,
    discountAmount: 0
  };
}

export function getPoSalesSourceFromOrderItem(input: {
  orderStatus?: string | null;
  poOrderStatus?: string | null;
  lineMetadata: Array<Record<string, unknown>>;
}): PoSalesSourceKind {
  if (input.orderStatus?.trim().toUpperCase() !== NORMALIZED_PO_ORDER_STATUS) {
    return "none";
  }

  if (isPoCancellationStatus(input.poOrderStatus)) {
    return "none";
  }

  if (input.lineMetadata.some(isCancelledPoLineMetadata)) {
    return "none";
  }

  return "po_report";
}

export function isCancelledPoLineMetadata(metadata: Record<string, unknown>) {
  if (metadata.source !== PO_REPORT_METADATA_SOURCE) {
    return false;
  }

  if (metadata.cancelled === true) {
    return true;
  }

  return isPoCancellationStatus(readMetadataText(metadata.orderStatus));
}

function readMetadataText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function roundMoney(value: number) {
  return Math.round(value * 10000) / 10000;
}
