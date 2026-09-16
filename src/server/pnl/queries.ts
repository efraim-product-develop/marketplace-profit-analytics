import { Prisma, type MarketplaceFee, type Refund } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EffectiveCogsService } from "@/server/cogs/effective-cogs";
import { resolveAdvertisingCostParentSku } from "@/server/pnl/advertising-parent-resolution";
import { calculateProfitRows, summarizeProfit } from "@/server/pnl/engine";
import {
  appendMissingCatalogChildSkuRows,
  reconcileParentAdvertisingFromSkuRows
} from "@/server/pnl/parent-advertising-rollup";
import {
  buildProductAttributionDiagnostics,
  filterProductAttributableFees,
  filterProductAttributableRefunds,
  filterProductAttributedAdvertisingCosts
} from "@/server/pnl/product-attribution";
import { getCurrentOrganizationId } from "@/server/organizations/current";
import { buildPnlPeriodRanges } from "@/server/pnl/periods";
import { isFullCalendarMonthRange, normalizePnlDateRange } from "@/server/pnl/calendar-dates";
import { getPoSalesSourceFromOrderItem } from "@/server/sales/po-sales-source";
import {
  calculateDailyPnl,
  isDailyCapableWalmartConnectCost
} from "@/server/pnl/daily-service";
import {
  getSettlementCommissionDiagnostic,
  isSettlementDerivedCommissionFee,
  prepareSettlementDerivedCommissionForDateRange,
  type SettlementCommissionDiagnostic
} from "@/server/pnl/settlement-commission-allocation";
import {
  SettlementPeriodAllocator,
  type SettlementDateRange
} from "@/server/pnl/settlement-period-allocator";
import {
  isSellerFulfilledShippingMetadata,
  SELLER_FULFILLED_SHIPPING_FEE_TYPE
} from "@/server/pnl/seller-fulfilled-shipping-types";
import { selectDashboardProfitLines } from "@/server/pnl/source-selection";
import { sortSettlementPayoutHistoryRows } from "@/server/settlements/payouts";
import type {
  ParentPnlMonthlyComparisonRow,
  ParentPnlPeriodTile,
  ParentSkuFilterOption,
  PnlComparisonPeriod,
  PnlDateRange,
  PnlSalesSourceSummary,
  PnlSettlementAllocationSummary,
  ProfitAdvertisingCostInput,
  ProfitFeeInput,
  ProfitLineInput,
  ProfitRefundInput,
  ProfitRow,
  SettlementPayoutHistoryRow,
  SkuPnlFilterOption,
  SkuPnlFilterOptions,
  SkuPnlFilters,
  SkuPnlOrderDrilldownRow
} from "@/server/pnl/types";

const profitLineItemSelect = {
  id: true,
  orderId: true,
  marketplace: true,
  sellerSku: true,
  parentSku: true,
  externalLineId: true,
  quantity: true,
  unitPrice: true,
  itemRevenue: true,
  shippingRevenue: true,
  taxCollected: true,
  discountAmount: true,
  cogsUnit: true,
  cogsTotal: true,
  poOrderStatus: true,
  poFulfillmentType: true,
  order: {
    select: {
      externalOrderId: true,
      orderDate: true,
      status: true
    }
  },
  product: {
    select: {
      brand: true
    }
  }
} satisfies Prisma.SalesOrderItemSelect;

const PRISMA_IN_FILTER_CHUNK_SIZE = 10_000;
const PNL_ADVERTISING_SOURCES = [
  "seller_center_sem",
  "walmart_seller_center_sem",
  "walmart_connect_item_performance"
];
const SETTLEMENT_ALLOCATOR = new SettlementPeriodAllocator();
const SETTLEMENT_ALLOCATION_METADATA_KEY = "settlementAllocation";

type ProfitLineItem = {
  id: string;
  orderId: string;
  marketplace: string;
  sellerSku: string;
  parentSku: string | null;
  externalLineId: string | null;
  quantity: number;
  unitPrice: unknown;
  itemRevenue: unknown;
  shippingRevenue: unknown;
  taxCollected: unknown;
  discountAmount: unknown;
  cogsUnit: unknown | null;
  cogsTotal: unknown;
  poOrderStatus: string | null;
  poFulfillmentType: string | null;
  order: {
    externalOrderId: string;
    orderDate: Date;
    status: string | null;
  };
  product: {
    brand: string | null;
  } | null;
};

type PnlMarketplaceFee = Pick<
  MarketplaceFee,
  | "marketplace"
  | "sellerSku"
  | "feeType"
  | "feeAmount"
  | "postedAt"
  | "metadata"
  | "orderId"
  | "orderItemId"
>;

type PnlRefund = Pick<
  Refund,
  | "marketplace"
  | "sellerSku"
  | "refundAmount"
  | "refundDate"
  | "metadata"
  | "orderId"
  | "orderItemId"
>;

type LineAllocationRef = {
  item: ProfitLineItem;
  line: ProfitLineInput;
};

export async function getSkuPnl(filters: SkuPnlFilters = {}, selectedSku = "") {
  const organizationId = await getCurrentOrganizationId();
  const useDailyPnlPath = shouldUseDailyPnlPath(filters.dateRange);
  const loadDateRange = filters.dateRange ?? getPnlDataLoadRange("month");
  const parentSellerSkus = filters.parentSku
    ? await getSellerSkusForParent(organizationId, filters.parentSku)
    : [];
  const lineSelection = await getProfitLineSelection(
    organizationId,
    loadDateRange,
    filters.parentSku,
    parentSellerSkus,
    filters,
    { sourceMode: useDailyPnlPath ? "daily" : "dashboard" }
  );
  const lines = lineSelection.lines;
  const filteredSellerSkus = uniqueStrings(lines.map((line) => line.sellerSku));
  const shouldUseFilteredAdSkus = Boolean(filters.brand || filters.department);
  const advertisingCosts = shouldUseFilteredAdSkus && !filteredSellerSkus.length
    ? []
    : await getAdvertisingCosts(
        organizationId,
        shouldUseFilteredAdSkus ? undefined : filters.parentSku,
        shouldUseFilteredAdSkus ? filteredSellerSkus : parentSellerSkus,
        filters.marketplace,
        loadDateRange
      );
  const periodAdvertisingCosts = prepareAdvertisingCostsForDateRange(
    advertisingCosts,
    filters.dateRange
  );
  const productPeriodAdvertisingCosts =
    filterProductAttributedAdvertisingCosts(periodAdvertisingCosts);

  if (useDailyPnlPath && filters.dateRange) {
    const dailyFeeAdjustments = prepareFeesForDateRange(
      lineSelection.feeAdjustments,
      filters.dateRange,
      lines
    );
    const dailyRefundAdjustments = prepareRefundsForDateRange(
      lineSelection.refundAdjustments,
      filters.dateRange
    );
    const attributionDiagnostics = buildProductAttributionDiagnostics({
      feeAdjustments: dailyFeeAdjustments,
      refundAdjustments: dailyRefundAdjustments,
      advertisingCosts: periodAdvertisingCosts
    });
    const dailyResult = calculateDailyPnl({
      organizationId,
      marketplace: filters.marketplace ?? "",
      dateRange: filters.dateRange,
      groupBy: "sellerSku",
      lines,
      suppressedDetailLines: lineSelection.suppressedDetailLines,
      advertisingCosts: productPeriodAdvertisingCosts,
      feeAdjustments: filterProductAttributableFees(dailyFeeAdjustments),
      refundAdjustments: filterProductAttributableRefunds(dailyRefundAdjustments),
      sellerCenterSemMode: "exclude"
    });

    return {
      rows: decorateProfitRows(dailyResult.rows, dailyResult.lines, "sellerSku"),
      summary: dailyResult.summary,
      salesSource: dailyResult.salesSource,
      settlementAllocation: dailyResult.settlementAllocation,
      dataQuality: dailyResult.missingDataSources,
      attributionDiagnostics,
      sourceMetadata: dailyResult.sourceMetadata,
      diagnostic: dailyResult.diagnostic,
      settlementCommissionDiagnostic: getFirstSettlementCommissionDiagnostic(
        dailyResult.feeAdjustments
      ),
      orderDrilldownRows: selectedSku
        ? buildSkuOrderDrilldownRows(dailyResult.lines, [], selectedSku)
        : []
    };
  }

  const periodFeeAdjustments = prepareFeesForDateRange(
    lineSelection.feeAdjustments,
    filters.dateRange,
    lines
  );
  const periodRefundAdjustments = prepareRefundsForDateRange(
    lineSelection.refundAdjustments,
    filters.dateRange
  );
  const productPeriodFeeAdjustments = filterProductAttributableFees(periodFeeAdjustments);
  const productPeriodRefundAdjustments = filterProductAttributableRefunds(periodRefundAdjustments);
  const attributionDiagnostics = buildProductAttributionDiagnostics({
    feeAdjustments: periodFeeAdjustments,
    refundAdjustments: periodRefundAdjustments,
    advertisingCosts: periodAdvertisingCosts
  });
  const rows = decorateProfitRows(
    calculateProfitRows(
      lines,
      "sellerSku",
      productPeriodAdvertisingCosts,
      productPeriodFeeAdjustments,
      productPeriodRefundAdjustments
    ),
    lines,
    "sellerSku"
  );
  return {
    rows,
    summary: summarizeProfit(rows),
    salesSource: summarizeSalesSource(lines, lineSelection.suppressedDetailLines),
    settlementAllocation: summarizeSettlementAllocation([
      ...productPeriodFeeAdjustments,
      ...productPeriodAdvertisingCosts,
      ...productPeriodRefundAdjustments
    ]),
    dataQuality: buildDataQualityLabels(
      summarizeProfit(rows),
      summarizeSettlementAllocation([
        ...productPeriodFeeAdjustments,
        ...productPeriodAdvertisingCosts,
        ...productPeriodRefundAdjustments
      ])
    ),
    attributionDiagnostics,
    sourceMetadata: null,
    diagnostic: null,
    settlementCommissionDiagnostic: getFirstSettlementCommissionDiagnostic(productPeriodFeeAdjustments),
    orderDrilldownRows: selectedSku
      ? buildSkuOrderDrilldownRows(
          lineSelection.lines,
          lineSelection.suppressedDetailLines,
          selectedSku
        )
      : []
  };
}

