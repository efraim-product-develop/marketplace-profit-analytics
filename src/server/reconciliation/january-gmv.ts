import { prisma } from "@/lib/db";
import { getCurrentOrganizationId } from "@/server/organizations/current";

const DEFAULT_MARKETPLACE = "walmart";
const DEFAULT_REPORT_MONTH = "2026-01";
const DEFAULT_SELLER_CENTER_GMV = 399_901.36;

type SourceBucketKey =
  | "itemSales"
  | "poOrder"
  | "wfsOrder"
  | "sellerFulfilledOrder"
  | "unknownOrder";

type SourceSummary = {
  key: SourceBucketKey | "dashboard";
  label: string;
  gmv: number;
  rows: number;
  orders: number;
  units: number;
  refunds: number;
  cancelledSales: number;
  includedInDashboard: boolean;
  notes: string;
};

type IssueSummary = {
  code: string;
  severity: string;
  count: number;
  gmvTotal: number;
  unitsTotal: number;
  sampleMessages: string[];
};

type SkuGap = {
  sku: string;
  itemSalesGmv: number;
  orderReportGmv: number;
  dashboardGmv: number;
  differenceFromDashboard: number;
};

export type JanuaryGmvReconciliationReport = {
  generatedAt: string;
  marketplace: string;
  reportMonth: string;
  sellerCenterGmv: number;
  dashboardGmv: number;
  difference: number;
  dashboardFormula: string;
  dashboardSource: {
    activeSalesSourceLabel: string;
    tables: string[];
    dateField: string;
    sourcePreference: string;
    suppressionNote: string;
    includedStatuses: string[];
    excludedWhenMonthlySummaryExists: number;
  };
  answerChecklist: Array<{ question: string; answer: string }>;
  sourceSummaries: SourceSummary[];
  sourceDifference: Array<{ label: string; amount: number; notes: string }>;
  importRuns: Array<{
    id: string;
    reportType: string;
    originalFileName: string;
    status: string;
    rowCount: number;
    validCount: number;
    importedCount: number;
    rejectedCount: number;
    createdAt: string;
    importedAt: string | null;
    summary: unknown;
  }>;
  skippedRows: {
    itemSales: IssueSummary[];
    orderReports: IssueSummary[];
    salesUpload: IssueSummary[];
    silentOrderReportSkips: Array<{
      reportType: string;
      originalFileName: string;
      rowCount: number;
      validCount: number;
      rejectedCount: number;
      omittedBeforeValidation: number;
    }>;
  };
  duplicateHandling: {
    duplicateImportRuns: number;
    duplicateIssueCount: number;
    duplicateIssueSummaries: IssueSummary[];
  };
  breakdown: {
    missingSkus: SkuGap[];
    cancelledSales: number;
    refundSales: number;
    orderReportRefunds: number;
    wfsVsSellerFulfilled: SourceSummary[];
    dateMismatch: {
      outsideMonthRows: number;
      outsideMonthGmv: number;
      notes: string;
    };
    calculationFormula: Array<{ label: string; amount: number }>;
  };
};

type SalesItemForReconciliation = {
  id: string;
  marketplace: string;
  sellerSku: string;
  parentSku: string | null;
  quantity: number;
  itemRevenue: unknown;
  shippingRevenue: unknown;
  discountAmount: unknown;
  taxCollected: unknown;
  listing: {
    fulfillmentChannel: string | null;
  } | null;
  order: {
    id: string;
    importId: string | null;
    marketplace: string;
    externalOrderId: string;
    orderDate: Date;
    status: string | null;
    salesImport: {
      id: string;
      source: string;
      originalFileName: string;
      status: string;
      rowCount: number;
      importedCount: number;
      rejectedCount: number;
      createdAt: Date;
    } | null;
  };
  fees: Array<{
    metadata: unknown;
  }>;
  refunds: Array<{
    refundAmount: unknown;
  }>;
};

