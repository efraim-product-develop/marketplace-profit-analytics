import assert from "node:assert/strict";
import { calculateProfitRows, summarizeProfit } from "../src/server/pnl/engine.ts";

const tests = [
  {
    name: "uses item revenue only for PO sales and tracks shipping/discount separately",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_order_detail",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            quantity: 2,
            itemRevenue: 100,
            shippingRevenue: 10,
            discountAmount: 5,
            taxCollected: 8,
            cogsTotal: 40,
            fees: [
              {
                marketplace: "walmart",
                sellerSku: "SKU-1",
                parentSku: "PARENT-1",
                feeType: "commission",
                amount: -10
              }
            ],
            refunds: [
              {
                marketplace: "walmart",
                sellerSku: "SKU-1",
                parentSku: "PARENT-1",
                amount: 15
              }
            ]
          }
        ],
        "sellerSku",
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            source: "seller_center_sem",
            amount: 5
          }
        ]
      );
      const [row] = rows;

      assert.equal(row.grossRevenue, 100);
      assert.equal(row.discounts, 5);
      assert.equal(row.netRevenue, 85);
      assert.equal(row.taxCollected, 8);
      assert.equal(row.salesRefunds, 15);
      assert.equal(row.refunds, 0);
      assert.equal(row.marketplaceFees, 10);
      assert.equal(row.cogs, 40);
      assert.equal(row.semAdvertisingCost, 5);
      assert.equal(row.walmartConnectAdvertisingCost, 0);
      assert.equal(row.advertisingCost, 5);
      assert.equal(row.grossProfit, 35);
      assert.equal(row.netProfit, 30);
      assert.equal(row.contributionProfit, 30);
      assert.equal(row.profitPerUnit, 15);
      assertClose(row.grossMarginPercent, 41.1765);
      assertClose(row.netMarginPercent, 35.2941);
    }
  },
  {
    name: "tracks Item Sales refund sales without subtracting them as a second refund expense",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "item_sales_monthly_summary",
            sellerSku: "SKU-SUMMARY",
            parentSku: "PARENT-SUMMARY",
            quantity: 10,
            itemRevenue: 500,
            salesRefunds: 25,
            cogsTotal: 100,
            fees: [fee("commission", -50)]
          }
        ],
        "sellerSku"
      );
      const [row] = rows;

      assert.equal(row.netRevenue, 475);
      assert.equal(row.salesRefunds, 25);
      assert.equal(row.refunds, 0);
      assert.equal(row.grossProfit, 325);
      assert.equal(row.netProfit, 325);
    }
  },
  {
    name: "classifies marketplace fee categories and treats positive adjustments as credits",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_order_detail",
            sellerSku: "SKU-2",
            parentSku: "PARENT-2",
            quantity: 1,
            itemRevenue: 100,
            fees: [
              fee("referral_fee", -10),
              fee("wfs_fulfillment_fee", -4),
              fee("shipping_fee", -2),
              fee("storage_fee", -1),
              fee("return_fee", -3),
              fee("adjustment", 2),
              fee("payment_processing", -5)
            ]
          }
        ],
        "sellerSku"
      );
      const [row] = rows;

      assert.equal(row.commissionFees, 10);
      assert.equal(row.fulfillmentFees, 4);
      assert.equal(row.shippingFees, 2);
      assert.equal(row.storageFees, 1);
      assert.equal(row.returnFees, 3);
      assert.equal(row.adjustmentFees, -2);
      assert.equal(row.otherFees, 5);
      assert.equal(row.marketplaceFees, 23);
      assert.equal(row.grossProfit, 77);
      assert.equal(row.netProfit, 77);
    }
  },
  {
    name: "uses signed settlement amounts so positive fee rows become credits",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_order_detail",
            sellerSku: "SKU-SIGNED",
            parentSku: "PARENT-SIGNED",
            quantity: 1,
            itemRevenue: 100,
            fees: [
              {
                marketplace: "walmart",
                sellerSku: "SKU-SIGNED",
                parentSku: "PARENT-SIGNED",
                feeType: "other_fee",
                amount: -12,
                metadata: { amountSignConvention: "negative_expense_positive_credit" }
              },
              {
                marketplace: "walmart",
                sellerSku: "SKU-SIGNED",
                parentSku: "PARENT-SIGNED",
                feeType: "other_fee",
                amount: 5,
                metadata: { amountSignConvention: "negative_expense_positive_credit" }
              }
            ]
          }
        ],
        "sellerSku"
      );
      const [row] = rows;

      assert.equal(row.otherFees, 7);
      assert.equal(row.marketplaceFees, 7);
      assert.equal(row.grossProfit, 93);
      assert.equal(row.netProfit, 93);
    }
  },
  {
    name: "applies standalone settlement-style fees and refund sales without sales lines",
    run() {
      const rows = calculateProfitRows(
        [],
        "parentSku",
        [],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-3",
            parentSku: "PARENT-3",
            feeType: "storage_fee",
            amount: -6
          }
        ],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-3",
            parentSku: "PARENT-3",
            amount: 4
          }
        ]
      );
      const [row] = rows;

      assert.equal(row.parentSku, "PARENT-3");
      assert.equal(row.netRevenue, -4);
      assert.equal(row.salesRefunds, 4);
      assert.equal(row.refunds, 0);
      assert.equal(row.marketplaceFees, 6);
      assert.equal(row.grossProfit, -10);
      assert.equal(row.netProfit, -10);
      assert.equal(row.profitPerUnit, 0);
    }
  },
  {
    name: "summarizes net profit, margin, and profit per unit consistently",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_order_detail",
            sellerSku: "SKU-4",
            parentSku: "PARENT-4",
            quantity: 4,
            itemRevenue: 200,
            cogsTotal: 80,
            fees: [fee("marketplace_fee", -20)]
          },
          {
            marketplace: "walmart",
            salesSource: "po_order_detail",
            sellerSku: "SKU-5",
            parentSku: "PARENT-5",
            quantity: 1,
            itemRevenue: 50,
            cogsTotal: 10,
            refunds: [
              {
                marketplace: "walmart",
                sellerSku: "SKU-5",
                parentSku: "PARENT-5",
                amount: 5
              }
            ]
          }
        ],
        "sellerSku",
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-4",
            parentSku: "PARENT-4",
            source: "seller_center_sem",
            amount: 15
          },
          {
            marketplace: "walmart",
            sellerSku: "SKU-5",
            parentSku: "PARENT-5",
            source: "walmart_connect_item_performance",
            amount: 5
          }
        ]
      );
      const summary = summarizeProfit(rows);

      assert.equal(summary.quantity, 5);
      assert.equal(summary.netRevenue, 245);
      assert.equal(summary.salesRefunds, 5);
      assert.equal(summary.refunds, 0);
      assert.equal(summary.marketplaceFees, 20);
      assert.equal(summary.cogs, 90);
      assert.equal(summary.semAdvertisingCost, 15);
      assert.equal(summary.walmartConnectAdvertisingCost, 5);
      assert.equal(summary.advertisingCost, 20);
      assert.equal(summary.grossProfit, 135);
      assert.equal(summary.netProfit, 115);
      assert.equal(summary.profitPerUnit, 23);
      assertClose(summary.grossMarginPercent, 55.102);
      assertClose(summary.netMarginPercent, 46.9388);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function fee(feeType, amount) {
  return {
    marketplace: "walmart",
    sellerSku: "SKU-2",
    parentSku: "PARENT-2",
    feeType,
    amount
  };
}

function assertClose(actual, expected) {
  assert.equal(Math.round(actual * 10_000) / 10_000, expected);
}