export async function getParentPnl({
  dateRange,
  comparisonPeriod = "month",
  marketplace,
  parentSku,
  selectedSku,
  includeMonthlyComparisonRows = false,
  includeSkuRows = true
}: {
  dateRange?: PnlDateRange;
  comparisonPeriod?: PnlComparisonPeriod;
  marketplace?: string;
  parentSku?: string;
  selectedSku?: string;
  includeMonthlyComparisonRows?: boolean;
  includeSkuRows?: boolean;
} = {}) {
  const timer = createPnlTimer("parent-pnl");
  const lineSelectionTimer = createPnlTimer("parent-line-selection");
  const organizationId = await getCurrentOrganizationId();
  timer.mark("organization");
  const useDailyPnlPath = shouldUseDailyPnlPath(dateRange, comparisonPeriod);
  const loadDateRange = getPnlDataLoadRange(comparisonPeriod, dateRange);
  const [parentOptions, childSkus] = await Promise.all([
    getParentSkuOptions(organizationId, marketplace),
    parentSku ? getSellerSkusForParent(organizationId, parentSku, marketplace) : Promise.resolve([])
  ]);
  timer.mark("options");
  const [lineSelection, advertisingCosts] = await Promise.all([
    getProfitLineSelection(
      organizationId,
      loadDateRange,
      parentSku,
      childSkus,
      { marketplace },
      {
        sourceMode: useDailyPnlPath ? "daily" : "dashboard",
        timer: lineSelectionTimer
      }
    ),
    getAdvertisingCosts(organizationId, parentSku, childSkus, marketplace, loadDateRange)
  ]);
  timer.mark("lines-and-ads");
  const lines = lineSelection.lines;
  const periodTiles = calculateParentPeriodTiles(
    lines,
    advertisingCosts,
    comparisonPeriod,
    lineSelection.suppressedDetailLines,
    lineSelection.feeAdjustments,
    lineSelection.refundAdjustments,
    dateRange,
    useDailyPnlPath,
    organizationId,
    marketplace,
    !parentSku
  );
  timer.mark("period-tiles");
  const hasExplicitDateRange = Boolean(dateRange?.from || dateRange?.to);
  const defaultPeriodRange = !hasExplicitDateRange ? getTileDateRange(periodTiles[0]) : null;
  const rollupLines = defaultPeriodRange
    ? filterLinesByDateRange(lines, defaultPeriodRange)
    : lines;
  const rollupSuppressedDetailLines = defaultPeriodRange
    ? filterLinesByDateRange(lineSelection.suppressedDetailLines, defaultPeriodRange)
    : lineSelection.suppressedDetailLines;
  const rollupAdvertisingCosts = defaultPeriodRange
    ? prepareAdvertisingCostsForDateRange(advertisingCosts, defaultPeriodRange)
    : prepareAdvertisingCostsForDateRange(advertisingCosts, dateRange);
  const productRollupAdvertisingCosts =
    filterProductAttributedAdvertisingCosts(rollupAdvertisingCosts);
  const rollupFeeAdjustments = defaultPeriodRange
    ? prepareFeesForDateRange(lineSelection.feeAdjustments, defaultPeriodRange, rollupLines)
    : prepareFeesForDateRange(lineSelection.feeAdjustments, dateRange, rollupLines);
  const rollupRefundAdjustments = defaultPeriodRange
    ? filterRefundsByDateRange(lineSelection.refundAdjustments, defaultPeriodRange)
    : prepareRefundsForDateRange(lineSelection.refundAdjustments, dateRange);
  const productRollupFeeAdjustments = filterProductAttributableFees(rollupFeeAdjustments);
  const productRollupRefundAdjustments = filterProductAttributableRefunds(rollupRefundAdjustments);
  const attributionDiagnostics = buildProductAttributionDiagnostics({
    feeAdjustments: rollupFeeAdjustments,
    refundAdjustments: rollupRefundAdjustments,
    advertisingCosts: rollupAdvertisingCosts
  });
  timer.mark("rollup-prep");
  const dailyRollupResult =
    useDailyPnlPath && (defaultPeriodRange || dateRange)
      ? calculateDailyPnl({
          organizationId,
          marketplace: marketplace ?? "",
          dateRange: defaultPeriodRange ?? dateRange!,
          groupBy: "parentSku",
          lines,
          suppressedDetailLines: lineSelection.suppressedDetailLines,
          advertisingCosts: productRollupAdvertisingCosts,
          feeAdjustments: productRollupFeeAdjustments,
          refundAdjustments: productRollupRefundAdjustments,
          sellerCenterSemMode: "exclude"
        })
      : null;
  const rows = dailyRollupResult
    ? decorateProfitRows(dailyRollupResult.rows, dailyRollupResult.lines, "parentSku")
    : decorateProfitRows(
        calculateProfitRows(
          rollupLines,
          "parentSku",
          productRollupAdvertisingCosts,
          productRollupFeeAdjustments,
          productRollupRefundAdjustments
        ),
        rollupLines,
        "parentSku"
      );
  timer.mark("parent-rows");
  const shouldLoadSkuRows = includeSkuRows || Boolean(selectedSku);
  const dailySkuResult =
    shouldLoadSkuRows && dailyRollupResult && (defaultPeriodRange || dateRange)
      ? calculateDailyPnl({
          organizationId,
          marketplace: marketplace ?? "",
          dateRange: defaultPeriodRange ?? dateRange!,
          groupBy: "sellerSku",
          lines,
          suppressedDetailLines: lineSelection.suppressedDetailLines,
          advertisingCosts: productRollupAdvertisingCosts,
          feeAdjustments: productRollupFeeAdjustments,
          refundAdjustments: productRollupRefundAdjustments,
          sellerCenterSemMode: "exclude"
      })
      : null;
  const skuRows = shouldLoadSkuRows
    ? dailySkuResult
      ? decorateProfitRows(dailySkuResult.rows, dailySkuResult.lines, "sellerSku")
      : decorateProfitRows(
          calculateProfitRows(
            rollupLines,
            "sellerSku",
            productRollupAdvertisingCosts,
            productRollupFeeAdjustments,
            productRollupRefundAdjustments
          ),
          rollupLines,
          "sellerSku"
        )
    : [];
  const displayRows = await appendSelectedParentRowIfMissing({
    organizationId,
    marketplace,
    parentSku,
    rows,
    skuRows
  });
  timer.mark("sku-rows");
  const skuRowsWithCatalogChildren = shouldLoadSkuRows
    ? await appendCatalogChildSkuRowsForParents({
        organizationId,
        marketplace,
        parentRows: displayRows,
        skuRows,
        selectedParentSku: parentSku
      })
    : [];
  const reconciledRows = shouldLoadSkuRows
    ? reconcileParentAdvertisingFromSkuRows(displayRows, skuRowsWithCatalogChildren)
    : displayRows;
  timer.mark("row-reconcile");
  const settlementAllocation = dailyRollupResult
    ? dailyRollupResult.settlementAllocation
    : summarizeSettlementAllocation([
        ...productRollupFeeAdjustments,
        ...productRollupAdvertisingCosts,
        ...productRollupRefundAdjustments
      ]);
  const productSummary = summarizeProfit(reconciledRows);
  const marketplaceRollupSummary =
    !parentSku
      ? getMarketplaceRollupSummary({
          organizationId,
          marketplace: marketplace ?? "",
          dateRange: defaultPeriodRange ?? dateRange,
          useDailyPnlPath,
          lines,
          suppressedDetailLines: lineSelection.suppressedDetailLines,
          advertisingCosts: rollupAdvertisingCosts,
          feeAdjustments: rollupFeeAdjustments,
          refundAdjustments: rollupRefundAdjustments,
          fallbackSummary: productSummary
        })
      : productSummary;
  const payoutDateRange = defaultPeriodRange ?? dateRange;
  const settlementPayouts = await getSettlementPayoutHistory(
    organizationId,
    marketplace,
    payoutDateRange
  );
  timer.mark("payouts");
  timer.finish({
    comparisonPeriod,
    marketplace,
    parentSku,
    selectedSku,
    dateRange: describeDateRange(dateRange),
    loadDateRange: describeDateRange(loadDateRange),
    rows: reconciledRows.length,
    skuRows: skuRowsWithCatalogChildren.length,
    lines: lineSelection.lines.length,
    feeAdjustments: lineSelection.feeAdjustments.length,
    refundAdjustments: lineSelection.refundAdjustments.length,
    advertisingCosts: advertisingCosts.length
  });
  return {
    rows: reconciledRows,
    skuRows: skuRowsWithCatalogChildren,
    periodTiles,
    monthlyComparisonRows: includeMonthlyComparisonRows
      ? calculateParentMonthlyComparisonRows(
          lines,
          advertisingCosts,
          lineSelection.suppressedDetailLines,
          lineSelection.feeAdjustments,
          lineSelection.refundAdjustments,
          dateRange,
          comparisonPeriod,
          useDailyPnlPath,
          organizationId,
          marketplace,
          !parentSku
        )
      : [],
    parentOptions,
    summary: marketplaceRollupSummary,
    salesSource: dailyRollupResult
      ? dailyRollupResult.salesSource
      : summarizeSalesSource(rollupLines, rollupSuppressedDetailLines),
    settlementAllocation,
    settlementPayouts,
    dataQuality: dailyRollupResult
      ? dailyRollupResult.missingDataSources
      : buildDataQualityLabels(marketplaceRollupSummary, settlementAllocation),
    attributionDiagnostics,
    sourceMetadata: dailyRollupResult?.sourceMetadata ?? null,
    diagnostic: dailyRollupResult?.diagnostic ?? null,
    settlementCommissionDiagnostic: getFirstSettlementCommissionDiagnostic(
      dailyRollupResult?.feeAdjustments ?? productRollupFeeAdjustments
    ),
    orderDrilldownRows: selectedSku
      ? buildSkuOrderDrilldownRows(
          dailyRollupResult?.lines ?? lineSelection.lines,
          dailyRollupResult ? [] : lineSelection.suppressedDetailLines,
          selectedSku
        )
      : []
  };
}

type ProfitLineSelection = {
  lines: ProfitLineInput[];
  suppressedDetailLines: ProfitLineInput[];
  feeAdjustments: ProfitFeeInput[];
  refundAdjustments: ProfitRefundInput[];
};

function getMarketplaceRollupSummary({
  organizationId,
  marketplace,
  dateRange,
  useDailyPnlPath,
  lines,
  suppressedDetailLines,
  advertisingCosts,
  feeAdjustments,
  refundAdjustments,
  fallbackSummary
}: {
  organizationId: string;
  marketplace: string;
  dateRange?: PnlDateRange | null;
  useDailyPnlPath: boolean;
  lines: ProfitLineInput[];
  suppressedDetailLines: ProfitLineInput[];
  advertisingCosts: ProfitAdvertisingCostInput[];
  feeAdjustments: ProfitFeeInput[];
  refundAdjustments: ProfitRefundInput[];
  fallbackSummary: ReturnType<typeof summarizeProfit>;
}) {
  if (useDailyPnlPath && dateRange) {
    return calculateDailyPnl({
      organizationId,
      marketplace,
      dateRange,
      groupBy: "parentSku",
      lines,
      suppressedDetailLines,
      advertisingCosts,
      feeAdjustments,
      refundAdjustments,
      sellerCenterSemMode: "summaryOnly"
    }).summary;
  }

  if (!dateRange?.from && !dateRange?.to && !lines.length && !advertisingCosts.length) {
    return fallbackSummary;
  }

  const marketplaceRows = calculateProfitRows(
    lines,
    "parentSku",
    advertisingCosts,
    feeAdjustments,
    refundAdjustments
  );

  return summarizeProfit(marketplaceRows);
}

