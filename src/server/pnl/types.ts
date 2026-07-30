export type MarketplaceCode = string;

export type ProfitFeeInput = {
  marketplace: MarketplaceCode;
  sellerSku?: string | null;
  parentSku?: string | null;
  feeType: string;
  amount: number;
  postedAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export type ProfitRefundInput = {
  marketplace: MarketplaceCode;
  sellerSku?: string | null;
  parentSku?: string | null;
  amount: number;
  refundDate?: Date | null;
  metadata?: Record<string, unknown>;
};

export type ProfitAdvertisingCostInput = {
  marketplace: MarketplaceCode;
  sellerSku?: string | null;
  parentSku?: string | null;
  source: string;
  amount: number;
  costDate?: Date;
  metadata?: Record<string, unknown>;
};

export type ProfitLineInput = {
  marketplace: MarketplaceCode;
  orderId?: string;
  externalLineId?: string | null;
  orderStatus?: string | null;
  salesSource: PnlSalesSourceKind;
  sellerSku: string;
  parentSku?: string | null;
  brand?: string | null;
  department?: string | null;
  orderDate?: Date;
  quantity: number;
  itemRevenue: number;
  shippingRevenue?: number;
  taxCollected?: number;
  discountAmount?: number;
  salesRefunds?: number;
  orderCount?: number;
  cogsTotal?: number;
  missingCogs?: boolean;
  fees?: ProfitFeeInput[];
  refunds?: ProfitRefundInput[];
};

export type PnlSalesSourceKind =
  | "item_sales_daily_summary"
  | "item_sales_monthly_summary"
  | "po_order_detail"
  | "mixed"
  | "none";

export type PnlSalesSourceSummary = {
  kind: PnlSalesSourceKind;
  label: string;
  note: string;
  summaryMonthCount: number;
  suppressedDetailRowCount: number;
  suppressedDetailGmv: number;
};

export type ProfitGroupKey = {
  marketplace: MarketplaceCode;
  sellerSku?: string;
  parentSku?: string;
  label: string;
};

export type ProfitRow = ProfitGroupKey & {
  brand?: string | null;
  department?: string | null;
  salesSource?: PnlSalesSourceKind;
  quantity: number;
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
  refunds: number;
  salesRefunds: number;
  taxCollected: number;
  marketplaceFees: number;
  commissionFees: number;
  fulfillmentFees: number;
  shippingFees: number;
  storageFees: number;
  returnFees: number;
  adjustmentFees: number;
  otherFees: number;
  semAdvertisingCost: number;
  walmartConnectAdvertisingCost: number;
  advertisingCost: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number;
  grossProfitPerUnit: number;
  missingCogsUnits: number;
  missingCogsLineCount: number;
  contributionProfit: number;
  netProfit: number;
  marginPercent: number;
  netMarginPercent: number;
  profitPerUnit: number;
};

export type PnlComparisonPeriod = "day" | "week" | "month" | "quarter" | "custom";

export type PnlDateRange = {
  from?: Date;
  to?: Date;
};

export type PnlSettlementAllocationSummary = {
  allocatedCount: number;
  fallbackCount: number;
  missingPeriodMetadataCount: number;
};

export type ParentPnlPeriodTile = {
  periodKey: string;
  label: string;
  dateLabel: string;
  from: string;
  to: string;
  salesSource: PnlSalesSourceSummary;
  netRevenue: number;
  netRevenueChangePercent: number | null;
  orderCount: number;
  units: number;
  refundUnits: number;
  refunds: number;
  salesRefunds: number;
  marketplaceFees: number;
  commissionFees: number;
  fulfillmentFees: number;
  shippingFees: number;
  storageFees: number;
  returnFees: number;
  adjustmentFees: number;
  otherFees: number;
  semAdvertisingCost: number;
  walmartConnectAdvertisingCost: number;
  advertisingCost: number;
  cogs: number;
  grossProfit: number;
  grossProfitChangePercent: number | null;
  grossMarginPercent: number;
  netProfit: number;
  netProfitChangePercent: number | null;
  marginPercent: number;
  missingCogsUnits: number;
};

export type ParentPnlMonthlyComparisonRow = {
  monthKey: string;
  label: string;
  dateLabel: string;
  from: string;
  to: string;
  salesSource: PnlSalesSourceSummary;
  netRevenue: number;
  netRevenueChangePercent: number | null;
  orderCount: number;
  units: number;
  refunds: number;
  salesRefunds: number;
  marketplaceFees: number;
  commissionFees: number;
  fulfillmentFees: number;
  shippingFees: number;
  storageFees: number;
  returnFees: number;
  adjustmentFees: number;
  otherFees: number;
  semAdvertisingCost: number;
  walmartConnectAdvertisingCost: number;
  advertisingCost: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
  grossMarginPercent: number;
  netMarginPercent: number;
  profitPerUnit: number;
  missingCogsUnits: number;
};

export type ParentSkuFilterOption = {
  parentSku: string;
  label: string;
};

export type SkuPnlFilters = {
  dateRange?: PnlDateRange;
  parentSku?: string;
  marketplace?: string;
  brand?: string;
  department?: string;
};

export type SkuPnlFilterOption = {
  value: string;
  label: string;
};

export type SkuPnlFilterOptions = {
  parents: ParentSkuFilterOption[];
  marketplaces: SkuPnlFilterOption[];
  brands: SkuPnlFilterOption[];
  departments: SkuPnlFilterOption[];
};

export type SkuPnlOrderDrilldownRow = {
  key: string;
  sellerSku: string;
  marketplace: MarketplaceCode;
  externalOrderId?: string;
  externalLineId?: string | null;
  orderDate?: Date;
  orderStatus?: string | null;
  salesSource: PnlSalesSourceKind;
  dashboardIncluded: boolean;
  quantity: number;
  netRevenue: number;
  refunds: number;
  salesRefunds: number;
  marketplaceFees: number;
  commissionFees: number;
  fulfillmentFees: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
};