export async function getJanuaryGmvReconciliation({
  reportMonth = DEFAULT_REPORT_MONTH,
  marketplace = DEFAULT_MARKETPLACE,
  sellerCenterGmv = DEFAULT_SELLER_CENTER_GMV
}: {
  reportMonth?: string;
  marketplace?: string;
  sellerCenterGmv?: number;
} = {}): Promise<JanuaryGmvReconciliationReport> {
  const organizationId = await getCurrentOrganizationId();
  const { start, end } = getMonthRange(reportMonth);
  const monthKey = `${marketplace}:${reportMonth}`;

  const [items, importRuns, importIssues, salesImportIssues, duplicateRuns] =
    await Promise.all([
      prisma.salesOrderItem.findMany({
        where: {
          organizationId,
          marketplace,
          order: {
            is: {
              orderDate: {
                gte: start,
                lte: end
              },
              OR: [
                { importId: null },
                { salesImport: { is: { status: { in: ["IMPORTED", "NEEDS_REVIEW"] } } } }
              ]
            }
          }
        },
        include: {
          listing: {
            select: {
              fulfillmentChannel: true
            }
          },
          order: {
            select: {
              id: true,
              importId: true,
              marketplace: true,
              externalOrderId: true,
              orderDate: true,
              status: true,
              salesImport: {
                select: {
                  id: true,
                  source: true,
                  originalFileName: true,
                  status: true,
                  rowCount: true,
                  importedCount: true,
                  rejectedCount: true,
                  createdAt: true
                }
              }
            }
          },
          fees: {
            select: {
              metadata: true
            }
          },
          refunds: {
            select: {
              refundAmount: true
            }
          }
        }
      }),
      prisma.importRun.findMany({
        where: {
          organizationId,
          marketplace,
          importKind: "sales",
          OR: [
            {
              reportType: {
                in: ["walmart_item_sales", "walmart_purchase_order"]
              }
            },
            { createdAt: { gte: start, lte: end } }
          ]
        },
        orderBy: [{ createdAt: "desc" }]
      }),
      prisma.importRunIssue.findMany({
        where: {
          organizationId,
          importRun: {
            marketplace,
            importKind: "sales",
            reportType: { in: ["walmart_item_sales", "walmart_purchase_order"] }
          }
        },
        include: {
          importRun: {
            select: {
              reportType: true,
              originalFileName: true,
              options: true,
              summary: true
            }
          }
        }
      }),
      prisma.salesImportIssue.findMany({
        where: {
          organizationId,
          import: {
            marketplace,
            createdAt: {
              gte: start,
              lte: end
            }
          }
        },
        include: {
          import: {
            select: {
              source: true,
              originalFileName: true
            }
          }
        }
      }),
      prisma.importRun.count({
        where: {
          organizationId,
          marketplace,
          importKind: "sales",
          duplicateOfId: { not: null }
        }
      })
    ]);

  const normalizedItems = items as SalesItemForReconciliation[];
  const dashboardItems = preferAggregateSummaryItems(normalizedItems);
  const excludedDetailedItems = normalizedItems.filter(
    (item) => !dashboardItems.some((included) => included.id === item.id)
  );
  const sourceSummaries = buildSourceSummaries({
    items: normalizedItems,
    dashboardItems
  });
  const dashboardSummary = summarizeItems(
    "dashboard",
    "Dashboard-included P&L rows",
    dashboardItems
  );
  const dashboardGmv = dashboardSummary.gmv;
  const itemSalesSummary = sourceSummaries.find((summary) => summary.key === "itemSales");
  const poSummary = sourceSummaries.find((summary) => summary.key === "poOrder");
  const wfsSummary = sourceSummaries.find((summary) => summary.key === "wfsOrder");
  const sellerFulfilledSummary = sourceSummaries.find(
    (summary) => summary.key === "sellerFulfilledOrder"
  );
  const orderReportRefunds = normalizedItems.reduce(
    (sum, item) =>
      sum +
      item.refunds.reduce((refundSum, refund) => refundSum + toNumber(refund.refundAmount), 0),
    0
  );
  const itemSalesMetadata = readItemSalesMetadata(normalizedItems);
  const cancelledSales = itemSalesMetadata.cancelledSales;
  const refundSales = itemSalesMetadata.refundSales;
  const duplicateIssueSummaries = summarizeIssues(
    importIssues.filter((issue) => issue.code.toLowerCase().includes("duplicate"))
  );
  const relevantImportRuns = importRuns.filter((run) =>
    isImportRunRelevantToMonth(run.options, run.summary, reportMonth)
  );
  const silentOrderReportSkips = relevantImportRuns
    .filter((run) => run.reportType === "walmart_purchase_order")
    .map((run) => ({
      reportType: run.reportType,
      originalFileName: run.originalFileName,
      rowCount: run.rowCount,
      validCount: run.validCount,
      rejectedCount: run.rejectedCount,
      omittedBeforeValidation: Math.max(0, run.rowCount - run.validCount - run.rejectedCount)
    }))
    .filter((run) => run.omittedBeforeValidation > 0);

  return {
    generatedAt: new Date().toISOString(),
    marketplace,
    reportMonth,
    sellerCenterGmv,
    dashboardGmv,
    difference: roundMoney(sellerCenterGmv - dashboardGmv),
    dashboardFormula:
      "sum(SalesOrderItem.itemRevenue + SalesOrderItem.shippingRevenue - SalesOrderItem.discountAmount) after monthly_summary source preference",
    dashboardSource: {
      activeSalesSourceLabel: getActiveSalesSourceLabel(dashboardItems),
      tables: ["SalesOrder", "SalesOrderItem", "SalesImport", "MarketplaceFee"],
      dateField: "SalesOrder.orderDate",
      sourcePreference:
        "If Walmart Item Sales monthly summary rows exist for a marketplace/month, dashboard GMV uses those summary rows for that month.",
      suppressionNote:
        "When Walmart Item Sales monthly summary is uploaded for a month, dashboard GMV uses that summary because it matches Seller Center. PO/order files remain available for order-level audit and are not mixed into that month-level dashboard total.",
      includedStatuses: [
        "SalesImport.status = IMPORTED",
        "SalesImport.status = NEEDS_REVIEW",
        "SalesOrder.importId = null"
      ],
      excludedWhenMonthlySummaryExists: excludedDetailedItems.length
    },
    answerChecklist: buildAnswerChecklist({
      reportMonth,
      dashboardGmv,
      itemSalesSummary,
      poSummary,
      wfsSummary,
      sellerFulfilledSummary,
      cancelledSales,
      refundSales,
      orderReportRefunds,
      excludedDetailedItems
    }),
    sourceSummaries: [dashboardSummary, ...sourceSummaries],
    sourceDifference: buildSourceDifferences({
      sellerCenterGmv,
      dashboardGmv,
      itemSalesSummary,
      poSummary,
      wfsSummary,
      sellerFulfilledSummary
    }),
    importRuns: relevantImportRuns.map((run) => ({
      id: run.id,
      reportType: run.reportType,
      originalFileName: run.originalFileName,
      status: run.status,
      rowCount: run.rowCount,
      validCount: run.validCount,
      importedCount: run.importedCount,
      rejectedCount: run.rejectedCount,
      createdAt: run.createdAt.toISOString(),
      importedAt: run.importedAt?.toISOString() ?? null,
      summary: run.summary
    })),
    skippedRows: {
      itemSales: summarizeIssues(
        importIssues.filter(
          (issue) =>
            issue.importRun.reportType === "walmart_item_sales" &&
            isImportRunRelevantToMonth(
              issue.importRun.options,
              issue.importRun.summary,
              reportMonth
            )
        )
      ),
      orderReports: summarizeIssues(
        importIssues.filter((issue) => issue.importRun.reportType === "walmart_purchase_order")
      ),
      salesUpload: summarizeIssues(salesImportIssues),
      silentOrderReportSkips
    },
    duplicateHandling: {
      duplicateImportRuns: duplicateRuns,
      duplicateIssueCount: duplicateIssueSummaries.reduce((sum, issue) => sum + issue.count, 0),
      duplicateIssueSummaries
    },
    breakdown: {
      missingSkus: buildSkuGaps({ items: normalizedItems, dashboardItems }),
      cancelledSales,
      refundSales,
      orderReportRefunds,
      wfsVsSellerFulfilled: [
        wfsSummary,
        sellerFulfilledSummary,
        sourceSummaries.find((summary) => summary.key === "unknownOrder")
      ].filter((summary): summary is SourceSummary => Boolean(summary)),
      dateMismatch: {
        outsideMonthRows: silentOrderReportSkips.reduce(
          (sum, run) => sum + run.omittedBeforeValidation,
          0
        ),
        outsideMonthGmv: 0,
        notes:
          "Dashboard January filtering uses SalesOrder.orderDate >= month start and <= month end. The Walmart order parser also skips canceled rows and rows outside the selected report month before validation; current import history stores the omitted count but not the skipped row values."
      },
      calculationFormula: [
        {
          label: "Item revenue",
          amount: roundMoney(sumItems(dashboardItems, (item) => toNumber(item.itemRevenue)))
        },
        {
          label: "Shipping revenue",
          amount: roundMoney(sumItems(dashboardItems, (item) => toNumber(item.shippingRevenue)))
        },
        {
          label: "Discounts subtracted",
          amount: roundMoney(sumItems(dashboardItems, (item) => toNumber(item.discountAmount)))
        },
        { label: "Dashboard GMV", amount: dashboardGmv }
      ]
    }
  };
}