async function getProfitLineSelection(
  organizationId: string,
  dateRange?: PnlDateRange,
  parentSku?: string,
  sellerSkus: string[] = [],
  filters: Pick<SkuPnlFilters, "marketplace" | "brand" | "department"> = {},
  options: { sourceMode?: "dashboard" | "daily"; timer?: ReturnType<typeof createPnlTimer> } = {}
): Promise<ProfitLineSelection> {
  const orderDate = buildDateRangeWhere(dateRange);
  const useDateScopedAttachedAdjustments = shouldUseDateScopedAttachedAdjustments(
    parentSku,
    sellerSkus,
    filters
  );
  const [items, costRecords] = await Promise.all([
    useDateScopedAttachedAdjustments
      ? getLeanProfitLineItems(organizationId, dateRange, filters.marketplace)
      : prisma.salesOrderItem.findMany({
          where: {
            organizationId,
            ...(filters.marketplace ? { marketplace: filters.marketplace } : {}),
            ...buildParentSkuLineWhere(parentSku, sellerSkus),
            order: {
              is: {
                ...(orderDate ? { orderDate } : {}),
                OR: [
                  { importId: null },
                  { salesImport: { is: { status: { in: ["IMPORTED", "NEEDS_REVIEW"] } } } }
                ]
              }
            }
          },
          select: profitLineItemSelect,
          orderBy: [{ marketplace: "asc" }, { sellerSku: "asc" }]
        }),
    prisma.costRecord.findMany({
      where: {
        organizationId,
        status: "ACTIVE"
      },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }]
    })
  ]);
  options.timer?.mark("items-and-cogs");

  const orderIds = uniqueStrings(items.map((item) => item.orderId));
  const itemIds = uniqueStrings(items.map((item) => item.id));
  const orderIdSet = new Set(orderIds);
  const itemIdSet = new Set(itemIds);
  const parentSkuBySellerSku = getParentSkuBySellerSku(items);
  const [
    attachedFees,
    standaloneFees,
    attachedRefunds,
    standaloneRefunds
  ] = useDateScopedAttachedAdjustments
    ? await Promise.all([
        getAttachedFeesByPostedDate(organizationId, dateRange, filters.marketplace),
        getStandaloneFees(organizationId, dateRange, parentSku, sellerSkus, filters.marketplace),
        getAttachedRefundsByRefundDate(organizationId, dateRange, filters.marketplace),
        getStandaloneRefunds(organizationId, dateRange, parentSku, sellerSkus, filters.marketplace)
      ])
    : await Promise.all([
        Promise.all([
      getItemLevelFees(organizationId, itemIds, dateRange),
          getOrderLevelFees(organizationId, orderIds, dateRange)
        ]).then(([itemLevelFees, orderLevelFees]) => [...itemLevelFees, ...orderLevelFees]),
        getStandaloneFees(organizationId, dateRange, parentSku, sellerSkus, filters.marketplace),
        Promise.all([
      getItemLevelRefunds(organizationId, itemIds, dateRange),
          getOrderLevelRefunds(organizationId, orderIds, dateRange)
        ]).then(([itemLevelRefunds, orderLevelRefunds]) => [
          ...itemLevelRefunds,
          ...orderLevelRefunds
        ]),
      getStandaloneRefunds(organizationId, dateRange, parentSku, sellerSkus, filters.marketplace)
    ]);
  options.timer?.mark("adjustments");
  const itemLevelFees = attachedFees.filter(
    (fee) => fee.orderItemId && itemIdSet.has(fee.orderItemId)
  );
  const orderLevelFees = attachedFees.filter(
    (fee) => !fee.orderItemId && fee.orderId && orderIdSet.has(fee.orderId)
  );
  const itemLevelRefunds = attachedRefunds.filter(
    (refund) => refund.orderItemId && itemIdSet.has(refund.orderItemId)
  );
  const orderLevelRefunds = attachedRefunds.filter(
    (refund) => !refund.orderItemId && refund.orderId && orderIdSet.has(refund.orderId)
  );
  const itemLevelFeesByItemId = groupRowsByOrderItemId(itemLevelFees);
  const itemLevelRefundsByItemId = groupRowsByOrderItemId(itemLevelRefunds);
  options.timer?.mark("adjustment-groups");

  await addCatalogParentSkus(
    organizationId,
    parentSkuBySellerSku,
    uniqueStrings([
      ...items
        .filter((item) => !parentSkuBySellerSku.get(item.sellerSku))
        .map((item) => item.sellerSku),
      ...standaloneFees.map((fee) => fee.sellerSku),
      ...standaloneRefunds.map((refund) => refund.sellerSku)
    ]),
    filters.marketplace
  );
  options.timer?.mark("catalog-parents");

  const effectiveCogsByLineId = new EffectiveCogsService(costRecords).getEffectiveCogsForOrderLines(
    items.map((item) => ({
      id: item.id,
      marketplace: item.marketplace,
      sellerSku: item.sellerSku,
      orderDate: item.order.orderDate,
      quantity: item.quantity,
      cogsUnit: item.cogsUnit
    }))
  );
  options.timer?.mark("effective-cogs");

  const lines: ProfitLineInput[] = items.map((item) => {
    const effectiveCogs = effectiveCogsByLineId.get(item.id);
    const itemFees = itemLevelFeesByItemId.get(item.id) ?? [];
    const itemRefunds = itemLevelRefundsByItemId.get(item.id) ?? [];

    const currentParentSku = parentSkuBySellerSku.get(item.sellerSku) ?? item.parentSku;

    return {
      marketplace: item.marketplace,
      orderId: item.order.externalOrderId,
      orderStatus: item.order.status,
      salesSource: getSalesSourceFromOrderItem(item),
      sellerSku: item.sellerSku,
      parentSku: currentParentSku,
      brand: getLineBrand(item),
      department: getLineDepartment(item),
      externalLineId: item.externalLineId,
      orderDate: item.order.orderDate,
      orderCount: getImportedOrderCount(itemFees),
      quantity: item.quantity,
      itemRevenue: toNumber(item.itemRevenue),
      shippingRevenue: toNumber(item.shippingRevenue),
      taxCollected: toNumber(item.taxCollected),
      discountAmount: toNumber(item.discountAmount),
      salesRefunds: getSupportedLineSalesRefundsFromFees(item),
      cogsTotal: effectiveCogs?.cogsTotal ?? 0,
      missingCogs: effectiveCogs?.missingCogs ?? true,
      fees: itemFees.map((fee) => ({
        marketplace: fee.marketplace,
        sellerSku: fee.sellerSku ?? item.sellerSku,
        parentSku: currentParentSku,
        feeType: fee.feeType,
        amount: toNumber(fee.feeAmount),
        postedAt: fee.postedAt,
        metadata: toRecord(fee.metadata)
      })),
      refunds: [
        ...itemRefunds.map((refund) => ({
          marketplace: refund.marketplace,
          sellerSku: refund.sellerSku ?? item.sellerSku,
          parentSku: currentParentSku,
          amount: toNumber(refund.refundAmount),
          refundDate: refund.refundDate,
          metadata: toRecord(refund.metadata)
        }))
      ]
    };
  });
  options.timer?.mark("map-lines");

  const lineRefsByOrderId = buildLineRefsByOrderId(items, lines);
  applyOrderLevelFeesToLines(orderLevelFees, lineRefsByOrderId);
  applyOrderLevelRefundsToLines(orderLevelRefunds, lineRefsByOrderId);
  options.timer?.mark("order-level-adjustments");

  const filteredLines = filterProfitLines(lines, filters);
  const filteredSellerSkus = new Set(filteredLines.map((line) => line.sellerSku));
  const filteredStandaloneFees = filterStandaloneRowsByLineFilters(
    standaloneFees,
    filteredSellerSkus,
    filters
  );
  const filteredStandaloneRefunds = filterStandaloneRowsByLineFilters(
    standaloneRefunds,
    filteredSellerSkus,
    filters
  );
  const selectedLines =
    options.sourceMode === "daily"
      ? { lines: filteredLines, suppressedDetailLines: [] }
      : selectDashboardProfitLines(filteredLines, dateRange);
  options.timer?.mark("filters");
  options.timer?.finish({
    mode: options.sourceMode ?? "dashboard",
    marketplace: filters.marketplace,
    parentSku,
    sellerSkus: sellerSkus.length,
    items: items.length,
    costRecords: costRecords.length,
    attachedFees: attachedFees.length,
    standaloneFees: standaloneFees.length,
    attachedRefunds: attachedRefunds.length,
    standaloneRefunds: standaloneRefunds.length,
    lines: selectedLines.lines.length,
    suppressedDetailLines: selectedLines.suppressedDetailLines.length
  });

  return {
    ...selectedLines,
    feeAdjustments: filteredStandaloneFees.map((fee) =>
      mapStandaloneFeeToProfitFee(fee, parentSkuBySellerSku, parentSku)
    ),
    refundAdjustments: filteredStandaloneRefunds.map((refund) =>
      mapStandaloneRefundToProfitRefund(refund, parentSkuBySellerSku, parentSku)
    )
  };
}

type LeanProfitLineItemRow = {
  id: string;
  orderId: string;
  marketplace: string;
  sellerSku: string;
  parentSku: string | null;
  externalLineId: string | null;
  quantity: number;
  unitPrice: unknown;
  itemRevenue: unknown;
  shippingRevenue: unknown;
  taxCollected: unknown;
  discountAmount: unknown;
  cogsUnit: unknown | null;
  cogsTotal: unknown;
  poOrderStatus: string | null;
  poFulfillmentType: string | null;
  orderExternalOrderId: string;
  orderDate: Date;
  orderStatus: string | null;
  productBrand: string | null;
};

