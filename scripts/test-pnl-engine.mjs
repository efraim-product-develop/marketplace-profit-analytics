import assert from "node:assert/strict";
import { calculateProfitRows, summarizeProfit } from "../src/server/pnl/engine.ts";

const tests = [
  {
    name: "rolls child SKU Walmart Connect spend into parent rows when ad parent is missing",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "CHILD-SKU-1",
            parentSku: "PARENT-SKU-1",
            quantity: 1,
            itemRevenue: 100
          }
        ],
        "parentSku",
        [
          {
            marketplace: "walmart",
            sellerSku: "CHILD-SKU-1",
            parentSku: null,
            source: "walmart_connect_item_performance",
            amount: 12
          }
        ]
      );
      const [row] = rows;

      assert.equal(rows.length, 1);
      assert.equal(row.parentSku, "PARENT-SKU-1");
      assert.equal(row.walmartConnectAdvertisingCost, 12);
      assert.equal(row.advertisingCost, 12);
      assert.equal(row.tacosPercent, 12);
      assert.equal(row.netProfit, 88);
    }
  },
  {
    name: "marketplace summary includes unallocated Walmart Connect spend",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            quantity: 1,
            itemRevenue: 100
          }
        ],
        "parentSku",
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            source: "walmart_connect_item_performance",
            amount: 5
          },
          {
            marketplace: "walmart",
            sellerSku: null,
            parentSku: null,
            source: "walmart_connect_item_performance",
            amount: 7
          },
          {
            marketplace: "walmart",
            sellerSku: null,
            parentSku: null,
            source: "walmart_seller_center_sem",
            amount: 3
          }
        ]
      );
      const summary = summarizeProfit(rows);

      assert.equal(summary.walmartConnectAdvertisingCost, 12);
      assert.equal(summary.semAdvertisingCost, 3);
      assert.equal(summary.advertisingCost, 15);
      assert.equal(summary.tacosPercent, 15);
      assert.equal(summary.netProfit, 85);
    }
  },
  {
    name: "product summary excludes unallocated Walmart Connect spend when filtered before calculation",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            quantity: 1,
            itemRevenue: 100
          }
        ],
        "parentSku",
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-1",
            parentSku: "PARENT-1",
            source: "walmart_connect_item_performance",
            amount: 5
          }
        ]
      );
      const summary = summarizeProfit(rows);

      assert.equal(summary.walmartConnectAdvertisingCost, 5);
      assert.equal(summary.advertisingCost, 5);
      assert.equal(summary.netProfit, 95);
    }
  },
  {
    name: "uses PO item revenue as gross sales and tracks shipping/discount separately",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
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
    name: "cancellation is excluded from gross sales and does not create a refund",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "none",
            orderStatus: "Cancelled",
            sellerSku: "SKU-CANCELLED",
            parentSku: "PARENT-CANCELLED",
            quantity: 0,
            itemRevenue: 100,
            cogsTotal: 25
          }
        ],
        "sellerSku"
      );

      assert.equal(rows.length, 0);
    }
  },
  {
    name: "settlement refund reduces sales and is not deducted again from profit",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "SKU-REFUND-ONCE",
            parentSku: "PARENT-REFUND",
            quantity: 1,
            itemRevenue: 100,
            cogsTotal: 30,
            fees: [fee("commission", -10), fee("fulfillment_fee", -5)]
          }
        ],
        "sellerSku",
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND-ONCE",
            parentSku: "PARENT-REFUND",
            source: "walmart_connect_item_performance",
            amount: 7
          },
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND-ONCE",
            parentSku: "PARENT-REFUND",
            source: "walmart_seller_center_sem",
            amount: 3
          }
        ],
        [fee("storage_fee", -2, "SKU-REFUND-ONCE", "PARENT-REFUND")],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND-ONCE",
            parentSku: "PARENT-REFUND",
            amount: -20
          }
        ]
      );
      const [row] = rows;

      assert.equal(row.grossRevenue, 100);
      assert.equal(row.salesRefunds, 20);
      assert.equal(row.netRevenue, 80);
      assert.equal(row.tacosPercent, 12.5);
      assert.equal(row.netProfit, 23);
    }
  },
  {
    name: "cancellation plus settlement refund does not double deduct sales",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "none",
            orderStatus: "Cancelled",
            sellerSku: "SKU-CANCELLED-REFUND",
            parentSku: "PARENT-CANCELLED",
            quantity: 0,
            itemRevenue: 100
          }
        ],
        "sellerSku",
        [],
        [],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-CANCELLED-REFUND",
            parentSku: "PARENT-CANCELLED",
            amount: 20
          }
        ]
      );
      const [row] = rows;

      assert.equal(rows.length, 1);
      assert.equal(row.grossRevenue, 0);
      assert.equal(row.salesRefunds, 20);
      assert.equal(row.netRevenue, -20);
      assert.equal(row.netProfit, -20);
    }
  },
  {
    name: "subtracts refund sales from PO report revenue",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
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
    name: "applies standalone settlement refunds to matching PO report sales",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "SKU-REFUND",
            parentSku: "PARENT-REFUND",
            quantity: 10,
            itemRevenue: 500,
            salesRefunds: 25,
            cogsTotal: 100
          }
        ],
        "sellerSku",
        [],
        [],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND",
            parentSku: "PARENT-REFUND",
            amount: 25
          }
        ]
      );
      const [row] = rows;

      assert.equal(row.netRevenue, 450);
      assert.equal(row.salesRefunds, 50);
      assert.equal(row.grossProfit, 350);
      assert.equal(row.netProfit, 350);
    }
  },
  {
    name: "uses standalone settlement refunds when PO report sales have no row-level refunds",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "SKU-REFUND-FALLBACK",
            parentSku: "PARENT-REFUND",
            quantity: 10,
            itemRevenue: 500,
            salesRefunds: 0,
            cogsTotal: 100
          }
        ],
        "sellerSku",
        [],
        [],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND-FALLBACK",
            parentSku: "PARENT-REFUND",
            amount: 25
          }
        ]
      );
      const [row] = rows;

      assert.equal(row.netRevenue, 475);
      assert.equal(row.salesRefunds, 25);
      assert.equal(row.grossProfit, 375);
      assert.equal(row.netProfit, 375);
    }
  },
  {
    name: "sums multiple standalone settlement refunds for the same group",
    run() {
      const rows = calculateProfitRows(
        [],
        "parentSku",
        [],
        [],
        [
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND-A",
            parentSku: "PARENT-REFUND",
            amount: 10
          },
          {
            marketplace: "walmart",
            sellerSku: "SKU-REFUND-B",
            parentSku: "PARENT-REFUND",
            amount: 15
          }
        ]
      );
      const [row] = rows;

      assert.equal(row.parentSku, "PARENT-REFUND");
      assert.equal(row.netRevenue, -25);
      assert.equal(row.salesRefunds, 25);
      assert.equal(row.netProfit, -25);
    }
  },
  {
    name: "classifies marketplace fee categories and treats positive adjustments as credits",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
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
            salesSource: "po_report",
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
      assert.deepEqual(row.otherFeeCategoryBreakdown, [
        {
          category: "other",
          categoryName: "Other",
          transactionCount: 2,
          charges: 12,
          credits: 5,
          netAmount: 7
        }
      ]);
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
    name: "tracks seller fulfilled shipping as a marketplace shipping cost outside other fees",
    run() {
      const rows = calculateProfitRows(
        [],
        "parentSku",
        [],
        [
          {
            marketplace: "walmart",
            feeType: "seller_fulfilled_shipping",
            amount: 125,
            metadata: { source: "manual_seller_fulfilled_shipping" }
          }
        ]
      );
      const summary = summarizeProfit(rows);
      const [row] = rows;

      assert.equal(row.parentSku, "Unassigned parent");
      assert.equal(row.marketplaceFees, 125);
      assert.equal(row.sellerFulfilledShippingCost, 125);
      assert.equal(row.shippingFees, 125);
      assert.equal(row.otherFees, 0);
      assert.deepEqual(row.otherFeeCategoryBreakdown, []);
      assert.equal(row.netProfit, -125);
      assert.equal(summary.sellerFulfilledShippingCost, 125);
      assert.equal(summary.netProfit, -125);
    }
  },
  {
    name: "summarizes net profit, margin, and profit per unit consistently",
    run() {
      const rows = calculateProfitRows(
        [
          {
            marketplace: "walmart",
            salesSource: "po_report",
            sellerSku: "SKU-4",
            parentSku: "PARENT-4",
            quantity: 4,
            itemRevenue: 200,
            cogsTotal: 80,
            fees: [fee("marketplace_fee", -20)]
          },
          {
            marketplace: "walmart",
            salesSource: "po_report",
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

function fee(feeType, amount, sellerSku = "SKU-2", parentSku = "PARENT-2") {
  return {
    marketplace: "walmart",
    sellerSku,
    parentSku,
    feeType,
    amount
  };
}

function assertClose(actual, expected) {
  assert.equal(Math.round(actual * 10_000) / 10_000, expected);
}
