import assert from "node:assert/strict";
import {
  buildSkuPnlCsv,
  buildSkuPnlQueryString,
  getSkuPnlSourceLabel,
  parseSkuPnlSearchParams
} from "../src/server/pnl/sku-page.ts";

const referenceDate = new Date("2026-07-09T12:00:00.000Z");

const tests = [
  {
    name: "parses SKU P&L filters from search params",
    run() {
      const parsed = parseSkuPnlSearchParams(
        {
          from: "2026-01-01",
          to: "bad-date",
          period: "week",
          parent: " PARENT-1 ",
          brand: " Inspire ",
          department: " Gloves ",
          sku: " SKU-1 "
        },
        referenceDate
      );

      assert.equal(parsed.formValues.from, "2026-06-15");
      assert.equal(parsed.formValues.to, "2026-07-12");
      assert.equal(parsed.formValues.period, "week");
      assert.equal(parsed.formValues.parent, "PARENT-1");
      assert.equal(parsed.formValues.brand, "Inspire");
      assert.equal(parsed.formValues.department, "Gloves");
      assert.equal(parsed.selectedSku, "SKU-1");
      assert.equal(parsed.filters.dateRange?.from?.toISOString(), "2026-06-15T00:00:00.000Z");
      assert.equal(parsed.filters.dateRange?.to?.toISOString(), "2026-07-12T23:59:59.999Z");
      assert.equal(parsed.filters.parentSku, "PARENT-1");
    }
  },
  {
    name: "parses custom SKU P&L date ranges exactly",
    run() {
      const parsed = parseSkuPnlSearchParams(
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
    name: "builds compact SKU P&L query strings",
    run() {
      const query = buildSkuPnlQueryString(
        {
          from: "2026-01-01",
          to: "",
          period: "month",
          parent: "PARENT 1",
          brand: "",
          department: "Disposable Gloves"
        },
        { sku: "SKU-1" }
      );

      assert.equal(
        query,
        "from=2026-01-01&period=month&parent=PARENT+1&department=Disposable+Gloves&sku=SKU-1"
      );
    }
  },
  {
    name: "exports SKU P&L rows as escaped CSV",
    run() {
      const csv = buildSkuPnlCsv([
        {
          marketplace: "walmart",
          sellerSku: "SKU-1",
          parentSku: "PARENT-1",
          brand: 'Inspire "Pro"',
          department: "Gloves, Nitrile",
          salesSource: "item_sales_daily_summary",
          label: "walmart:SKU-1",
          quantity: 3,
          grossRevenue: 100,
          discounts: 5,
          netRevenue: 95,
          refunds: 2,
          salesRefunds: 7,
          taxCollected: 0,
          marketplaceFees: 10,
          commissionFees: 10,
          fulfillmentFees: 0,
          shippingFees: 0,
          storageFees: 0,
          returnFees: 0,
          adjustmentFees: 0,
          otherFees: 0,
          walmartConnectAdvertisingCost: 1,
          semAdvertisingCost: 3,
          advertisingCost: 4,
          cogs: 30,
          grossProfit: 53,
          grossMarginPercent: 55.789,
          grossProfitPerUnit: 17.67,
          missingCogsUnits: 0,
          missingCogsLineCount: 0,
          contributionProfit: 49,
          netProfit: 49,
          marginPercent: 51.579,
          netMarginPercent: 51.579,
          profitPerUnit: 16.33
        }
      ]);

      assert.match(csv, /"Inspire ""Pro"""/);
      assert.match(csv, /"Gloves, Nitrile"/);
      assert.match(csv, /Item Sales/);
    }
  },
  {
    name: "labels source indicators",
    run() {
      assert.equal(getSkuPnlSourceLabel("item_sales_daily_summary"), "Item Sales");
      assert.equal(getSkuPnlSourceLabel("item_sales_monthly_summary"), "Legacy Item Sales");
      assert.equal(getSkuPnlSourceLabel("po_order_detail"), "PO Audit");
      assert.equal(getSkuPnlSourceLabel("mixed"), "Mixed");
      assert.equal(getSkuPnlSourceLabel(undefined), "No Sales");
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}
