import assert from "node:assert/strict";
import { calculateProfitRows, summarizeProfit } from "../src/server/pnl/engine.ts";
import {
  buildProductAttributionDiagnostics,
  filterProductAttributableFees,
  filterProductAttributableRefunds,
  filterProductAttributedAdvertisingCosts
} from "../src/server/pnl/product-attribution.ts";

const attributionMetadata = {
  productAttributionReliable: true,
  attributionScope: "product",
  amountSignConvention: "negative_expense_positive_credit"
};

const marketplaceMetadata = {
  productAttributionReliable: false,
  attributionScope: "marketplace",
  amountSignConvention: "negative_expense_positive_credit"
};

const tests = [
  {
    name: "product filters keep only attributable refunds, commission, fulfillment, and SKU-level Walmart Connect",
    run() {
      const fees = [
        fee("commission_on_product", -10, attributionMetadata),
        fee("wfs_fulfillment_fee", -4, attributionMetadata),
        fee("commission_on_product", -3, marketplaceMetadata),
        fee("storage_fee", -2, attributionMetadata)
      ];
      const refunds = [
        refund(15, attributionMetadata),
        refund(7, marketplaceMetadata)
      ];
      const ads = [
        connectAd(5, "SKU-1"),
        connectAd(6, null),
        semAd(9)
      ];

      assert.deepEqual(filterProductAttributableFees(fees), [fees[0], fees[1]]);
      assert.deepEqual(filterProductAttributableRefunds(refunds), [refunds[0]]);
      assert.deepEqual(filterProductAttributedAdvertisingCosts(ads), [ads[0]]);
    }
  },
  {
    name: "product-level SKU profit excludes marketplace-only costs and subtracts attributable rows",
    run() {
      const rows = calculateProfitRows(
        [line()],
        "sellerSku",
        filterProductAttributedAdvertisingCosts([connectAd(5, "SKU-1"), connectAd(6, null), semAd(9)]),
        filterProductAttributableFees([
          fee("commission_on_product", -10, attributionMetadata),
          fee("wfs_fulfillment_fee", -4, attributionMetadata),
          fee("storage_fee", -2, attributionMetadata)
        ]),
        filterProductAttributableRefunds([
          refund(15, attributionMetadata),
          refund(7, marketplaceMetadata)
        ])
      );
      const [row] = rows;

      assert.equal(row.netRevenue, 85);
      assert.equal(row.salesRefunds, 15);
      assert.equal(row.commissionFees, 10);
      assert.equal(row.fulfillmentFees, 4);
      assert.equal(row.marketplaceFees, 14);
      assert.equal(row.cogs, 30);
      assert.equal(row.walmartConnectAdvertisingCost, 5);
      assert.equal(row.semAdvertisingCost, 0);
      assert.equal(row.netProfit, 36);
      assert.equal(row.profitPerUnit, 18);
      assertClose(row.netMarginPercent, 42.3529);
    }
  },
  {
    name: "positive product-level fee reversal increases product profit",
    run() {
      const rows = calculateProfitRows(
        [line()],
        "sellerSku",
        [],
        filterProductAttributableFees([
          fee("commission_on_product", -10, attributionMetadata),
          fee("commission_on_product", 4, attributionMetadata)
        ])
      );
      const [row] = rows;

      assert.equal(row.commissionFees, 6);
      assert.equal(row.marketplaceFees, 6);
      assert.equal(row.netProfit, 64);
    }
  },
  {
    name: "negative product-level fee charge reduces product profit",
    run() {
      const rows = calculateProfitRows(
        [line()],
        "sellerSku",
        [],
        filterProductAttributableFees([fee("commission_on_product", -10, attributionMetadata)])
      );
      const [row] = rows;

      assert.equal(row.commissionFees, 10);
      assert.equal(row.netProfit, 60);
    }
  },
  {
    name: "zero sales and zero units calculate safe margin and profit per unit",
    run() {
      const rows = calculateProfitRows(
        [],
        "sellerSku",
        [],
        filterProductAttributableFees([fee("commission_on_product", -10, attributionMetadata)])
      );
      const [row] = rows;

      assert.equal(row.netRevenue, 0);
      assert.equal(row.quantity, 0);
      assert.equal(row.netProfit, -10);
      assert.equal(row.netMarginPercent, 0);
      assert.equal(row.profitPerUnit, 0);
    }
  },
  {
    name: "parent product total equals sum of child SKU product rows",
    run() {
      const lines = [
        line({ sellerSku: "SKU-1", itemRevenue: 100, quantity: 2, cogsTotal: 30 }),
        line({ sellerSku: "SKU-2", itemRevenue: 50, quantity: 1, cogsTotal: 10 })
      ];
      const fees = filterProductAttributableFees([
        fee("commission_on_product", -10, attributionMetadata, "SKU-1"),
        fee("wfs_fulfillment_fee", -5, attributionMetadata, "SKU-2")
      ]);
      const refunds = filterProductAttributableRefunds([
        refund(8, attributionMetadata, "SKU-1")
      ]);
      const ads = filterProductAttributedAdvertisingCosts([
        connectAd(4, "SKU-1"),
        connectAd(6, "SKU-2")
      ]);
      const skuSummary = summarizeProfit(calculateProfitRows(lines, "sellerSku", ads, fees, refunds));
      const parentSummary = summarizeProfit(calculateProfitRows(lines, "parentSku", ads, fees, refunds));

      assert.equal(parentSummary.netRevenue, skuSummary.netRevenue);
      assert.equal(parentSummary.quantity, skuSummary.quantity);
      assert.equal(parentSummary.salesRefunds, skuSummary.salesRefunds);
      assert.equal(parentSummary.cogs, skuSummary.cogs);
      assert.equal(parentSummary.commissionFees, skuSummary.commissionFees);
      assert.equal(parentSummary.fulfillmentFees, skuSummary.fulfillmentFees);
      assert.equal(parentSummary.walmartConnectAdvertisingCost, skuSummary.walmartConnectAdvertisingCost);
      assert.equal(parentSummary.netProfit, skuSummary.netProfit);
    }
  },
  {
    name: "attribution diagnostics report attributable and marketplace-only amounts",
    run() {
      const diagnostics = buildProductAttributionDiagnostics({
        feeAdjustments: [
          fee("commission_on_product", -10, attributionMetadata),
          fee("commission_on_product", -3, marketplaceMetadata),
          fee("wfs_fulfillment_fee", -4, attributionMetadata),
          fee("wfs_fulfillment_fee", -2, marketplaceMetadata),
          fee("storage_fee", -7, marketplaceMetadata)
        ],
        refundAdjustments: [
          refund(15, attributionMetadata),
          refund(7, marketplaceMetadata)
        ],
        advertisingCosts: [
          connectAd(5, "SKU-1"),
          connectAd(6, null),
          semAd(9)
        ]
      });

      assert.equal(diagnostics.attributableRefunds, 15);
      assert.equal(diagnostics.unallocatedRefunds, 7);
      assert.equal(diagnostics.attributableCommission, 10);
      assert.equal(diagnostics.unallocatedCommission, 3);
      assert.equal(diagnostics.attributableFulfillmentFees, 4);
      assert.equal(diagnostics.unallocatedFulfillmentFees, 2);
      assert.equal(diagnostics.attributableWalmartConnectAdvertising, 5);
      assert.equal(diagnostics.unallocatedWalmartConnectAdvertising, 6);
      assert.equal(diagnostics.totalWalmartConnectAdvertising, 11);
      assert.equal(diagnostics.walmartConnectAdvertisingReconciliationDifference, 0);
      assert.equal(diagnostics.sellerCenterSemAdvertising, 9);
      assert.equal(diagnostics.marketplaceOnlyOtherWalmartFees, 7);
    }
  },
  {
    name: "Walmart Connect diagnostics reconcile when all spend is attributable",
    run() {
      const diagnostics = buildProductAttributionDiagnostics({
        feeAdjustments: [],
        refundAdjustments: [],
        advertisingCosts: [
          connectAd(5, "SKU-1"),
          connectAd(7, "SKU-2")
        ]
      });

      assert.equal(diagnostics.attributableWalmartConnectAdvertising, 12);
      assert.equal(diagnostics.unallocatedWalmartConnectAdvertising, 0);
      assert.equal(diagnostics.totalWalmartConnectAdvertising, 12);
      assert.equal(diagnostics.walmartConnectAdvertisingReconciliationDifference, 0);
    }
  },
  {
    name: "Walmart Connect diagnostics reconcile when all spend is unallocated",
    run() {
      const diagnostics = buildProductAttributionDiagnostics({
        feeAdjustments: [],
        refundAdjustments: [],
        advertisingCosts: [
          connectAd(5, null),
          connectAd(7, "")
        ]
      });

      assert.equal(diagnostics.attributableWalmartConnectAdvertising, 0);
      assert.equal(diagnostics.unallocatedWalmartConnectAdvertising, 12);
      assert.equal(diagnostics.totalWalmartConnectAdvertising, 12);
      assert.equal(diagnostics.walmartConnectAdvertisingReconciliationDifference, 0);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function line(overrides = {}) {
  return {
    marketplace: "walmart",
    salesSource: "po_report",
    sellerSku: "SKU-1",
    parentSku: "PARENT-1",
    quantity: 2,
    itemRevenue: 100,
    cogsTotal: 30,
    ...overrides
  };
}

function fee(feeType, amount, metadata, sellerSku = "SKU-1") {
  return {
    marketplace: "walmart",
    sellerSku,
    parentSku: "PARENT-1",
    feeType,
    amount,
    metadata
  };
}

function refund(amount, metadata, sellerSku = "SKU-1") {
  return {
    marketplace: "walmart",
    sellerSku,
    parentSku: "PARENT-1",
    amount,
    metadata
  };
}

function connectAd(amount, sellerSku) {
  return {
    marketplace: "walmart",
    sellerSku,
    parentSku: sellerSku ? "PARENT-1" : null,
    source: "walmart_connect_item_performance",
    amount
  };
}

function semAd(amount) {
  return {
    marketplace: "walmart",
    sellerSku: null,
    parentSku: null,
    source: "walmart_seller_center_sem",
    amount
  };
}

function assertClose(actual, expected) {
  assert.equal(Math.round(actual * 10_000) / 10_000, expected);
}