function getActiveSalesSourceLabel(items: SalesItemForReconciliation[]) {
  const hasItemSales = items.some(isItemSalesItem);
  const hasPoDetail = items.some((item) => !isItemSalesItem(item));

  if (hasItemSales && !hasPoDetail) {
    return "Sales source: Walmart Item Sales monthly summary";
  }

  if (!hasItemSales && hasPoDetail) {
    return "Sales source: PO/order detail";
  }

  if (hasItemSales && hasPoDetail) {
    return "Sales source: Mixed monthly summary and PO/order detail";
  }

  return "Sales source: No sales rows";
}

function getMonthRange(reportMonth: string) {
  const [yearText, monthText] = reportMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Report month must be formatted as YYYY-MM.");
  }

  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
  };
}

function preferAggregateSummaryItems(items: SalesItemForReconciliation[]) {
  const summaryMonthKeys = new Set(
    items.filter(isAggregateSummaryItem).map((item) => getItemMonthKey(item))
  );

  if (!summaryMonthKeys.size) {
    return items;
  }

  return items.filter((item) => {
    if (isAggregateSummaryItem(item)) {
      return true;
    }

    return !summaryMonthKeys.has(getItemMonthKey(item));
  });
}

function isAggregateSummaryItem(item: SalesItemForReconciliation) {
  return item.order.status?.toLowerCase() === "monthly_summary";
}

