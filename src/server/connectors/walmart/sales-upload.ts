import {
  parseSalesUploadWorkbook,
  type SalesUploadParseOptions
} from "@/server/sales/upload-parser";

const walmartOrderUploadAliases: SalesUploadParseOptions["headerAliases"] = {
  externalOrderId: [
    "po#",
    "po #",
    "order#",
    "order #",
    "order id",
    "purchase order #",
    "purchase order id",
    "purchase order number",
    "customer order id"
  ],
  externalOrderLineId: ["line#", "line #", "line number", "order line id"],
  orderDate: ["order date", "purchase date", "date"],
  sku: ["sku", "seller sku", "partner sku", "item sku"],
  quantity: ["qty", "quantity", "units", "qty ordered", "quantity ordered"],
  itemPrice: ["item cost", "price", "item price", "unit price", "unit cost"],
  grossSales: ["item total", "line total", "gross sales", "product sales", "item revenue"],
  shippingRevenue: ["shipping", "shipping cost", "shipping revenue", "shipping charge"],
  taxCollected: ["tax", "tax collected", "tax amount"],
  discountAmount: ["discount"],
  orderStatus: ["status", "order status"],
  marketplaceFee: ["original referral fee", "referral fee"],
  adjustmentAmount: ["reduced referral fee discount"],
  refundAmount: ["refunds", "refund", "refund amount", "refund sales"],
  productName: ["item description", "product name", "item name"],
  marketplaceItemId: ["upc", "item id", "item_id", "marketplace item id", "gtin"]
};

export function parseWalmartSalesUploadWorkbook(buffer: Buffer) {
  return parseSalesUploadWorkbook(buffer, {
    marketplace: "walmart",
    preferredSheetNames: ["Po Details", "PO Details"],
    headerAliases: walmartOrderUploadAliases,
    skipStatusPattern: /^canceled$/i
  });
}