async function getLeanProfitLineItems(
  organizationId: string,
  dateRange?: PnlDateRange,
  marketplace?: string
): Promise<ProfitLineItem[]> {
  const where: Prisma.Sql[] = [
    Prisma.sql`soi."organizationId" = ${organizationId}`,
    Prisma.sql`(so."importId" IS NULL OR si."status" IN ('IMPORTED', 'NEEDS_REVIEW'))`
  ];

  if (marketplace) {
    where.push(Prisma.sql`soi."marketplace" = ${marketplace}`);
  }

  if (dateRange?.from) {
    where.push(Prisma.sql`so."orderDate" >= ${dateRange.from}`);
  }

  if (dateRange?.to) {
    where.push(Prisma.sql`so."orderDate" <= ${dateRange.to}`);
  }

  const rows = await prisma.$queryRaw<LeanProfitLineItemRow[]>(Prisma.sql`
    SELECT
      soi."id",
      soi."orderId",
      soi."marketplace",
      soi."sellerSku",
      soi."parentSku",
      soi."externalLineId",
      soi."quantity",
      soi."unitPrice",
      soi."itemRevenue",
      soi."shippingRevenue",
      soi."taxCollected",
      soi."discountAmount",
      soi."cogsUnit",
      soi."cogsTotal",
      soi."poOrderStatus",
      soi."poFulfillmentType",
      so."externalOrderId" AS "orderExternalOrderId",
      so."orderDate",
      so."status" AS "orderStatus",
      p."brand" AS "productBrand"
    FROM "SalesOrderItem" soi
    INNER JOIN "SalesOrder" so ON so."id" = soi."orderId"
    LEFT JOIN "SalesImport" si ON si."id" = so."importId"
    LEFT JOIN "Product" p ON p."id" = soi."productId"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY soi."marketplace" ASC, soi."sellerSku" ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    marketplace: row.marketplace,
    sellerSku: row.sellerSku,
    parentSku: row.parentSku,
    externalLineId: row.externalLineId,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    itemRevenue: row.itemRevenue,
    shippingRevenue: row.shippingRevenue,
    taxCollected: row.taxCollected,
    discountAmount: row.discountAmount,
    cogsUnit: row.cogsUnit,
    cogsTotal: row.cogsTotal,
    poOrderStatus: row.poOrderStatus,
    poFulfillmentType: row.poFulfillmentType,
    order: {
      externalOrderId: row.orderExternalOrderId,
      orderDate: row.orderDate,
      status: row.orderStatus
    },
    product: row.productBrand ? { brand: row.productBrand } : null
  }));
}

async function getSettlementPayoutHistory(
  organizationId: string,
  marketplace?: string,
  dateRange?: PnlDateRange
): Promise<SettlementPayoutHistoryRow[]> {
  const dateWhere = buildDateRangeWhere(dateRange);
  const periodOverlapWhere =
    dateRange?.from || dateRange?.to
      ? {
          AND: [
            dateRange.to ? { settlementPeriodStart: { lte: dateRange.to } } : {},
            dateRange.from ? { settlementPeriodEnd: { gte: dateRange.from } } : {}
          ]
        }
      : null;
  const rows = await prisma.settlementPayout.findMany({
    where: {
      organizationId,
      ...(marketplace ? { marketplace } : {}),
      ...(dateWhere
        ? {
            OR: [
              ...(periodOverlapWhere ? [periodOverlapWhere] : []),
              { settlementPeriodStart: dateWhere },
              { settlementPeriodEnd: dateWhere },
              { payoutDate: dateWhere }
            ]
          }
        : {})
    },
    orderBy: [
      { settlementPeriodEnd: "desc" },
      { payoutDate: "desc" },
      { importedAt: "desc" }
    ],
    take: 20
  });

  return sortSettlementPayoutHistoryRows(rows.map((row) => ({
    id: row.id,
    marketplace: row.marketplace,
    settlementReference: row.settlementReference,
    settlementPeriodStart: row.settlementPeriodStart,
    settlementPeriodEnd: row.settlementPeriodEnd,
    payoutAmount: toNumber(row.payoutAmount),
    payoutDate: row.payoutDate,
    currency: row.currency,
    source: row.source,
    originalFileName: row.originalFileName,
    importedAt: row.importedAt
  })));
}

async function appendSelectedParentRowIfMissing({
  marketplace,
  parentSku,
  rows,
  skuRows
}: {
  organizationId: string;
  marketplace?: string;
  parentSku?: string;
  rows: ProfitRow[];
  skuRows: ProfitRow[];
}) {
  if (!parentSku) {
    return rows;
  }

  const existingParentKey = `${marketplace || rows[0]?.marketplace || skuRows[0]?.marketplace || "walmart"}:${parentSku}`;

  if (rows.some((row) => row.label === existingParentKey || row.parentSku === parentSku)) {
    return rows;
  }

  return [
    createEmptyDisplayProfitRow({
      marketplace: marketplace || rows[0]?.marketplace || skuRows[0]?.marketplace || "walmart",
      parentSku
    }),
    ...rows
  ];
}

async function appendCatalogChildSkuRowsForParents({
  organizationId,
  marketplace,
  parentRows,
  skuRows,
  selectedParentSku
}: {
  organizationId: string;
  marketplace?: string;
  parentRows: ProfitRow[];
  skuRows: ProfitRow[];
  selectedParentSku?: string;
}) {
  const parentSkus = uniqueStrings([
    selectedParentSku,
    ...parentRows.map((row) => row.parentSku)
  ]);

  if (!parentSkus.length) {
    return skuRows;
  }

  const defaultMarketplace =
    marketplace || firstText([...parentRows.map((row) => row.marketplace), ...skuRows.map((row) => row.marketplace)]) || "walmart";
  const [products, listings, orderItems, costRecords, advertisingCosts] = await Promise.all([
    prisma.product.findMany({
      where: {
        organizationId,
        parentSku: { in: parentSkus },
        internalSku: { not: null }
      },
      select: {
        internalSku: true,
        parentSku: true
      }
    }),
    prisma.listing.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { in: parentSkus }
      },
      select: {
        marketplace: true,
        parentSku: true,
        sellerSku: true
      }
    }),
    prisma.salesOrderItem.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { in: parentSkus }
      },
      distinct: ["marketplace", "sellerSku", "parentSku"],
      select: {
        marketplace: true,
        parentSku: true,
        sellerSku: true
      }
    }),
    prisma.costRecord.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { in: parentSkus }
      },
      distinct: ["marketplace", "sellerSku", "parentSku"],
      select: {
        marketplace: true,
        parentSku: true,
        sellerSku: true
      }
    }),
    prisma.advertisingCost.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        source: { in: PNL_ADVERTISING_SOURCES },
        parentSku: { in: parentSkus },
        sellerSku: { not: null }
      },
      distinct: ["marketplace", "sellerSku", "parentSku"],
      select: {
        marketplace: true,
        parentSku: true,
        sellerSku: true
      }
    })
  ]);

  return appendMissingCatalogChildSkuRows(
    skuRows,
    [
      ...products.map((product) => ({
        marketplace: defaultMarketplace,
        parentSku: product.parentSku,
        sellerSku: product.internalSku
      })),
      ...listings,
      ...orderItems,
      ...costRecords,
      ...advertisingCosts
    ],
    defaultMarketplace
  );
}

function createEmptyDisplayProfitRow({
  marketplace,
  parentSku,
  sellerSku
}: {
  marketplace: string;
  parentSku?: string;
  sellerSku?: string;
}): ProfitRow {
  return {
    marketplace,
    parentSku,
    sellerSku,
    label: `${marketplace}:${sellerSku ?? parentSku ?? "Unassigned parent"}`,
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
    sellerFulfilledShippingCost: 0,
    shippingFees: 0,
    storageFees: 0,
    returnFees: 0,
    adjustmentFees: 0,
    otherFees: 0,
    otherFeeCategoryBreakdown: [],
    semAdvertisingCost: 0,
    walmartConnectAdvertisingCost: 0,
    advertisingCost: 0,
    tacosPercent: 0,
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

function decorateProfitRows(
  rows: ProfitRow[],
  lines: ProfitLineInput[],
  groupBy: "sellerSku" | "parentSku"
): ProfitRow[] {
  const lineGroups = new Map<string, ProfitLineInput[]>();

  for (const line of lines) {
    const key =
      groupBy === "parentSku"
        ? `${line.marketplace}:${line.parentSku || "Unassigned parent"}`
        : `${line.marketplace}:${line.sellerSku}`;
    const groupLines = lineGroups.get(key) ?? [];
    groupLines.push(line);
    lineGroups.set(key, groupLines);
  }

  return rows.map((row) => {
    const groupLines = lineGroups.get(row.label) ?? [];
    return {
      ...row,
      brand: firstText(groupLines.map((line) => line.brand)),
      department: firstText(groupLines.map((line) => line.department)),
      salesSource: summarizeLineSourceKind(groupLines)
    };
  });
}

function buildSkuOrderDrilldownRows(
  selectedLines: ProfitLineInput[],
  suppressedDetailLines: ProfitLineInput[],
  selectedSku: string
): SkuPnlOrderDrilldownRow[] {
  const rows = [
    ...selectedLines
      .filter((line) => line.sellerSku === selectedSku)
      .map((line, index) => buildSkuOrderDrilldownRow(line, true, index)),
    ...suppressedDetailLines
      .filter((line) => line.sellerSku === selectedSku)
      .map((line, index) => buildSkuOrderDrilldownRow(line, false, index))
  ];

  return rows.sort(
    (a, b) => (b.orderDate?.getTime() ?? 0) - (a.orderDate?.getTime() ?? 0)
  );
}

function buildSkuOrderDrilldownRow(
  line: ProfitLineInput,
  dashboardIncluded: boolean,
  index: number
): SkuPnlOrderDrilldownRow {
  const [profitRow] = calculateProfitRows([line], "sellerSku");

  return {
    key: `${dashboardIncluded ? "included" : "audit"}:${line.marketplace}:${line.orderId ?? "no-order"}:${line.externalLineId ?? index}`,
    sellerSku: line.sellerSku,
    marketplace: line.marketplace,
    externalOrderId: line.orderId,
    externalLineId: line.externalLineId,
    orderDate: line.orderDate,
    orderStatus: line.orderStatus,
    salesSource: line.salesSource,
    dashboardIncluded,
    quantity: line.quantity,
    netRevenue: profitRow?.netRevenue ?? 0,
    refunds: profitRow?.refunds ?? 0,
    salesRefunds: profitRow?.salesRefunds ?? 0,
    marketplaceFees: profitRow?.marketplaceFees ?? 0,
    commissionFees: profitRow?.commissionFees ?? 0,
    fulfillmentFees: profitRow?.fulfillmentFees ?? 0,
    cogs: profitRow?.cogs ?? 0,
    grossProfit: profitRow?.grossProfit ?? 0,
    netProfit: profitRow?.netProfit ?? 0
  };
}

function filterProfitLines(
  lines: ProfitLineInput[],
  filters: Pick<SkuPnlFilters, "marketplace" | "brand" | "department">
) {
  return lines.filter((line) => {
    if (filters.marketplace && line.marketplace !== filters.marketplace) {
      return false;
    }

    if (filters.brand && normalizeFilterText(line.brand) !== normalizeFilterText(filters.brand)) {
      return false;
    }

    if (
      filters.department &&
      normalizeFilterText(line.department) !== normalizeFilterText(filters.department)
    ) {
      return false;
    }

    return true;
  });
}

function shouldUseDateScopedAttachedAdjustments(
  parentSku: string | undefined,
  sellerSkus: string[],
  filters: Pick<SkuPnlFilters, "brand" | "department">
) {
  return !parentSku && !sellerSkus.length && !filters.brand && !filters.department;
}

function filterStandaloneRowsByLineFilters<T extends { sellerSku: string | null; marketplace: string }>(
  rows: T[],
  filteredSellerSkus: Set<string>,
  filters: Pick<SkuPnlFilters, "marketplace" | "brand" | "department">
) {
  if (!filters.brand && !filters.department) {
    return rows;
  }

  return rows.filter((row) => {
    if (filters.marketplace && row.marketplace !== filters.marketplace) {
      return false;
    }

    return row.sellerSku ? filteredSellerSkus.has(row.sellerSku) : false;
  });
}

function summarizeLineSourceKind(lines: ProfitLineInput[]) {
  const hasPoReport = lines.some((line) => line.salesSource === "po_report");

  if (hasPoReport) {
    return "po_report";
  }

  return "none";
}

function startOfUtcDay(date: Date | null | undefined) {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function calculateParentPeriodTiles(
  lines: ProfitLineInput[],
  advertisingCosts: ProfitAdvertisingCostInput[],
  comparisonPeriod: PnlComparisonPeriod,
  suppressedDetailLines: ProfitLineInput[] = [],
  feeAdjustments: ProfitFeeInput[] = [],
  refundAdjustments: ProfitRefundInput[] = [],
  dateRange?: PnlDateRange,
  useDailyPnlPath = false,
  organizationId = "",
  marketplace = "",
  useMarketplaceFinancialSummary = false
): ParentPnlPeriodTile[] {
  const periods = buildPnlPeriodRanges(comparisonPeriod, dateRange);
  const tiles = periods.map((period) => {
    if (useDailyPnlPath) {
      const dailyResult = calculateDailyPnl({
        organizationId,
        marketplace,
        dateRange: { from: period.start, to: period.end },
        groupBy: "parentSku",
        lines,
        suppressedDetailLines,
        advertisingCosts: filterProductAttributedAdvertisingCosts(advertisingCosts),
        feeAdjustments: filterProductAttributableFees(feeAdjustments),
        refundAdjustments: filterProductAttributableRefunds(refundAdjustments),
        sellerCenterSemMode: "exclude"
      });
      const marketplaceDailyResult = calculateDailyPnl({
        organizationId,
        marketplace,
        dateRange: { from: period.start, to: period.end },
        groupBy: "parentSku",
        lines,
        suppressedDetailLines,
        advertisingCosts,
        feeAdjustments,
        refundAdjustments,
        sellerCenterSemMode: "summaryOnly"
      });
      const summary = dailyResult.summary;
      const marketplaceSummary = marketplaceDailyResult.summary;
      const displaySummary = useMarketplaceFinancialSummary ? marketplaceSummary : summary;
      const refundUnits = dailyResult.lines
        .filter((line) => isRefundLine(line))
        .reduce((total, line) => total + line.quantity, 0);

      return {
        periodKey: period.key,
        label: period.label,
        dateLabel: formatDateRangeLabel(period.start, period.end),
        from: period.start.toISOString(),
        to: period.end.toISOString(),
        salesSource: dailyResult.salesSource,
        grossRevenue: displaySummary.grossRevenue,
        netRevenue: displaySummary.netRevenue,
        netRevenueChangePercent: null,
        orderCount: calculateOrderCount(dailyResult.lines),
        units: displaySummary.quantity,
        refundUnits,
        refunds: displaySummary.refunds,
        salesRefunds: displaySummary.salesRefunds,
        marketplaceFees: displaySummary.marketplaceFees,
        commissionFees: displaySummary.commissionFees,
        fulfillmentFees: displaySummary.fulfillmentFees,
        sellerFulfilledShippingCost: displaySummary.sellerFulfilledShippingCost,
        shippingFees: displaySummary.shippingFees,
        storageFees: displaySummary.storageFees,
        returnFees: displaySummary.returnFees,
        adjustmentFees: displaySummary.adjustmentFees,
        otherFees: displaySummary.otherFees,
        otherWalmartFeesAndAdjustments: getOtherWalmartFeesAndAdjustments(marketplaceSummary),
        otherFeeCategoryBreakdown: displaySummary.otherFeeCategoryBreakdown,
        semAdvertisingCost: marketplaceSummary.semAdvertisingCost,
        walmartConnectAdvertisingCost: displaySummary.walmartConnectAdvertisingCost,
        advertisingCost: displaySummary.advertisingCost,
        tacosPercent: displaySummary.tacosPercent,
        cogs: displaySummary.cogs,
        grossProfit: displaySummary.grossProfit,
        grossProfitChangePercent: null,
        grossMarginPercent: displaySummary.grossMarginPercent,
        netProfit: displaySummary.netProfit,
        netProfitChangePercent: null,
        marginPercent: displaySummary.marginPercent,
        missingCogsUnits: displaySummary.missingCogsUnits
      };
    }

    const periodLines = lines.filter(
      (line) => line.orderDate && line.orderDate >= period.start && line.orderDate <= period.end
    );
    const periodAdCosts = prepareAdvertisingCostsForDateRange(advertisingCosts, {
      from: period.start,
      to: period.end
    });
    const productPeriodAdCosts = filterProductAttributedAdvertisingCosts(periodAdCosts);
    const periodSuppressedDetailLines = suppressedDetailLines.filter(
      (line) => line.orderDate && line.orderDate >= period.start && line.orderDate <= period.end
    );
    const periodFeeAdjustments = prepareFeesForDateRange(feeAdjustments, {
      from: period.start,
      to: period.end
    }, periodLines);
    const periodRefundAdjustments = filterRefundsByDateRange(refundAdjustments, {
      from: period.start,
      to: period.end
    });
    const productPeriodFeeAdjustments = filterProductAttributableFees(periodFeeAdjustments);
    const productPeriodRefundAdjustments = filterProductAttributableRefunds(periodRefundAdjustments);
    const marketplaceRows = calculateProfitRows(
      periodLines,
      "parentSku",
      periodAdCosts,
      periodFeeAdjustments,
      periodRefundAdjustments
    );
    const marketplaceSummary = summarizeProfit(marketplaceRows);
    const parentRows = calculateProfitRows(
      periodLines,
      "parentSku",
      productPeriodAdCosts,
      productPeriodFeeAdjustments,
      productPeriodRefundAdjustments
    );
    const summary = summarizeProfit(parentRows);
    const displaySummary = useMarketplaceFinancialSummary ? marketplaceSummary : summary;
    const explicitOrderCount = periodLines.reduce(
      (total, line) => total + (line.orderCount ?? 0),
      0
    );
    const orderIds = new Set(
      periodLines
        .filter((line) => line.orderCount === undefined)
        .map((line) => line.orderId)
        .filter(Boolean)
    );
    const refundUnits = periodLines
      .filter((line) => isRefundLine(line))
      .reduce((total, line) => total + line.quantity, 0);

    return {
      periodKey: period.key,
      label: period.label,
      dateLabel: formatDateRangeLabel(period.start, period.end),
      from: period.start.toISOString(),
      to: period.end.toISOString(),
      salesSource: summarizeSalesSource(periodLines, periodSuppressedDetailLines),
      grossRevenue: displaySummary.grossRevenue,
      netRevenue: displaySummary.netRevenue,
      netRevenueChangePercent: null,
      orderCount: explicitOrderCount + orderIds.size,
      units: displaySummary.quantity,
      refundUnits,
      refunds: displaySummary.refunds,
      salesRefunds: displaySummary.salesRefunds,
      marketplaceFees: displaySummary.marketplaceFees,
      commissionFees: displaySummary.commissionFees,
      fulfillmentFees: displaySummary.fulfillmentFees,
      sellerFulfilledShippingCost: displaySummary.sellerFulfilledShippingCost,
      shippingFees: displaySummary.shippingFees,
      storageFees: displaySummary.storageFees,
      returnFees: displaySummary.returnFees,
      adjustmentFees: displaySummary.adjustmentFees,
      otherFees: displaySummary.otherFees,
      otherWalmartFeesAndAdjustments: getOtherWalmartFeesAndAdjustments(marketplaceSummary),
      otherFeeCategoryBreakdown: displaySummary.otherFeeCategoryBreakdown,
      semAdvertisingCost: marketplaceSummary.semAdvertisingCost,
      walmartConnectAdvertisingCost: displaySummary.walmartConnectAdvertisingCost,
      advertisingCost: displaySummary.advertisingCost,
      tacosPercent: displaySummary.tacosPercent,
      cogs: displaySummary.cogs,
      grossProfit: displaySummary.grossProfit,
      grossProfitChangePercent: null,
      grossMarginPercent: displaySummary.grossMarginPercent,
      netProfit: displaySummary.netProfit,
      netProfitChangePercent: null,
      marginPercent: displaySummary.marginPercent,
      missingCogsUnits: displaySummary.missingCogsUnits
    };
  });

  return tiles.map((tile, index) => {
    const previous = tiles[index + 1];
    return {
      ...tile,
      netRevenueChangePercent: previous
        ? calculateChangePercent(tile.netRevenue, previous.netRevenue)
        : null,
      grossProfitChangePercent: previous
        ? calculateChangePercent(tile.grossProfit, previous.grossProfit)
        : null,
      netProfitChangePercent: previous
        ? calculateChangePercent(tile.netProfit, previous.netProfit)
        : null
    };
  });
}

function calculateParentMonthlyComparisonRows(
  lines: ProfitLineInput[],
  advertisingCosts: ProfitAdvertisingCostInput[],
  suppressedDetailLines: ProfitLineInput[] = [],
  feeAdjustments: ProfitFeeInput[] = [],
  refundAdjustments: ProfitRefundInput[] = [],
  dateRange?: PnlDateRange,
  comparisonPeriod: PnlComparisonPeriod = "month",
  useDailyPnlPath = false,
  organizationId = "",
  marketplace = "",
  useMarketplaceFinancialSummary = false
): ParentPnlMonthlyComparisonRow[] {
  const periods = buildPnlPeriodRanges(comparisonPeriod, dateRange);
  const rows = periods.map((period) => {
    if (useDailyPnlPath) {
      const dailyResult = calculateDailyPnl({
        organizationId,
        marketplace,
        dateRange: { from: period.start, to: period.end },
        groupBy: "parentSku",
        lines,
        suppressedDetailLines,
        advertisingCosts: filterProductAttributedAdvertisingCosts(advertisingCosts),
        feeAdjustments: filterProductAttributableFees(feeAdjustments),
        refundAdjustments: filterProductAttributableRefunds(refundAdjustments),
        sellerCenterSemMode: "exclude"
      });
      const marketplaceDailyResult = calculateDailyPnl({
        organizationId,
        marketplace,
        dateRange: { from: period.start, to: period.end },
        groupBy: "parentSku",
        lines,
        suppressedDetailLines,
        advertisingCosts,
        feeAdjustments,
        refundAdjustments,
        sellerCenterSemMode: "summaryOnly"
      });
      const summary = dailyResult.summary;
      const marketplaceSummary = marketplaceDailyResult.summary;
      const displaySummary = useMarketplaceFinancialSummary ? marketplaceSummary : summary;

      return {
        monthKey: period.key,
        label: period.label,
        dateLabel: formatDateRangeLabel(period.start, period.end),
        from: period.start.toISOString(),
        to: period.end.toISOString(),
        salesSource: dailyResult.salesSource,
        grossRevenue: displaySummary.grossRevenue,
        netRevenue: displaySummary.netRevenue,
        netRevenueChangePercent: null,
        orderCount: calculateOrderCount(dailyResult.lines),
        units: displaySummary.quantity,
        refunds: displaySummary.refunds,
        salesRefunds: displaySummary.salesRefunds,
        marketplaceFees: displaySummary.marketplaceFees,
        commissionFees: displaySummary.commissionFees,
        fulfillmentFees: displaySummary.fulfillmentFees,
        sellerFulfilledShippingCost: displaySummary.sellerFulfilledShippingCost,
        shippingFees: displaySummary.shippingFees,
        storageFees: displaySummary.storageFees,
        returnFees: displaySummary.returnFees,
        adjustmentFees: displaySummary.adjustmentFees,
        otherFees: displaySummary.otherFees,
        otherWalmartFeesAndAdjustments: getOtherWalmartFeesAndAdjustments(marketplaceSummary),
        otherFeeCategoryBreakdown: displaySummary.otherFeeCategoryBreakdown,
        semAdvertisingCost: marketplaceSummary.semAdvertisingCost,
        walmartConnectAdvertisingCost: displaySummary.walmartConnectAdvertisingCost,
        advertisingCost: displaySummary.advertisingCost,
        tacosPercent: displaySummary.tacosPercent,
        cogs: displaySummary.cogs,
        grossProfit: displaySummary.grossProfit,
        netProfit: displaySummary.netProfit,
        grossMarginPercent: displaySummary.grossMarginPercent,
        netMarginPercent: displaySummary.netMarginPercent,
        profitPerUnit: displaySummary.profitPerUnit,
        missingCogsUnits: displaySummary.missingCogsUnits
      };
    }

    const periodLines = lines.filter(
      (line) => line.orderDate && line.orderDate >= period.start && line.orderDate <= period.end
    );
    const periodAdCosts = prepareAdvertisingCostsForDateRange(advertisingCosts, {
      from: period.start,
      to: period.end
    });
    const productPeriodAdCosts = filterProductAttributedAdvertisingCosts(periodAdCosts);
    const periodSuppressedDetailLines = suppressedDetailLines.filter(
      (line) => line.orderDate && line.orderDate >= period.start && line.orderDate <= period.end
    );
    const periodFeeAdjustments = prepareFeesForDateRange(feeAdjustments, {
      from: period.start,
      to: period.end
    }, periodLines);
    const periodRefundAdjustments = filterRefundsByDateRange(refundAdjustments, {
      from: period.start,
      to: period.end
    });
    const productPeriodFeeAdjustments = filterProductAttributableFees(periodFeeAdjustments);
    const productPeriodRefundAdjustments = filterProductAttributableRefunds(periodRefundAdjustments);
    const marketplaceRows = calculateProfitRows(
      periodLines,
      "parentSku",
      periodAdCosts,
      periodFeeAdjustments,
      periodRefundAdjustments
    );
    const marketplaceSummary = summarizeProfit(marketplaceRows);
    const parentRows = calculateProfitRows(
      periodLines,
      "parentSku",
      productPeriodAdCosts,
      productPeriodFeeAdjustments,
      productPeriodRefundAdjustments
    );
    const summary = summarizeProfit(parentRows);
    const displaySummary = useMarketplaceFinancialSummary ? marketplaceSummary : summary;

    return {
      monthKey: period.key,
      label: period.label,
      dateLabel: formatDateRangeLabel(period.start, period.end),
      from: period.start.toISOString(),
      to: period.end.toISOString(),
      salesSource: summarizeSalesSource(periodLines, periodSuppressedDetailLines),
      grossRevenue: displaySummary.grossRevenue,
      netRevenue: displaySummary.netRevenue,
      netRevenueChangePercent: null,
      orderCount: calculateOrderCount(periodLines),
      units: displaySummary.quantity,
      refunds: displaySummary.refunds,
      salesRefunds: displaySummary.salesRefunds,
      marketplaceFees: displaySummary.marketplaceFees,
      commissionFees: displaySummary.commissionFees,
      fulfillmentFees: displaySummary.fulfillmentFees,
      sellerFulfilledShippingCost: displaySummary.sellerFulfilledShippingCost,
      shippingFees: displaySummary.shippingFees,
      storageFees: displaySummary.storageFees,
      returnFees: displaySummary.returnFees,
      adjustmentFees: displaySummary.adjustmentFees,
      otherFees: displaySummary.otherFees,
      otherWalmartFeesAndAdjustments: getOtherWalmartFeesAndAdjustments(marketplaceSummary),
      otherFeeCategoryBreakdown: displaySummary.otherFeeCategoryBreakdown,
      semAdvertisingCost: marketplaceSummary.semAdvertisingCost,
      walmartConnectAdvertisingCost: displaySummary.walmartConnectAdvertisingCost,
      advertisingCost: displaySummary.advertisingCost,
      tacosPercent: displaySummary.tacosPercent,
      cogs: displaySummary.cogs,
      grossProfit: displaySummary.grossProfit,
      netProfit: displaySummary.netProfit,
      grossMarginPercent: displaySummary.grossMarginPercent,
      netMarginPercent: displaySummary.netMarginPercent,
      profitPerUnit: displaySummary.profitPerUnit,
      missingCogsUnits: displaySummary.missingCogsUnits
    };
  });

  return rows.map((row, index) => {
    const previous = rows[index + 1];
    return {
      ...row,
      netRevenueChangePercent: previous
        ? calculateChangePercent(row.netRevenue, previous.netRevenue)
        : null
    };
  });
}

function summarizeSalesSource(
  lines: ProfitLineInput[],
  suppressedDetailLines: ProfitLineInput[] = []
): PnlSalesSourceSummary {
  const hasPoReport = lines.some((line) => line.salesSource === "po_report");
  const suppressedDetailGmv = roundMoney(
    suppressedDetailLines.reduce(
      (sum, line) =>
        sum + line.itemRevenue + (line.shippingRevenue ?? 0) - (line.discountAmount ?? 0),
      0
    )
  );
  const note =
    "P&L sales use Walmart PO reports for sales, units, orders, SKU, product, fulfillment type, and order date. Product P&L includes only financial rows that can be attributed directly to a SKU or parent.";

  if (!lines.length) {
    return {
      kind: "none",
      label: "Sales source: No sales rows",
      note,
      summaryMonthCount: 0,
      suppressedDetailRowCount: suppressedDetailLines.length,
      suppressedDetailGmv
    };
  }

  if (hasPoReport) {
    return {
      kind: "po_report",
      label: "Sales source: Walmart PO reports",
      note,
      summaryMonthCount: lines.length,
      suppressedDetailRowCount: suppressedDetailLines.length,
      suppressedDetailGmv
    };
  }

  return {
    kind: "none",
    label: "Sales source: No PO sales rows",
    note,
    summaryMonthCount: 0,
    suppressedDetailRowCount: suppressedDetailLines.length,
    suppressedDetailGmv
  };
}

function getTileDateRange(tile?: ParentPnlPeriodTile) {
  if (!tile) {
    return null;
  }

  return {
    from: new Date(tile.from),
    to: new Date(tile.to)
  };
}

function filterLinesByDateRange(lines: ProfitLineInput[], dateRange: Required<PnlDateRange>) {
  return lines.filter(
    (line) => line.orderDate && line.orderDate >= dateRange.from && line.orderDate <= dateRange.to
  );
}

function shouldUseDailyPnlPath(dateRange?: PnlDateRange, comparisonPeriod?: PnlComparisonPeriod) {
  if (comparisonPeriod === "day" || comparisonPeriod === "week") {
    return true;
  }

  if (!dateRange?.from && !dateRange?.to) {
    return false;
  }

  if (comparisonPeriod === "month" || comparisonPeriod === "quarter") {
    return false;
  }

  return !isFullCalendarMonthRange(dateRange);
}

function buildDataQualityLabels(
  summary: ReturnType<typeof summarizeProfit>,
  settlementAllocation: PnlSettlementAllocationSummary
) {
  const labels: string[] = [];

  if (settlementAllocation.missingPeriodMetadataCount > 0) {
    labels.push("Settlement dates incomplete");
  }

  if (summary.missingCogsUnits > 0) {
    labels.push("Missing COGS");
  }

  return labels.length ? labels : ["Complete"];
}

function getOtherWalmartFeesAndAdjustments(summary: ReturnType<typeof summarizeProfit>) {
  return roundMoney(
    summary.marketplaceFees -
      summary.commissionFees -
      summary.fulfillmentFees -
      summary.sellerFulfilledShippingCost
  );
}

function filterAdvertisingCostsByDateRange(
  advertisingCosts: ProfitAdvertisingCostInput[],
  dateRange: Required<PnlDateRange>
) {
  return prepareAdvertisingCostsForDateRange(advertisingCosts, dateRange);
}

function filterFeesByDateRange(
  fees: ProfitFeeInput[],
  dateRange: Required<PnlDateRange>
) {
  return prepareFeesForDateRange(fees, dateRange);
}

function prepareFeesForDateRange(
  fees: ProfitFeeInput[],
  dateRange?: PnlDateRange,
  _activeLines: ProfitLineInput[] = []
): ProfitFeeInput[] {
  return fees
    .map((fee) => prepareFeeForDateRange(fee, dateRange))
    .filter((fee): fee is ProfitFeeInput => Boolean(fee));
}

function prepareFeeForDateRange(
  fee: ProfitFeeInput,
  dateRange?: PnlDateRange
) {
  if (!dateRange?.from && !dateRange?.to) {
    return fee;
  }

  if (isSettlementDerivedCommissionFee(fee)) {
    return prepareSettlementDerivedCommissionForDateRange(fee, dateRange).fee;
  }

  if (!isWalmartSettlementMetadata(fee.metadata)) {
    return isDateInRange(fee.postedAt, dateRange) ? fee : null;
  }

  if (isSingleDaySettlementMetadata(fee.metadata)) {
    return isDateInRange(fee.postedAt, dateRange) ? fee : null;
  }

  const allocation = SETTLEMENT_ALLOCATOR.allocateForRange(
    {
      amount: fee.amount,
      settlementPeriodStart: readMetadataText(fee.metadata, "periodStartDate"),
      settlementPeriodEnd: readMetadataText(fee.metadata, "periodEndDate"),
      postingDate: fee.postedAt
    },
    dateRange
  );

  if (allocation.amount === 0) {
    return null;
  }

  return {
    ...fee,
    amount: allocation.amount,
    metadata: withSettlementAllocationMetadata(fee.metadata, allocation)
  };
}

function prepareAdvertisingCostsForDateRange(
  costs: ProfitAdvertisingCostInput[],
  dateRange?: PnlDateRange
): ProfitAdvertisingCostInput[] {
  return costs
    .map((cost) => prepareAdvertisingCostForDateRange(cost, dateRange))
    .filter((cost): cost is ProfitAdvertisingCostInput => Boolean(cost));
}

function prepareAdvertisingCostForDateRange(
  cost: ProfitAdvertisingCostInput,
  dateRange?: PnlDateRange
) {
  if (!isDailyCapableWalmartConnectCost(cost)) {
    return null;
  }

  if (!dateRange?.from && !dateRange?.to) {
    return cost;
  }

  return isDateInRange(cost.costDate, dateRange) ? cost : null;
}

function filterRefundsByDateRange(
  refunds: ProfitRefundInput[],
  dateRange: Required<PnlDateRange>
) {
  return prepareRefundsForDateRange(refunds, dateRange);
}

function prepareRefundsForDateRange(
  refunds: ProfitRefundInput[],
  dateRange?: PnlDateRange
): ProfitRefundInput[] {
  return refunds
    .map((refund) => prepareRefundForDateRange(refund, dateRange))
    .filter((refund): refund is ProfitRefundInput => Boolean(refund));
}

function prepareRefundForDateRange(
  refund: ProfitRefundInput,
  dateRange?: PnlDateRange
) {
  if (!dateRange?.from && !dateRange?.to) {
    return refund;
  }

  if (!isWalmartSettlementMetadata(refund.metadata)) {
    return isDateInRange(refund.refundDate, dateRange) ? refund : null;
  }

  if (isTransactionPostedSettlementMetadata(refund.metadata)) {
    return isDateInRange(refund.refundDate, dateRange) ? refund : null;
  }

  const allocation = SETTLEMENT_ALLOCATOR.allocateForRange(
    {
      amount: refund.amount,
      settlementPeriodStart: readMetadataText(refund.metadata, "periodStartDate"),
      settlementPeriodEnd: readMetadataText(refund.metadata, "periodEndDate"),
      postingDate: refund.refundDate
    },
    dateRange
  );

  if (allocation.amount === 0) {
    return null;
  }

  return {
    ...refund,
    amount: allocation.amount,
    metadata: withSettlementAllocationMetadata(refund.metadata, allocation)
  };
}

function formatDateRangeLabel(start: Date, end: Date) {
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC"
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(end);

  return `${startLabel} - ${endLabel}`;
}

function isRefundLine(line: ProfitLineInput) {
  const status = line.orderStatus?.toLowerCase() ?? "";
  const hasRefundAmount = (line.refunds ?? []).some((refund) => Math.abs(refund.amount) > 0);
  return status.includes("refund") || line.itemRevenue < 0 || hasRefundAmount;
}

function calculateOrderCount(lines: ProfitLineInput[]) {
  const explicitOrderCount = lines.reduce((total, line) => total + (line.orderCount ?? 0), 0);
  const orderIds = new Set(
    lines
      .filter((line) => line.orderCount === undefined)
      .map((line) => line.orderId)
      .filter(Boolean)
  );

  return explicitOrderCount + orderIds.size;
}

async function getOrderLevelFees(
  organizationId: string,
  orderIds: string[],
  dateRange?: PnlDateRange
): Promise<MarketplaceFee[]> {
  if (!orderIds.length) {
    return [];
  }

  const fees: MarketplaceFee[] = [];
  const postedAt = buildDateRangeWhere(dateRange);

  for (const orderIdChunk of chunkArray(orderIds, PRISMA_IN_FILTER_CHUNK_SIZE)) {
    fees.push(
      ...(await prisma.marketplaceFee.findMany({
        where: {
          organizationId,
          orderId: { in: orderIdChunk },
          orderItemId: null,
          ...(postedAt ? { postedAt } : {})
        }
      }))
    );
  }

  return fees;
}

async function getAttachedFeesByPostedDate(
  organizationId: string,
  dateRange?: PnlDateRange,
  marketplace?: string
): Promise<PnlMarketplaceFee[]> {
  const where: Prisma.Sql[] = [
    Prisma.sql`"organizationId" = ${organizationId}`,
    Prisma.sql`("orderId" IS NOT NULL OR "orderItemId" IS NOT NULL)`
  ];

  if (marketplace) {
    where.push(Prisma.sql`"marketplace" = ${marketplace}`);
  }

  if (dateRange?.from) {
    where.push(Prisma.sql`"postedAt" >= ${dateRange.from}`);
  }

  if (dateRange?.to) {
    where.push(Prisma.sql`"postedAt" <= ${dateRange.to}`);
  }

  return prisma.$queryRaw<PnlMarketplaceFee[]>(Prisma.sql`
    SELECT
      "marketplace",
      "sellerSku",
      "feeType",
      "feeAmount",
      "postedAt",
      "metadata",
      "orderId",
      "orderItemId"
    FROM "MarketplaceFee"
    WHERE ${Prisma.join(where, " AND ")}
  `);
}

async function getItemLevelFees(
  organizationId: string,
  orderItemIds: string[],
  dateRange?: PnlDateRange
): Promise<PnlMarketplaceFee[]> {
  if (!orderItemIds.length) {
    return [];
  }

  const fees: PnlMarketplaceFee[] = [];
  const postedAt = buildDateRangeWhere(dateRange);

  for (const orderItemIdChunk of chunkArray(orderItemIds, PRISMA_IN_FILTER_CHUNK_SIZE)) {
    fees.push(
      ...(await prisma.marketplaceFee.findMany({
        where: {
          organizationId,
          orderItemId: { in: orderItemIdChunk },
          ...(postedAt ? { postedAt } : {})
        },
        select: {
          marketplace: true,
          sellerSku: true,
          feeType: true,
          feeAmount: true,
          postedAt: true,
          metadata: true,
          orderId: true,
          orderItemId: true
        }
      }))
    );
  }

  return fees;
}

async function getStandaloneFees(
  organizationId: string,
  dateRange?: PnlDateRange,
  parentSku?: string,
  sellerSkus: string[] = [],
  marketplace?: string
): Promise<MarketplaceFee[]> {
  const postedAt = buildDateRangeWhere(dateRange);
  const dateOrManualPeriodWhere = postedAt
    ? { OR: [{ postedAt }, { feeType: SELLER_FULFILLED_SHIPPING_FEE_TYPE }] }
    : {};

  return prisma.marketplaceFee.findMany({
    where: {
      organizationId,
      ...(marketplace ? { marketplace } : {}),
      orderId: null,
      orderItemId: null,
      ...dateOrManualPeriodWhere,
      ...buildParentSkuAdjustmentWhere(parentSku, sellerSkus)
    }
  });
}

async function getOrderLevelRefunds(
  organizationId: string,
  orderIds: string[],
  dateRange?: PnlDateRange
): Promise<Refund[]> {
  if (!orderIds.length) {
    return [];
  }

  const refunds: Refund[] = [];
  const refundDate = buildDateRangeWhere(dateRange);

  for (const orderIdChunk of chunkArray(orderIds, PRISMA_IN_FILTER_CHUNK_SIZE)) {
    refunds.push(
      ...(await prisma.refund.findMany({
        where: {
          organizationId,
          orderId: { in: orderIdChunk },
          orderItemId: null,
          ...(refundDate ? { refundDate } : {})
        }
      }))
    );
  }

  return refunds;
}

async function getAttachedRefundsByRefundDate(
  organizationId: string,
  dateRange?: PnlDateRange,
  marketplace?: string
): Promise<PnlRefund[]> {
  const where: Prisma.Sql[] = [
    Prisma.sql`"organizationId" = ${organizationId}`,
    Prisma.sql`("orderId" IS NOT NULL OR "orderItemId" IS NOT NULL)`
  ];

  if (marketplace) {
    where.push(Prisma.sql`"marketplace" = ${marketplace}`);
  }

  if (dateRange?.from) {
    where.push(Prisma.sql`"refundDate" >= ${dateRange.from}`);
  }

  if (dateRange?.to) {
    where.push(Prisma.sql`"refundDate" <= ${dateRange.to}`);
  }

  return prisma.$queryRaw<PnlRefund[]>(Prisma.sql`
    SELECT
      "marketplace",
      "sellerSku",
      "refundAmount",
      "refundDate",
      "metadata",
      "orderId",
      "orderItemId"
    FROM "Refund"
    WHERE ${Prisma.join(where, " AND ")}
  `);
}

async function getItemLevelRefunds(
  organizationId: string,
  orderItemIds: string[],
  dateRange?: PnlDateRange
): Promise<PnlRefund[]> {
  if (!orderItemIds.length) {
    return [];
  }

  const refunds: PnlRefund[] = [];
  const refundDate = buildDateRangeWhere(dateRange);

  for (const orderItemIdChunk of chunkArray(orderItemIds, PRISMA_IN_FILTER_CHUNK_SIZE)) {
    refunds.push(
      ...(await prisma.refund.findMany({
        where: {
          organizationId,
          orderItemId: { in: orderItemIdChunk },
          ...(refundDate ? { refundDate } : {})
        },
        select: {
          marketplace: true,
          sellerSku: true,
          refundAmount: true,
          refundDate: true,
          metadata: true,
          orderId: true,
          orderItemId: true
        }
      }))
    );
  }

  return refunds;
}

async function getStandaloneRefunds(
  organizationId: string,
  dateRange?: PnlDateRange,
  parentSku?: string,
  sellerSkus: string[] = [],
  marketplace?: string
): Promise<Refund[]> {
  const refundDate = buildDateRangeWhere(dateRange);

  return prisma.refund.findMany({
    where: {
      organizationId,
      ...(marketplace ? { marketplace } : {}),
      orderId: null,
      orderItemId: null,
      ...(refundDate ? { refundDate } : {}),
      ...buildParentSkuAdjustmentWhere(parentSku, sellerSkus)
    }
  });
}

function groupRowsByOrderItemId<T extends { orderItemId: string | null }>(rows: T[]) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    if (!row.orderItemId) {
      continue;
    }

    grouped.set(row.orderItemId, [...(grouped.get(row.orderItemId) ?? []), row]);
  }

  return grouped;
}

function buildLineRefsByOrderId(
  items: ProfitLineItem[],
  lines: ProfitLineInput[]
) {
  const refsByOrderId = new Map<string, LineAllocationRef[]>();

  items.forEach((item, index) => {
    const line = lines[index];

    if (!line) {
      return;
    }

    const refs = refsByOrderId.get(item.orderId) ?? [];
    refs.push({ item, line });
    refsByOrderId.set(item.orderId, refs);
  });

  return refsByOrderId;
}

function applyOrderLevelFeesToLines(
  fees: PnlMarketplaceFee[],
  lineRefsByOrderId: Map<string, LineAllocationRef[]>
) {
  for (const fee of fees) {
    const refs = selectAllocationRefs(lineRefsByOrderId.get(fee.orderId ?? "") ?? [], fee.sellerSku);

    if (!refs.length) {
      continue;
    }

    const allocations = allocateAmount(toNumber(fee.feeAmount), refs);

    refs.forEach((ref, index) => {
      ref.line.fees = [
        ...(ref.line.fees ?? []),
        {
          marketplace: fee.marketplace,
          sellerSku: fee.sellerSku ?? ref.line.sellerSku,
          parentSku: ref.line.parentSku,
          feeType: fee.feeType,
          amount: allocations[index] ?? 0,
          postedAt: fee.postedAt,
          metadata: toRecord(fee.metadata)
        }
      ];
    });
  }
}

function applyOrderLevelRefundsToLines(
  refunds: PnlRefund[],
  lineRefsByOrderId: Map<string, LineAllocationRef[]>
) {
  for (const refund of refunds) {
    const refs = selectAllocationRefs(
      lineRefsByOrderId.get(refund.orderId ?? "") ?? [],
      refund.sellerSku
    );

    if (!refs.length) {
      continue;
    }

    const allocations = allocateAmount(Math.abs(toNumber(refund.refundAmount)), refs);

    refs.forEach((ref, index) => {
      ref.line.refunds = [
        ...(ref.line.refunds ?? []),
        {
          marketplace: refund.marketplace,
          sellerSku: refund.sellerSku ?? ref.line.sellerSku,
          parentSku: ref.line.parentSku,
          amount: allocations[index] ?? 0,
          refundDate: refund.refundDate,
          metadata: toRecord(refund.metadata)
        }
      ];
    });
  }
}

function selectAllocationRefs(refs: LineAllocationRef[], sellerSku?: string | null) {
  const normalizedSellerSku = sellerSku?.trim();

  if (!normalizedSellerSku) {
    return refs;
  }

  const matchingRefs = refs.filter((ref) => ref.line.sellerSku === normalizedSellerSku);
  return matchingRefs.length ? matchingRefs : refs;
}

function allocateAmount(amount: number, refs: LineAllocationRef[]) {
  if (!refs.length) {
    return [];
  }

  const revenueWeights = refs.map((ref) =>
    Math.max(
      0,
      toNumber(ref.item.itemRevenue) +
        toNumber(ref.item.shippingRevenue) -
        toNumber(ref.item.discountAmount)
    )
  );
  const revenueTotal = revenueWeights.reduce((sum, value) => sum + value, 0);
  const weights =
    revenueTotal > 0
      ? revenueWeights
      : refs.map((ref) => Math.max(0, ref.item.quantity));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  if (totalWeight <= 0) {
    return splitEvenly(amount, refs.length);
  }

  let allocated = 0;
  return refs.map((_, index) => {
    if (index === refs.length - 1) {
      return roundMoney(amount - allocated);
    }

    const value = roundMoney((amount * weights[index]) / totalWeight);
    allocated += value;
    return value;
  });
}

function splitEvenly(amount: number, count: number) {
  let allocated = 0;
  return Array.from({ length: count }, (_, index) => {
    if (index === count - 1) {
      return roundMoney(amount - allocated);
    }

    const value = roundMoney(amount / count);
    allocated += value;
    return value;
  });
}

function getParentSkuBySellerSku(items: ProfitLineItem[]) {
  const parentSkuBySellerSku = new Map<string, string | null>();

  for (const item of items) {
    const existingParentSku = parentSkuBySellerSku.get(item.sellerSku);

    if (!parentSkuBySellerSku.has(item.sellerSku) || (!existingParentSku && item.parentSku)) {
      parentSkuBySellerSku.set(item.sellerSku, item.parentSku);
    }
  }

  return parentSkuBySellerSku;
}

async function addCatalogParentSkus(
  organizationId: string,
  parentSkuBySellerSku: Map<string, string | null>,
  sellerSkus: string[],
  marketplace?: string
) {
  const lookupSkus = uniqueStrings(sellerSkus);

  if (!lookupSkus.length) {
    return;
  }

  const listings: Array<{ sellerSku: string; parentSku: string | null }> = [];
  const products: Array<{ internalSku: string | null; parentSku: string | null }> = [];
  const orderItems: Array<{ sellerSku: string; parentSku: string | null }> = [];
  const costRecords: Array<{ sellerSku: string; parentSku: string | null }> = [];

  for (const skuChunk of chunkArray(lookupSkus, PRISMA_IN_FILTER_CHUNK_SIZE)) {
    const [listingChunk, productChunk, orderItemChunk, costRecordChunk] = await Promise.all([
      prisma.listing.findMany({
        where: {
          organizationId,
          ...(marketplace ? { marketplace } : {}),
          sellerSku: { in: skuChunk },
          parentSku: { not: null }
        },
        select: { sellerSku: true, parentSku: true }
      }),
      prisma.product.findMany({
        where: {
          organizationId,
          internalSku: { in: skuChunk },
          parentSku: { not: null }
        },
        select: { internalSku: true, parentSku: true }
      }),
      prisma.salesOrderItem.findMany({
        where: {
          organizationId,
          ...(marketplace ? { marketplace } : {}),
          sellerSku: { in: skuChunk },
          parentSku: { not: null }
        },
        distinct: ["sellerSku"],
        select: { sellerSku: true, parentSku: true }
      }),
      prisma.costRecord.findMany({
        where: {
          organizationId,
          ...(marketplace ? { marketplace } : {}),
          sellerSku: { in: skuChunk },
          parentSku: { not: null }
        },
        distinct: ["sellerSku"],
        select: { sellerSku: true, parentSku: true }
      })
    ]);

    listings.push(...listingChunk);
    products.push(...productChunk);
    orderItems.push(...orderItemChunk);
    costRecords.push(...costRecordChunk);
  }

  const listingMappedSkus = new Set<string>();

  for (const listing of listings) {
    if (listing.parentSku) {
      parentSkuBySellerSku.set(listing.sellerSku, listing.parentSku);
      listingMappedSkus.add(listing.sellerSku);
    }
  }

  for (const product of products) {
    if (product.internalSku && product.parentSku && !listingMappedSkus.has(product.internalSku)) {
      parentSkuBySellerSku.set(product.internalSku, product.parentSku);
    }
  }

  for (const item of orderItems) {
    if (item.parentSku && !parentSkuBySellerSku.get(item.sellerSku)) {
      parentSkuBySellerSku.set(item.sellerSku, item.parentSku);
    }
  }

  for (const record of costRecords) {
    if (record.parentSku && !parentSkuBySellerSku.get(record.sellerSku)) {
      parentSkuBySellerSku.set(record.sellerSku, record.parentSku);
    }
  }
}

function mapStandaloneFeeToProfitFee(
  fee: PnlMarketplaceFee,
  parentSkuBySellerSku: Map<string, string | null>,
  selectedParentSku?: string
): ProfitFeeInput {
  const sellerSku = fee.sellerSku?.trim() || null;

  return {
    marketplace: fee.marketplace,
    sellerSku,
    parentSku: selectedParentSku || (sellerSku ? parentSkuBySellerSku.get(sellerSku) : null),
    feeType: fee.feeType,
    amount: toNumber(fee.feeAmount),
    postedAt: fee.postedAt,
    metadata: toRecord(fee.metadata)
  };
}

function mapStandaloneRefundToProfitRefund(
  refund: PnlRefund,
  parentSkuBySellerSku: Map<string, string | null>,
  selectedParentSku?: string
): ProfitRefundInput {
  const sellerSku = refund.sellerSku?.trim() || null;

  return {
    marketplace: refund.marketplace,
    sellerSku,
    parentSku: selectedParentSku || (sellerSku ? parentSkuBySellerSku.get(sellerSku) : null),
    amount: toNumber(refund.refundAmount),
    refundDate: refund.refundDate,
    metadata: toRecord(refund.metadata)
  };
}

async function getAdvertisingCosts(
  organizationId: string,
  parentSku?: string,
  sellerSkus: string[] = [],
  marketplace?: string,
  dateRange?: PnlDateRange
): Promise<ProfitAdvertisingCostInput[]> {
  const costDate = buildDateRangeWhere(dateRange);
  const costs = await prisma.advertisingCost.findMany({
    where: {
      organizationId,
      source: { in: PNL_ADVERTISING_SOURCES },
      ...(marketplace ? { marketplace } : {}),
      ...(costDate ? { costDate } : {}),
      ...buildParentSkuAdvertisingWhere(parentSku, sellerSkus)
    }
  });
  const parentSkuBySellerSku = new Map<string, string | null>();

  await addCatalogParentSkus(
    organizationId,
    parentSkuBySellerSku,
    uniqueStrings(costs.map((cost) => cost.sellerSku))
  );

  return costs
    .map((cost) => ({
      marketplace: cost.marketplace,
      sellerSku: cost.sellerSku,
      parentSku: resolveAdvertisingCostParentSku(
        {
          sellerSku: cost.sellerSku,
          parentSku: cost.parentSku
        },
        parentSkuBySellerSku,
        parentSku
      ),
      source: cost.source,
      amount: toNumber(cost.amount),
      costDate: cost.costDate,
      metadata: toRecord(cost.metadata)
    }));
}

export async function getSkuPnlFilterOptions(marketplace?: string): Promise<SkuPnlFilterOptions> {
  const organizationId = await getCurrentOrganizationId();
  const [parents, products, feeMetadataFilters] =
    await Promise.all([
      getParentSkuOptions(organizationId, marketplace),
      prisma.product.findMany({
        where: { organizationId, brand: { not: null } },
        distinct: ["brand"],
        select: { brand: true }
      }),
      getFeeMetadataFilterOptions(organizationId, marketplace)
    ]);
  const metadataBrands = feeMetadataFilters.map((row) => row.brand);
  const metadataDepartments = feeMetadataFilters.map((row) => row.department);

  return {
    parents,
    marketplaces: toFilterOptions(marketplace ? [marketplace] : []),
    brands: toFilterOptions(uniqueStrings([...products.map((row) => row.brand), ...metadataBrands])),
    departments: toFilterOptions(uniqueStrings(metadataDepartments))
  };
}

async function getFeeMetadataFilterOptions(organizationId: string, marketplace?: string) {
  return prisma.$queryRaw<Array<{ brand: string | null; department: string | null }>>(Prisma.sql`
    SELECT DISTINCT
      NULLIF(BTRIM("metadata"->>'brand'), '') AS "brand",
      NULLIF(BTRIM("metadata"->>'department'), '') AS "department"
    FROM "MarketplaceFee"
    WHERE "organizationId" = ${organizationId}
      ${marketplace ? Prisma.sql`AND "marketplace" = ${marketplace}` : Prisma.empty}
      AND (
        NULLIF(BTRIM("metadata"->>'brand'), '') IS NOT NULL
        OR NULLIF(BTRIM("metadata"->>'department'), '') IS NOT NULL
      )
  `);
}

async function getParentSkuOptions(
  organizationId: string,
  marketplace?: string
): Promise<ParentSkuFilterOption[]> {
  const [products, listings, orderItems, costRecords, advertisingCosts] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, parentSku: { not: null } },
      distinct: ["parentSku"],
      select: { parentSku: true }
    }),
    prisma.listing.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { not: null }
      },
      distinct: ["parentSku"],
      select: { parentSku: true }
    }),
    prisma.salesOrderItem.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { not: null }
      },
      distinct: ["parentSku"],
      select: { parentSku: true }
    }),
    prisma.costRecord.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { not: null }
      },
      distinct: ["parentSku"],
      select: { parentSku: true }
    }),
    prisma.advertisingCost.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku: { not: null }
      },
      distinct: ["parentSku"],
      select: { parentSku: true }
    })
  ]);
  const parentSkus = uniqueStrings([
    ...products.map((row) => row.parentSku),
    ...listings.map((row) => row.parentSku),
    ...orderItems.map((row) => row.parentSku),
    ...costRecords.map((row) => row.parentSku),
    ...advertisingCosts.map((row) => row.parentSku)
  ]);
  const parentProducts = parentSkus.length
    ? await prisma.product.findMany({
        where: { organizationId, internalSku: { in: parentSkus } },
        select: { internalSku: true, title: true }
      })
    : [];
  const titleBySku = new Map(parentProducts.map((product) => [product.internalSku, product.title]));

  return parentSkus.map((parentSku) => ({
    parentSku,
    label: titleBySku.get(parentSku) ? `${parentSku} - ${titleBySku.get(parentSku)}` : parentSku
  }));
}

async function getSellerSkusForParent(
  organizationId: string,
  parentSku: string,
  marketplace?: string
) {
  const [products, listings, orderItems, costRecords, advertisingCosts] = await Promise.all([
    prisma.product.findMany({
      where: { organizationId, parentSku, internalSku: { not: null } },
      select: { internalSku: true }
    }),
    prisma.listing.findMany({
      where: { organizationId, ...(marketplace ? { marketplace } : {}), parentSku },
      select: { sellerSku: true }
    }),
    prisma.salesOrderItem.findMany({
      where: { organizationId, ...(marketplace ? { marketplace } : {}), parentSku },
      distinct: ["sellerSku"],
      select: { sellerSku: true }
    }),
    prisma.costRecord.findMany({
      where: { organizationId, ...(marketplace ? { marketplace } : {}), parentSku },
      distinct: ["sellerSku"],
      select: { sellerSku: true }
    }),
    prisma.advertisingCost.findMany({
      where: {
        organizationId,
        ...(marketplace ? { marketplace } : {}),
        parentSku,
        sellerSku: { not: null }
      },
      distinct: ["sellerSku"],
      select: { sellerSku: true }
    })
  ]);

  return uniqueStrings([
    ...products.map((row) => row.internalSku),
    ...listings.map((row) => row.sellerSku),
    ...orderItems.map((row) => row.sellerSku),
    ...costRecords.map((row) => row.sellerSku),
    ...advertisingCosts.map((row) => row.sellerSku)
  ]);
}

function buildDateRangeWhere(dateRange?: PnlDateRange) {
  if (!dateRange?.from && !dateRange?.to) {
    return null;
  }

  return {
    ...(dateRange.from ? { gte: dateRange.from } : {}),
    ...(dateRange.to ? { lte: dateRange.to } : {})
  };
}

function createPnlTimer(label: string) {
  const startedAt = performance.now();
  let previousAt = startedAt;
  const marks: Array<{ label: string; ms: number; totalMs: number }> = [];

  return {
    mark(markLabel: string) {
      if (process.env.NODE_ENV === "production") {
        return;
      }

      const now = performance.now();
      marks.push({
        label: markLabel,
        ms: Math.round(now - previousAt),
        totalMs: Math.round(now - startedAt)
      });
      previousAt = now;
    },
    finish(details: Record<string, unknown>) {
      if (process.env.NODE_ENV === "production") {
        return;
      }

      const totalMs = Math.round(performance.now() - startedAt);
      if (totalMs < 5_000) {
        return;
      }

      console.info(
        `[pnl-timing] ${label} ${totalMs}ms`,
        JSON.stringify({ ...details, marks })
      );
    }
  };
}

function describeDateRange(dateRange?: PnlDateRange | null) {
  if (!dateRange?.from && !dateRange?.to) {
    return null;
  }

  return {
    from: dateRange.from ? dateRange.from.toISOString() : null,
    to: dateRange.to ? dateRange.to.toISOString() : null
  };
}

function getPnlDataLoadRange(
  comparisonPeriod: PnlComparisonPeriod = "month",
  dateRange?: PnlDateRange
): Required<PnlDateRange> {
  const periods = buildPnlPeriodRanges(comparisonPeriod, dateRange);
  const from = periods.reduce(
    (earliest, period) => (period.start < earliest ? period.start : earliest),
    periods[0]?.start ?? new Date()
  );
  const to = periods.reduce(
    (latest, period) => (period.end > latest ? period.end : latest),
    periods[0]?.end ?? new Date()
  );

  return { from, to };
}

function buildParentSkuLineWhere(parentSku?: string, sellerSkus: string[] = []) {
  if (!parentSku) {
    return {};
  }

  return {
    OR: [
      { parentSku },
      ...(sellerSkus.length ? [{ sellerSku: { in: sellerSkus } }] : [])
    ]
  };
}

function buildParentSkuAdvertisingWhere(parentSku?: string, sellerSkus: string[] = []) {
  if (!parentSku) {
    return {};
  }

  return {
    OR: [
      { parentSku },
      ...(sellerSkus.length ? [{ sellerSku: { in: sellerSkus } }] : [])
    ]
  };
}

function buildParentSkuAdjustmentWhere(parentSku?: string, sellerSkus: string[] = []) {
  if (!parentSku) {
    return {};
  }

  const skus = uniqueStrings([parentSku, ...sellerSkus]);
  return skus.length ? { sellerSku: { in: skus } } : {};
}

function calculateChangePercent(current: number, previous: number) {
  if (previous === 0) {
    return null;
  }

  return ((current - previous) / Math.abs(previous)) * 100;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }

  return 0;
}

function getSalesSourceFromOrderItem(item: ProfitLineItem) {
  return getPoSalesSourceFromOrderItem({
    orderStatus: item.order.status,
    poOrderStatus: getDirectPoOrderStatus(item),
    lineMetadata: []
  });
}

function getDirectPoOrderStatus(item: ProfitLineItem) {
  const value = (item as ProfitLineItem & { poOrderStatus?: unknown }).poOrderStatus;
  return typeof value === "string" ? value : null;
}

function getImportedOrderCount(
  fees: Array<{ metadata: unknown }>
) {
  for (const fee of fees) {
    const metadata = toRecord(fee.metadata);
    const orders = metadata?.orders;

    if (typeof orders === "number" && Number.isFinite(orders)) {
      return orders;
    }

    if (typeof orders === "string") {
      const parsed = Number(orders);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function getSupportedLineSalesRefundsFromFees(item: ProfitLineItem) {
  const salesSource = getSalesSourceFromOrderItem(item);

  if (salesSource !== "po_report") {
    return 0;
  }

  return 0;
}

function getLineBrand(item: ProfitLineItem) {
  return item.product?.brand ?? null;
}

function getLineDepartment(_item: ProfitLineItem) {
  return null;
}

function summarizeSettlementAllocation(
  rows: Array<{ metadata?: Record<string, unknown> }>
): PnlSettlementAllocationSummary {
  return rows.reduce(
    (summary, row) => {
      const allocation = toRecord(row.metadata?.[SETTLEMENT_ALLOCATION_METADATA_KEY]);

      if (!allocation) {
        return summary;
      }

      if (allocation.applied === true) {
        summary.allocatedCount += 1;
      }

      if (allocation.fallback === true) {
        summary.fallbackCount += 1;
      }

      if (allocation.missingPeriodMetadata === true) {
        summary.missingPeriodMetadataCount += 1;
      }

      return summary;
    },
    {
      allocatedCount: 0,
      fallbackCount: 0,
      missingPeriodMetadataCount: 0
    }
  );
}

function getFirstSettlementCommissionDiagnostic(
  fees: ProfitFeeInput[]
): SettlementCommissionDiagnostic | null {
  for (const fee of fees) {
    const diagnostic = getSettlementCommissionDiagnostic(fee);

    if (diagnostic) {
      return diagnostic;
    }
  }

  return null;
}

function withSettlementAllocationMetadata(
  metadata: Record<string, unknown> | undefined,
  allocation: {
    applied: boolean;
    fallback: boolean;
    missingPeriodMetadata: boolean;
    dayCount: number;
    overlapDayCount: number;
  }
) {
  return {
    ...(metadata ?? {}),
    [SETTLEMENT_ALLOCATION_METADATA_KEY]: {
      applied: allocation.applied,
      fallback: allocation.fallback,
      missingPeriodMetadata: allocation.missingPeriodMetadata,
      dayCount: allocation.dayCount,
      overlapDayCount: allocation.overlapDayCount
    }
  };
}

function isWalmartSettlementMetadata(metadata: Record<string, unknown> | undefined) {
  return (
    readMetadataText(metadata, "source") === "walmart_payments_new" ||
    isSellerFulfilledShippingMetadata(metadata)
  );
}

function isTransactionPostedSettlementMetadata(metadata: Record<string, unknown> | undefined) {
  return readMetadataText(metadata, "reportingDateSource") === "transaction_posted_timestamp";
}

function isSingleDaySettlementMetadata(metadata: Record<string, unknown> | undefined) {
  const reportingDateSource = readMetadataText(metadata, "reportingDateSource");
  return (
    reportingDateSource === "transaction_posted_timestamp" ||
    reportingDateSource === "settlement_period_end_unmatched_fee" ||
    reportingDateSource === "transaction_posted_timestamp_missing_period_end"
  );
}

function isDateInRange(date: Date | null | undefined, dateRange: SettlementDateRange) {
  if (!date) {
    return false;
  }

  return (!dateRange.from || date >= dateRange.from) && (!dateRange.to || date <= dateRange.to);
}

function readMetadataText(value: unknown, key: string) {
  const record = toRecord(value);
  const text = record?.[key];

  return typeof text === "string" ? text.trim() || null : null;
}

function readMetadataNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function firstText(values: Array<string | null | undefined>) {
  return values.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function normalizeFilterText(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function toRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b));
}

function toFilterOptions(values: string[]): SkuPnlFilterOption[] {
  return values.map((value) => ({ value, label: value }));
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}
