import assert from "node:assert/strict";
import { calculateDailyPnl } from "../src/server/pnl/daily-service.ts";

const tests = [
  {
    name: "uses daily Item Sales for a one-day range and excludes PO/order rows",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-05", "2026-01-05")),
        lines: [
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-05T00:00:00.000Z", 100, 2),
          orderLine("SKU-1", "PARENT-1", "2026-01-05T00:00:00.000Z", 999, 99)
        ]
      });

      assert.equal(result.summary.netRevenue, 100);
      assert.equal(result.summary.quantity, 2);
      assert.equal(result.sourceMetadata.monthlySummaryRowsIgnored, 1);
      assert.equal(result.salesSource.kind, "item_sales_daily_summary");
    }
  },
  {
    name: "uses inclusive start and end dates for a seven-day range",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-01", "2026-01-07")),
        lines: [
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-01T00:00:00.000Z", 100, 1),
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-07T23:59:59.999Z", 200, 2),
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-08T00:00:00.000Z", 300, 3)
        ]
      });

      assert.equal(result.summary.netRevenue, 300);
      assert.equal(result.summary.quantity, 3);
    }
  },
  {
    name: "handles a partial-month custom range",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("parentSku", range("2026-01-10", "2026-01-20")),
        lines: [
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-09T12:00:00.000Z", 50, 1),
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-10T12:00:00.000Z", 100, 1),
          itemSalesLine("SKU-2", "PARENT-1", "2026-01-20T12:00:00.000Z", 150, 1)
        ]
      });

      assert.equal(result.summary.netRevenue, 250);
      assert.equal(result.rows[0].parentSku, "PARENT-1");
    }
  },
  {
    name: "keeps order-at-midnight on the selected calendar day",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-02", "2026-01-02")),
        lines: [itemSalesLine("SKU-1", "PARENT-1", "2026-01-02T00:00:00.000Z", 75, 1)]
      });

      assert.equal(result.summary.netRevenue, 75);
    }
  },
  {
    name: "does not shift UTC boundary dates into adjacent selected days",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-01", "2026-01-01")),
        lines: [
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-01T23:59:59.999Z", 25, 1),
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-02T00:00:00.000Z", 50, 1)
        ]
      });

      assert.equal(result.summary.netRevenue, 25);
    }
  },
  {
    name: "allocates commission, fulfillment, and SEM by settlement overlap",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-05", "2026-01-07")),
        lines: [itemSalesLine("SKU-1", "PARENT-1", "2026-01-05T12:00:00.000Z", 300, 3)],
        feeAdjustments: [
          settlementFee("commission", -1400, "2026-01-01", "2026-01-14"),
          settlementFee("fulfillment_fee", -280, "2026-01-01", "2026-01-14")
        ],
        advertisingCosts: [
          settlementSem(-140, "2026-01-01", "2026-01-14")
        ]
      });

      assert.equal(result.summary.commissionFees, 300);
      assert.equal(result.summary.fulfillmentFees, 60);
      assert.equal(result.summary.semAdvertisingCost, 30);
      assert.equal(result.diagnostic.commission.details[0].overlapDays, 3);
    }
  },
  {
    name: "allocates settlement rows crossing two months",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-02-01", "2026-02-07")),
        feeAdjustments: [settlementFee("commission", -1400, "2026-01-25", "2026-02-07")]
      });

      assert.equal(result.summary.commissionFees, 700);
    }
  },
  {
    name: "uses only daily Walmart Connect rows and flags monthly rows",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-05", "2026-01-05")),
        advertisingCosts: [
          connectAd("SKU-1", "PARENT-1", "2026-01-05T00:00:00.000Z", 10, { grain: "daily" }),
          connectAd("SKU-1", "PARENT-1", "2026-01-01T00:00:00.000Z", 100, { reportMonth: "2026-01" }),
          connectAd("SKU-1", "PARENT-1", "2026-01-05T00:00:00.000Z", 50, {})
        ]
      });

      assert.equal(result.summary.walmartConnectAdvertisingCost, 10);
      assert.equal(result.sourceMetadata.monthlyWalmartConnectRowsIgnored, 2);
      assert.ok(result.missingDataSources.includes("Missing daily ads"));
    }
  },
  {
    name: "uses posting-date fallback when settlement period dates are missing",
    run() {
      const result = calculateDailyPnl({
        ...baseInput("sellerSku", range("2026-01-05", "2026-01-05")),
        feeAdjustments: [
          {
            marketplace: "walmart",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            feeType: "fulfillment_fee",
            amount: -12,
            postedAt: new Date("2026-01-05T12:00:00.000Z"),
            metadata: { source: "walmart_payments_new" }
          }
        ]
      });

      assert.equal(result.summary.fulfillmentFees, 12);
      assert.ok(result.missingDataSources.includes("Settlement dates incomplete"));
    }
  },
  {
    name: "parent and SKU rollups reconcile to the same total profit",
    run() {
      const input = {
        ...baseInput("sellerSku", range("2026-01-01", "2026-01-07")),
        lines: [
          itemSalesLine("SKU-1", "PARENT-1", "2026-01-02T12:00:00.000Z", 100, 1, 20),
          itemSalesLine("SKU-2", "PARENT-1", "2026-01-03T12:00:00.000Z", 200, 2, 40)
        ],
        feeAdjustments: [settlementFee("commission", -70, "2026-01-01", "2026-01-07")]
      };
      const sku = calculateDailyPnl(input);
      const parent = calculateDailyPnl({ ...input, groupBy: "parentSku" });

      assert.equal(parent.summary.netProfit, sku.summary.netProfit);
      assert.equal(parent.summary.commissionFees, sku.summary.commissionFees);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function baseInput(groupBy, dateRange) {
  return {
    organizationId: "org_1",
    marketplace: "walmart",
    dateRange,
    groupBy,
    lines: [],
    advertisingCosts: [],
    feeAdjustments: [],
    refundAdjustments: []
  };
}

function range(from, to) {
  return {
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T23:59:59.999Z`)
  };
}

function orderLine(sellerSku, parentSku, orderDate, itemRevenue, quantity, cogsTotal = 0) {
  return {
    marketplace: "walmart",
    salesSource: "po_order_detail",
    sellerSku,
    parentSku,
    orderId: `${sellerSku}-${orderDate}`,
    orderDate: new Date(orderDate),
    quantity,
    itemRevenue,
    cogsTotal,
    missingCogs: cogsTotal === 0
  };
}

function itemSalesLine(sellerSku, parentSku, orderDate, itemRevenue, quantity, cogsTotal = 0) {
  return {
    ...orderLine(sellerSku, parentSku, orderDate, itemRevenue, quantity, cogsTotal),
    salesSource: "item_sales_daily_summary"
  };
}

function settlementFee(feeType, amount, start, end) {
  return {
    marketplace: "walmart",
    sellerSku: "SKU-1",
    parentSku: "PARENT-1",
    feeType,
    amount,
    postedAt: new Date(`${end}T12:00:00.000Z`),
    metadata: {
      source: "walmart_payments_new",
      periodStartDate: start,
      periodEndDate: end,
      originalAmount: amount
    }
  };
}

function settlementSem(amount, start, end) {
  return {
    marketplace: "walmart",
    sellerSku: "SKU-1",
    parentSku: "PARENT-1",
    source: "walmart_seller_center_sem",
    amount: Math.abs(amount),
    costDate: new Date(`${end}T12:00:00.000Z`),
    metadata: {
      source: "walmart_payments_new",
      periodStartDate: start,
      periodEndDate: end,
      originalAmount: amount
    }
  };
}

function connectAd(sellerSku, parentSku, costDate, amount, metadata) {
  return {
    marketplace: "walmart",
    sellerSku,
    parentSku,
    source: "walmart_connect_item_performance",
    amount,
    costDate: new Date(costDate),
    metadata
  };
}