function getItemMonthKey(item: SalesItemForReconciliation) {
  const month = String(item.order.orderDate.getUTCMonth() + 1).padStart(2, "0");
  return `${item.marketplace}:${item.order.orderDate.getUTCFullYear()}-${month}`;
}

function buildSourceSummaries({
  items,
  dashboardItems
}: {
  items: SalesItemForReconciliation[];
  dashboardItems: SalesItemForReconciliation[];
}) {
  const dashboardIds = new Set(dashboardItems.map((item) => item.id));
  const itemSalesItems = items.filter(isItemSalesItem);
  const orderItems = items.filter((item) => !isItemSalesItem(item));
  const wfsItems = orderItems.filter((item) => classifyFulfillment(item) === "wfs");
  const sellerFulfilledItems = orderItems.filter(
    (item) => classifyFulfillment(item) === "seller_fulfilled"
  );
  const unknownItems = orderItems.filter((item) => classifyFulfillment(item) === "unknown");
  return [
    summarizeItems("itemSales", "Item Sales Report GMV", itemSalesItems, dashboardIds),
    summarizeItems("poOrder", "PO/order report GMV", orderItems, dashboardIds),
    summarizeItems("wfsOrder", "WFS order report GMV", wfsItems, dashboardIds),
    summarizeItems(
      "sellerFulfilledOrder",
      "Seller-fulfilled order report GMV",
      sellerFulfilledItems,
      dashboardIds
    ),
    summarizeItems(
      "unknownOrder",
      "Unknown fulfillment order report GMV",
      unknownItems,
      dashboardIds
    )
  ];
}

