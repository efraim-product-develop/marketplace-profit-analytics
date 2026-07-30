import assert from "node:assert/strict";
import { selectDashboardProfitLines } from "../src/server/pnl/source-selection.ts";

const tests = [
  {
    name: "uses daily Item Sales for a full calendar month and suppresses PO detail",
    run() {
      const selection = selectDashboardProfitLines(
        [
          dailyItemSalesLine("SKU-1", "2026-01-10", 400),
          dailyItemSalesLine("SKU-1", "2026-01-20", 600),
          detailLine("SKU-1", "2026-01-10", 400),
          detailLine("SKU-1", "2026-01-20", 600)
        ],
        range("2026-01-01", "2026-01-31")
      );

      assert.equal(selection.lines.length, 2);
      assert.equal(selection.lines.every((line) => line.salesSource === "item_sales_daily_summary"), true);
      assert.equal(selection.lines.reduce((sum, line) => sum + line.itemRevenue, 0), 1000);
      assert.equal(selection.suppressedDetailLines.length, 2);
    }
  },
  {
    name: "uses daily Item Sales for a partial range",
    run() {
      const selection = selectDashboardProfitLines(
        [
          dailyItemSalesLine("SKU-1", "2026-01-20", 300),
          dailyItemSalesLine("SKU-1", "2026-01-30", 200),
          detailLine("SKU-1", "2026-01-20", 300),
          detailLine("SKU-1", "2026-01-30", 200)
        ],
        range("2026-01-18", "2026-01-31")
      );

      assert.equal(selection.lines.length, 2);
      assert.equal(selection.lines.every((line) => line.salesSource === "item_sales_daily_summary"), true);
      assert.equal(selection.lines.reduce((sum, line) => sum + line.itemRevenue, 0), 500);
      assert.equal(selection.suppressedDetailLines.length, 2);
    }
  },
  {
    name: "uses only daily Item Sales in a mixed custom range",
    run() {
      const selection = selectDashboardProfitLines(
        [
          dailyItemSalesLine("JAN-SKU", "2026-01-10", 1000),
          detailLine("JAN-SKU", "2026-01-10", 1000),
          dailyItemSalesLine("FEB-SKU", "2026-02-10", 800),
          detailLine("FEB-SKU", "2026-02-10", 800)
        ],
        range("2026-01-01", "2026-02-15")
      );

      assert.equal(selection.lines.length, 2);
      assert.equal(selection.lines.every((line) => line.salesSource === "item_sales_daily_summary"), true);
      assert.equal(selection.lines.reduce((sum, line) => sum + line.itemRevenue, 0), 1800);
      assert.equal(selection.suppressedDetailLines.length, 2);
    }
  },
  {
    name: "drops PO detail when no daily Item Sales exists",
    run() {
      const selection = selectDashboardProfitLines(
        [detailLine("SKU-1", "2026-01-31", 1000)],
        range("2026-01-31", "2026-01-31")
      );

      assert.equal(selection.lines.length, 0);
      assert.equal(selection.suppressedDetailLines.length, 1);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function dailyItemSalesLine(sellerSku, orderDate, itemRevenue) {
  return line({
    sellerSku,
    orderDate,
    itemRevenue,
    salesSource: "item_sales_daily_summary"
  });
}

function detailLine(sellerSku, orderDate, itemRevenue) {
  return line({
    sellerSku,
    orderDate,
    itemRevenue,
    salesSource: "po_order_detail"
  });
}

function line(overrides) {
  return {
    marketplace: "walmart",
    orderId: `${overrides.salesSource}:${overrides.sellerSku}:${overrides.orderDate}`,
    salesSource: overrides.salesSource,
    sellerSku: overrides.sellerSku,
    parentSku: "PARENT-1",
    orderDate: new Date(`${overrides.orderDate}T12:00:00.000Z`),
    quantity: 1,
    itemRevenue: overrides.itemRevenue,
    shippingRevenue: 0,
    taxCollected: 0,
    discountAmount: 0,
    cogsTotal: 0,
    missingCogs: false,
    fees: [],
    refunds: []
  };
}

function range(from, to) {
  return {
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T23:59:59.999Z`)
  };
}
