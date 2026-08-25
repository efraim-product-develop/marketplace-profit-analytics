import assert from "node:assert/strict";
import { selectDashboardProfitLines } from "../src/server/pnl/source-selection.ts";
import {
  calculatePoGrossProductSales,
  getPoSalesSourceFromOrderItem
} from "../src/server/sales/po-sales-source.ts";

const tests = [
  {
    name: "uses PO report rows for a full calendar month and ignores obsolete rows",
    run() {
      const selection = selectDashboardProfitLines(
        [
          poReportLine("SKU-1", "2026-01-10", 400),
          poReportLine("SKU-1", "2026-01-20", 600),
          detailLine("SKU-1", "2026-01-10", 400),
          detailLine("SKU-1", "2026-01-20", 600)
        ],
        range("2026-01-01", "2026-01-31")
      );

      assert.equal(selection.lines.length, 2);
      assert.equal(selection.lines.every((line) => line.salesSource === "po_report"), true);
      assert.equal(selection.lines.reduce((sum, line) => sum + line.itemRevenue, 0), 1000);
      assert.equal(selection.suppressedDetailLines.length, 2);
    }
  },
  {
    name: "uses PO report rows for a partial range",
    run() {
      const selection = selectDashboardProfitLines(
        [
          poReportLine("SKU-1", "2026-01-20", 300),
          poReportLine("SKU-1", "2026-01-30", 200),
          detailLine("SKU-1", "2026-01-20", 300),
          detailLine("SKU-1", "2026-01-30", 200)
        ],
        range("2026-01-18", "2026-01-31")
      );

      assert.equal(selection.lines.length, 2);
      assert.equal(selection.lines.every((line) => line.salesSource === "po_report"), true);
      assert.equal(selection.lines.reduce((sum, line) => sum + line.itemRevenue, 0), 500);
      assert.equal(selection.suppressedDetailLines.length, 2);
    }
  },
  {
    name: "uses PO report rows and ignores obsolete sales rows in a mixed custom range",
    run() {
      const selection = selectDashboardProfitLines(
        [
          poReportLine("JAN-SKU", "2026-01-10", 1000),
          detailLine("JAN-SKU", "2026-01-10", 1000),
          poReportLine("FEB-SKU", "2026-02-10", 800),
          detailLine("FEB-SKU", "2026-02-10", 800)
        ],
        range("2026-01-01", "2026-02-15")
      );

      assert.equal(selection.lines.length, 2);
      assert.deepEqual(selection.lines.map((line) => line.salesSource), ["po_report", "po_report"]);
      assert.equal(selection.lines.reduce((sum, line) => sum + line.itemRevenue, 0), 1800);
      assert.equal(selection.suppressedDetailLines.length, 2);
    }
  },
  {
    name: "drops obsolete sales rows when no PO sales exist",
    run() {
      const selection = selectDashboardProfitLines(
        [detailLine("SKU-1", "2026-01-31", 1000)],
        range("2026-01-31", "2026-01-31")
      );

      assert.equal(selection.lines.length, 0);
      assert.equal(selection.suppressedDetailLines.length, 1);
    }
  },
  {
    name: "treats non-cancelled PO detail rows as the sales source",
    run() {
      assert.equal(
        getPoSalesSourceFromOrderItem({
          orderStatus: "PO_DETAIL",
          lineMetadata: [{ source: "walmart_po_report", orderStatus: "Delivered" }]
        }),
        "po_report"
      );
    }
  },
  {
    name: "excludes cancelled PO detail rows from the sales source",
    run() {
      assert.equal(
        getPoSalesSourceFromOrderItem({
          orderStatus: "PO_DETAIL",
          lineMetadata: [{ source: "walmart_po_report", orderStatus: "Cancelled", cancelled: true }]
        }),
        "none"
      );
    }
  },
  {
    name: "excludes cancelled PO detail rows from direct PO status without metadata",
    run() {
      assert.equal(
        getPoSalesSourceFromOrderItem({
          orderStatus: "PO_DETAIL",
          poOrderStatus: "Cancelled",
          lineMetadata: []
        }),
        "none"
      );
    }
  },
  {
    name: "calculates PO gross sales from unit price times quantity",
    run() {
      assert.deepEqual(
        calculatePoGrossProductSales({
          orderedQuantity: 2,
          unitPrice: 12.5,
          cancelled: false
        }),
        {
          activeQuantity: 2,
          originalQuantity: 2,
          cancelledQuantity: 0,
          unitPrice: 12.5,
          originalGrossProductSales: 25,
          grossProductSales: 25,
          priceSourceKind: "unit_price"
        }
      );
    }
  },
  {
    name: "uses extended PO line amount without multiplying quantity again",
    run() {
      assert.deepEqual(
        calculatePoGrossProductSales({
          orderedQuantity: 3,
          extendedLineAmount: 90,
          cancelled: false
        }),
        {
          activeQuantity: 3,
          originalQuantity: 3,
          cancelledQuantity: 0,
          unitPrice: 30,
          originalGrossProductSales: 90,
          grossProductSales: 90,
          priceSourceKind: "extended_line_amount"
        }
      );
    }
  },
  {
    name: "reduces active PO quantity for partial cancellations",
    run() {
      assert.deepEqual(
        calculatePoGrossProductSales({
          orderedQuantity: 5,
          cancelledQuantity: 2,
          unitPrice: 9,
          cancelled: false
        }),
        {
          activeQuantity: 3,
          originalQuantity: 5,
          cancelledQuantity: 2,
          unitPrice: 9,
          originalGrossProductSales: 45,
          grossProductSales: 27,
          priceSourceKind: "unit_price"
        }
      );
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function poReportLine(sellerSku, orderDate, itemRevenue) {
  return line({
    sellerSku,
    orderDate,
    itemRevenue,
    salesSource: "po_report"
  });
}

function detailLine(sellerSku, orderDate, itemRevenue) {
  return line({
    sellerSku,
    orderDate,
    itemRevenue,
    salesSource: "none"
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