function summarizeItems(
  key: SourceSummary["key"],
  label: string,
  items: SalesItemForReconciliation[],
  dashboardIds?: Set<string>
): SourceSummary {
  const orderIds = new Set(items.map((item) => item.order.externalOrderId));
  const includedRows = dashboardIds
    ? items.filter((item) => dashboardIds.has(item.id)).length
    : items.length;

  return {
    key,
    label,
    gmv: roundMoney(sumItems(items, getDashboardLineGmv)),
    rows: items.length,
    orders: getImportedOrderCount(items) || orderIds.size,
    units: items.reduce((sum, item) => sum + item.quantity, 0),
    refunds: roundMoney(
      items.reduce(
        (sum, item) =>
          sum +
          item.refunds.reduce((refundSum, refund) => refundSum + toNumber(refund.refundAmount), 0),
        0
      )
    ),
    cancelledSales: roundMoney(readItemSalesMetadata(items).cancelledSales),
    includedInDashboard: !dashboardIds || includedRows > 0,
    notes: dashboardIds
      ? `${includedRows} of ${items.length} rows are included after dashboard source preference.`
      : "This is the exact row set used by the dashboard formula."
  };
}

function getDashboardLineGmv(item: SalesItemForReconciliation) {
  return (
    toNumber(item.itemRevenue) + toNumber(item.shippingRevenue) - toNumber(item.discountAmount)
  );
}

function isItemSalesItem(item: SalesItemForReconciliation) {
  return (
    item.order.status?.toLowerCase() === "monthly_summary" ||
    item.order.salesImport?.source === "walmart_item_sales_import" ||
    item.order.externalOrderId.startsWith("walmart-item-sales:")
  );
}

function classifyFulfillment(item: SalesItemForReconciliation) {
  const value = item.listing?.fulfillmentChannel?.toLowerCase() ?? "";

  if (value.includes("wfs") || value.includes("walmart fulfilled")) {
    return "wfs";
  }

  if (value.includes("seller") || value.includes("sfp") || value.includes("fulfilled by seller")) {
    return "seller_fulfilled";
  }

  return "unknown";
}

function getImportedOrderCount(items: SalesItemForReconciliation[]) {
  return items.reduce((sum, item) => {
    for (const fee of item.fees) {
      const metadata = toRecord(fee.metadata);
      const orders = metadata?.orders;

      if (typeof orders === "number" && Number.isFinite(orders)) {
        return sum + orders;
      }

      if (typeof orders === "string") {
        const parsed = Number(orders);
        if (Number.isFinite(parsed)) {
          return sum + parsed;
        }
      }
    }

    return sum;
  }, 0);
}

function readItemSalesMetadata(items: SalesItemForReconciliation[]) {
  let cancelledSales = 0;
  let refundSales = 0;

  for (const item of items) {
    for (const fee of item.fees) {
      const metadata = toRecord(fee.metadata);

      if (metadata?.reportType !== "walmart_item_sales") {
        continue;
      }

      cancelledSales += toNumber(metadata.cancelledSales);
      refundSales += toNumber(metadata.refundSales);
    }
  }

  return {
    cancelledSales: roundMoney(cancelledSales),
    refundSales: roundMoney(refundSales)
  };
}

