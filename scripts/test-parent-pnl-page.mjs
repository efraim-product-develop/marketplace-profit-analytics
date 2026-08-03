import assert from "node:assert/strict";
import {
  buildParentPnlCsv,
  buildParentPnlQueryString,
  getParentPnlReconciliationLabel,
  getParentPnlSourceLabel,
  parseParentPnlSearchParams
} from "../src/server/pnl/parent-page.ts";
import { resolveAdvertisingCostParentSku } from "../src/server/pnl/advertising-parent-resolution.ts";
import { reconcileParentAdvertisingFromSkuRows } from "../src/server/pnl/parent-advertising-rollup.ts";
import { buildPnlPeriodRanges } from "../src/server/pnl/periods.ts";

const referenceDate = new Date("2026-07-09T12:00:00.000Z");

const tests = [
  {
    name: "parses Parent P&L filters from search params",
    run() {
      const parsed = parseParentPnlSearchParams(
        {
          from: "2026-01-01",
          to: "bad-date",
          period: "quarter",
          parent: " PARENT-1 ",
          sku: " SKU-1 "
        },
        referenceDate
      );

      assert.equal(parsed.formValues.from, "2025-10-01");
      assert.equal(parsed.formValues.to, "2026-09-30");
      assert.equal(parsed.formValues.period, "quarter");
      assert.equal(parsed.formValues.parent, "PARENT-1");
      assert.equal(parsed.selectedSku, "SKU-1");
      assert.equal(parsed.filters.dateRange?.from?.toISOString(), "2025-10-01T00:00:00.000Z");
      assert.equal(parsed.filters.dateRange?.to?.toISOString(), "2026-09-30T23:59:59.999Z");
      assert.equal(parsed.filters.parentSku, "PARENT-1");
      assert.equal(parsed.filters.comparisonPeriod, "quarter");
    }
  },
  {
    name: "parses custom Parent P&L date ranges exactly",
    run() {
      const parsed = parseParentPnlSearchParams(
        {
          from: "2026-01-01",
          to: "2026-04-30",
          period: "custom"
        },
        referenceDate
      );

      assert.equal(parsed.formValues.from, "2026-01-01");
      assert.equal(parsed.formValues.to, "2026-04-30");
      assert.equal(parsed.formValues.period, "custom");
      assert.equal(parsed.filters.dateRange?.from?.toISOString(), "2026-01-01T00:00:00.000Z");
      assert.equal(parsed.filters.dateRange?.to?.toISOString(), "2026-04-30T23:59:59.999Z");
    }
  },
  {
    name: "builds day period ranges as current day plus previous 3 days",
    run() {
      const periods = buildPnlPeriodRanges("day", undefined, referenceDate);

      assert.equal(periods.length, 4);
      assert.equal(periods[0].start.toISOString(), "2026-07-09T00:00:00.000Z");
      assert.equal(periods[0].end.toISOString(), "2026-07-09T23:59:59.999Z");
      assert.equal(periods[3].start.toISOString(), "2026-07-06T00:00:00.000Z");
      assert.equal(periods[3].end.toISOString(), "2026-07-06T23:59:59.999Z");
    }
  },
  {
    name: "builds week period ranges as current week plus previous 3 weeks",
    run() {
      const periods = buildPnlPeriodRanges("week", undefined, referenceDate);

      assert.equal(periods.length, 4);
      assert.equal(periods[0].start.toISOString(), "2026-07-06T00:00:00.000Z");
      assert.equal(periods[0].end.toISOString(), "2026-07-12T23:59:59.999Z");
      assert.equal(periods[3].start.toISOString(), "2026-06-15T00:00:00.000Z");
      assert.equal(periods[3].end.toISOString(), "2026-06-21T23:59:59.999Z");
    }
  },
  {
    name: "builds month period ranges as current month plus previous 3 months",
    run() {
      const periods = buildPnlPeriodRanges("month", undefined, referenceDate);

      assert.equal(periods.length, 4);
      assert.equal(periods[0].start.toISOString(), "2026-07-01T00:00:00.000Z");
      assert.equal(periods[0].end.toISOString(), "2026-07-31T23:59:59.999Z");
      assert.equal(periods[3].start.toISOString(), "2026-04-01T00:00:00.000Z");
      assert.equal(periods[3].end.toISOString(), "2026-04-30T23:59:59.999Z");
    }
  },
  {
    name: "builds quarter period ranges as current quarter plus previous 3 quarters",
    run() {
      const periods = buildPnlPeriodRanges("quarter", undefined, referenceDate);

      assert.equal(periods.length, 4);
      assert.equal(periods[0].start.toISOString(), "2026-07-01T00:00:00.000Z");
      assert.equal(periods[0].end.toISOString(), "2026-09-30T23:59:59.999Z");
      assert.equal(periods[3].start.toISOString(), "2025-10-01T00:00:00.000Z");
      assert.equal(periods[3].end.toISOString(), "2025-12-31T23:59:59.999Z");
    }
  },
  {
    name: "builds one custom period range",
    run() {
      const periods = buildPnlPeriodRanges(
        "custom",
        {
          from: new Date("2026-01-01T00:00:00.000Z"),
          to: new Date("2026-04-30T23:59:59.999Z")
        },
        referenceDate
      );

      assert.equal(periods.length, 1);
      assert.equal(periods[0].label, "Custom: Jan 1 - Apr 30, 2026");
      assert.equal(periods[0].start.toISOString(), "2026-01-01T00:00:00.000Z");
      assert.equal(periods[0].end.toISOString(), "2026-04-30T23:59:59.999Z");
    }
  },
  {
    name: "builds compact Parent P&L query strings",
    run() {
      const query = buildParentPnlQueryString(
        {
          from: "2026-01-01",
          to: "",
          period: "month",
          parent: "PARENT 1"
        },
        { sku: "SKU-1" }
      );

      assert.equal(query, "from=2026-01-01&period=month&parent=PARENT+1&sku=SKU-1");
    }
  },
  {
    name: "exports parent rollups, SKU rows, and monthly comparison as CSV",
    run() {
      const csv = buildParentPnlCsv(
        [buildProfitRow({ parentSku: "PARENT-1", sellerSku: undefined })],
        [buildProfitRow({ parentSku: "PARENT-1", sellerSku: "SKU-1" })],
        [
          {
            monthKey: "month:2026-01-01T00:00:00.000Z",
            label: "Jan 2026",
            dateLabel: "Jan 1 - Jan 31, 2026",
            from: "2026-01-01T00:00:00.000Z",
            to: "2026-01-31T23:59:59.999Z",
            salesSource: buildSalesSourceSummary(),
            netRevenue: 100,
            netRevenueChangePercent: null,
            orderCount: 4,
            units: 5,
            refunds: 1,
            salesRefunds: 6,
            marketplaceFees: 2,
            commissionFees: 2,
            fulfillmentFees: 0,
            walmartConnectAdvertisingCost: 1,
            semAdvertisingCost: 2,
            advertisingCost: 3,
            cogs: 40,
            grossProfit: 57,
            netProfit: 54,
            grossMarginPercent: 57,
            netMarginPercent: 54,
            profitPerUnit: 10.8,
            missingCogsUnits: 0
          }
        ]
      );

      assert.match(csv, /Period comparison/);
      assert.match(csv, /Parent rollup/);
      assert.match(csv, /SKU detail/);
      assert.match(csv, /Item Sales/);
    }
  },
  {
    name: "reconciles parent Walmart Connect spend from child SKU rows",
    run() {
      const rows = reconcileParentAdvertisingFromSkuRows(
        [
          buildProfitRow({
            parentSku: "PARENT-1",
            sellerSku: undefined,
            label: "walmart:PARENT-1",
            netRevenue: 100,
            grossProfit: 80,
            advertisingCost: 0,
            walmartConnectAdvertisingCost: 0,
            netProfit: 80,
            contributionProfit: 80,
            marginPercent: 80,
            netMarginPercent: 80,
            profitPerUnit: 16
          })
        ],
        [
          buildProfitRow({
            parentSku: "PARENT-1",
            sellerSku: "SKU-1",
            label: "walmart:SKU-1",
            walmartConnectAdvertisingCost: 12,
            advertisingCost: 12
          })
        ]
      );
      const [row] = rows;

      assert.equal(rows.length, 1);
      assert.equal(row.walmartConnectAdvertisingCost, 12);
      assert.equal(row.advertisingCost, 12);
      assert.equal(row.netProfit, 68);
      assert.equal(row.contributionProfit, 68);
      assert.equal(row.netMarginPercent, 68);
    }
  },
  {
    name: "hides duplicate ad-only parent rows that are actually child SKUs",
    run() {
      const rows = reconcileParentAdvertisingFromSkuRows(
        [
          buildProfitRow({
            parentSku: "PARENT-1",
            sellerSku: undefined,
            label: "walmart:PARENT-1",
            netRevenue: 100,
            grossProfit: 80,
            advertisingCost: 0,
            walmartConnectAdvertisingCost: 0,
            netProfit: 80
          }),
          buildProfitRow({
            parentSku: "CHILD-SKU-1",
            sellerSku: undefined,
            label: "walmart:CHILD-SKU-1",
            quantity: 0,
            grossRevenue: 0,
            netRevenue: 0,
            salesRefunds: 0,
            marketplaceFees: 0,
            cogs: 0,
            semAdvertisingCost: 0,
            advertisingCost: 12,
            walmartConnectAdvertisingCost: 12,
            netProfit: -12
          })
        ],
        [
          buildProfitRow({
            parentSku: "PARENT-1",
            sellerSku: "CHILD-SKU-1",
            label: "walmart:CHILD-SKU-1",
            walmartConnectAdvertisingCost: 12,
            advertisingCost: 12
          })
        ]
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0].parentSku, "PARENT-1");
      assert.equal(rows[0].walmartConnectAdvertisingCost, 12);
    }
  },
  {
    name: "labels source and reconciliation indicators",
    run() {
      assert.equal(getParentPnlSourceLabel("item_sales_daily_summary"), "Item Sales");
      assert.equal(getParentPnlSourceLabel("item_sales_monthly_summary"), "Legacy Item Sales");
      assert.equal(getParentPnlSourceLabel("po_order_detail"), "PO Audit");
      assert.match(
        getParentPnlReconciliationLabel(buildSalesSourceSummary({ kind: "item_sales_daily_summary" })),
        /daily Walmart Item Sales/
      );
      assert.match(
        getParentPnlReconciliationLabel(buildSalesSourceSummary({ kind: "po_order_detail" }), 3),
        /COGS review/
      );
    }
  },
  {
    name: "resolves child SKU Walmart Connect ad spend to parent rollups",
    run() {
      const parentSkuBySellerSku = new Map([["CHILD-SKU-1", "PARENT-SKU-1"]]);

      assert.equal(
        resolveAdvertisingCostParentSku(
          { sellerSku: "CHILD-SKU-1", parentSku: null },
          parentSkuBySellerSku
        ),
        "PARENT-SKU-1"
      );
      assert.equal(
        resolveAdvertisingCostParentSku(
          { sellerSku: "CHILD-SKU-1", parentSku: "EXPLICIT-PARENT" },
          parentSkuBySellerSku
        ),
        "EXPLICIT-PARENT"
      );
      assert.equal(
        resolveAdvertisingCostParentSku(
          { sellerSku: "CHILD-SKU-2", parentSku: null },
          parentSkuBySellerSku,
          "SELECTED-PARENT"
        ),
        "SELECTED-PARENT"
      );
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function buildSalesSourceSummary(overrides = {}) {
  return {
    kind: "item_sales_daily_summary",
    label: "Sales source: Walmart daily Item Sales",
    note: "Daily Item Sales active.",
    summaryMonthCount: 0,
    suppressedDetailRowCount: 0,
    suppressedDetailGmv: 0,
    ...overrides
  };
}

function buildProfitRow(overrides = {}) {
  return {
    marketplace: "walmart",
    parentSku: "PARENT-1",
    sellerSku: "SKU-1",
    salesSource: "item_sales_daily_summary",
    label: "walmart:PARENT-1",
    quantity: 5,
    grossRevenue: 100,
    discounts: 0,
    netRevenue: 100,
    refunds: 1,
    salesRefunds: 6,
    taxCollected: 0,
    marketplaceFees: 2,
    commissionFees: 2,
    fulfillmentFees: 0,
    shippingFees: 0,
    storageFees: 0,
    returnFees: 0,
    adjustmentFees: 0,
    otherFees: 0,
    walmartConnectAdvertisingCost: 1,
    semAdvertisingCost: 2,
    advertisingCost: 3,
    cogs: 40,
    grossProfit: 57,
    grossMarginPercent: 57,
    grossProfitPerUnit: 11.4,
    missingCogsUnits: 0,
    missingCogsLineCount: 0,
    contributionProfit: 54,
    netProfit: 54,
    marginPercent: 54,
    netMarginPercent: 54,
    profitPerUnit: 10.8,
    ...overrides
  };
}
