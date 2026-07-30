export type SalesUploadFee = {
  feeType: string;
  feeAmount: number;
  currency: string;
};

export type SalesUploadRefund = {
  refundAmount: number;
  refundDate: Date | null;
  currency: string;
};

export type ParsedSalesUploadRow = {
  marketplace: string;
  externalOrderId: string;
  externalOrderLineId?: string;
  orderDate: Date;
  sku: string;
  parentSku?: string;
  productName?: string;
  brand?: string;
  marketplaceItemId?: string;
  quantity: number;
  itemPrice: number;
  grossSales: number;
  shippingRevenue: number;
  taxCollected: number;
  discountAmount: number;
  orderStatus?: string;
  currency: string;
  sourceRow: number;
  fees: SalesUploadFee[];
  refund?: SalesUploadRefund;
  metadata?: Record<string, unknown>;
};

export type SalesUploadIssue = {
  row: number;
  code: string;
  message: string;
  severity: "error" | "warning";
  rawData?: Record<string, unknown>;
};

export type SalesUploadSummary = {
  totalRowsRead: number;
  validRows: number;
  rejectedRows: number;
  totalUnits: number;
  totalGrossSales: number;
  totalShippingRevenue: number;
  totalTaxCollected: number;
  totalDiscountAmount: number;
  totalFees: number;
  totalRefunds: number;
};

export type ParsedSalesUploadWorkbook = {
  rows: ParsedSalesUploadRow[];
  issues: SalesUploadIssue[];
  rowCount: number;
  summary: SalesUploadSummary;
};