function buildAnswerChecklist({
  reportMonth,
  dashboardGmv,
  itemSalesSummary,
  poSummary,
  wfsSummary,
  sellerFulfilledSummary,
  cancelledSales,
  refundSales,
  orderReportRefunds,
  excludedDetailedItems
}: {
  reportMonth: string;
  dashboardGmv: number;
  itemSalesSummary?: SourceSummary;
  poSummary?: SourceSummary;
  wfsSummary?: SourceSummary;
  sellerFulfilledSummary?: SourceSummary;
  cancelledSales: number;
  refundSales: number;
  orderReportRefunds: number;
  excludedDetailedItems: SalesItemForReconciliation[];
}) {
  return [
    {
      question: "Which table/source is the dashboard GMV using?",
      answer: `SalesOrderItem joined to SalesOrder. For ${reportMonth}, dashboard GMV currently calculates to ${formatMoney(dashboardGmv)} from dashboard-included rows.`
    },
    {
      question: "Is it using Item Sales Report, PO/order data, or WFS order data?",
      answer: `It includes Item Sales rows when monthly_summary rows exist. Detailed PO/WFS/seller-fulfilled rows for the same marketplace/month are excluded by source preference. Item Sales: ${formatMoney(itemSalesSummary?.gmv ?? 0)}; PO/order: ${formatMoney(poSummary?.gmv ?? 0)}; WFS: ${formatMoney(wfsSummary?.gmv ?? 0)}; Seller fulfilled: ${formatMoney(sellerFulfilledSummary?.gmv ?? 0)}.`
    },
    {
      question: "What date field is used for January filtering?",
      answer:
        "SalesOrder.orderDate. Item Sales monthly summary rows use the last day of the report month."
    },
    {
      question:
        "Is GMV calculated from item price x quantity, imported GMV, auth sales, or another field?",
      answer:
        "Dashboard GMV is itemRevenue + shippingRevenue - discountAmount. Item Sales commits imported GMV into itemRevenue. PO/order imports use line total, or unit price x quantity when line total is unavailable."
    },
    {
      question: "Are cancelled sales included or excluded?",
      answer: `Item Sales cancelled sales are stored as metadata and are not subtracted by the dashboard formula. Stored cancelled sales found: ${formatMoney(cancelledSales)}.`
    },
    {
      question: "Are refund sales included or excluded?",
      answer: `Item Sales refund sales are stored as metadata and are not subtracted by the dashboard formula. Stored refund sales found: ${formatMoney(refundSales)}. Order-report refund rows are stored separately and not subtracted from dashboard GMV. Order-report refunds found: ${formatMoney(orderReportRefunds)}.`
    },
    {
      question: "Are WFS and seller-fulfilled orders both included?",
      answer: `They are imported into order rows, but if Item Sales monthly summaries exist for the month, ${excludedDetailedItems.length} detailed order rows are excluded from dashboard GMV to avoid double counting.`
    }
  ];
}

function buildSourceDifferences({
  sellerCenterGmv,
  dashboardGmv,
  itemSalesSummary,
  poSummary,
  wfsSummary,
  sellerFulfilledSummary
}: {
  sellerCenterGmv: number;
  dashboardGmv: number;
  itemSalesSummary?: SourceSummary;
  poSummary?: SourceSummary;
  wfsSummary?: SourceSummary;
  sellerFulfilledSummary?: SourceSummary;
}) {
  return [
    {
      label: "Seller Center GMV - Dashboard GMV",
      amount: roundMoney(sellerCenterGmv - dashboardGmv),
      notes: "Primary mismatch requested."
    },
    {
      label: "Seller Center GMV - Item Sales Report GMV",
      amount: roundMoney(sellerCenterGmv - (itemSalesSummary?.gmv ?? 0)),
      notes: "Shows whether the committed Item Sales rows match Seller Center."
    },
    {
      label: "PO/order report GMV - Dashboard GMV",
      amount: roundMoney((poSummary?.gmv ?? 0) - dashboardGmv),
      notes: "Detailed order rows are excluded when monthly summaries exist."
    },
    {
      label: "WFS + seller fulfilled order GMV",
      amount: roundMoney((wfsSummary?.gmv ?? 0) + (sellerFulfilledSummary?.gmv ?? 0)),
      notes: "Uses fulfillment channel where available."
    }
  ];
}

function summarizeIssues(
  issues: Array<{ code: string; severity: string; message: string; rawData?: unknown }>
): IssueSummary[] {
  const groups = new Map<string, IssueSummary>();

  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    const existing = groups.get(key) ?? {
      code: issue.code,
      severity: issue.severity,
      count: 0,
      gmvTotal: 0,
      unitsTotal: 0,
      sampleMessages: []
    };
    existing.count += 1;
    existing.gmvTotal = roundMoney(existing.gmvTotal + readRawNumber(issue.rawData, ["gmv"]));
    existing.unitsTotal += readRawNumber(issue.rawData, ["units sold", "units_sold", "units"]);

    if (existing.sampleMessages.length < 3 && !existing.sampleMessages.includes(issue.message)) {
      existing.sampleMessages.push(issue.message);
    }

    groups.set(key, existing);
  }

  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

function readRawNumber(rawData: unknown, aliases: string[]) {
  const record = toRecord(rawData);

  if (!record) {
    return 0;
  }

  const normalizedAliases = new Set(aliases.map(normalizeKey));
  const matchingEntry = Object.entries(record).find(([key]) =>
    normalizedAliases.has(normalizeKey(key))
  );

  if (!matchingEntry) {
    return 0;
  }

  return toNumber(matchingEntry[1]);
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function buildSkuGaps({
  items,
  dashboardItems
}: {
  items: SalesItemForReconciliation[];
  dashboardItems: SalesItemForReconciliation[];
}) {
  const bySku = new Map<string, SkuGap>();
  const dashboardIds = new Set(dashboardItems.map((item) => item.id));

  for (const item of items) {
    const existing = bySku.get(item.sellerSku) ?? {
      sku: item.sellerSku,
      itemSalesGmv: 0,
      orderReportGmv: 0,
      dashboardGmv: 0,
      differenceFromDashboard: 0
    };
    const gmv = getDashboardLineGmv(item);

    if (isItemSalesItem(item)) {
      existing.itemSalesGmv += gmv;
    } else {
      existing.orderReportGmv += gmv;
    }

    if (dashboardIds.has(item.id)) {
      existing.dashboardGmv += gmv;
    }

    existing.differenceFromDashboard =
      existing.itemSalesGmv + existing.orderReportGmv - existing.dashboardGmv;
    bySku.set(item.sellerSku, existing);
  }

  return Array.from(bySku.values())
    .map((row) => ({
      ...row,
      itemSalesGmv: roundMoney(row.itemSalesGmv),
      orderReportGmv: roundMoney(row.orderReportGmv),
      dashboardGmv: roundMoney(row.dashboardGmv),
      differenceFromDashboard: roundMoney(row.differenceFromDashboard)
    }))
    .filter((row) => row.differenceFromDashboard !== 0 || row.dashboardGmv === 0)
    .sort((a, b) => Math.abs(b.differenceFromDashboard) - Math.abs(a.differenceFromDashboard))
    .slice(0, 50);
}

function isImportRunRelevantToMonth(options: unknown, summary: unknown, reportMonth: string) {
  const optionRecord = toRecord(options);
  const summaryRecord = toRecord(summary);
  const months = [
    optionRecord?.reportMonth,
    summaryRecord?.reportMonth,
    summaryRecord?.month,
    summaryRecord?.report_month
  ].filter(Boolean);

  if (!months.length) {
    return true;
  }

  return months.some((month) => String(month).startsWith(reportMonth));
}

function sumItems(
  items: SalesItemForReconciliation[],
  getValue: (item: SalesItemForReconciliation) => number
) {
  return items.reduce((sum, item) => sum + getValue(item), 0);
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}
