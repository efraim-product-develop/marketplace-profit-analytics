import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCogsAudit,
  buildDateCoverage,
  buildProductAttributionAudit,
  buildReadinessStatus,
  buildSellerCenterSemAudit,
  buildSettlementAudit,
  buildWalmartConnectAudit,
  getDateStringsInRange
} from "../src/server/audit/walmart-data-quality.ts";

const tests = [
  {
    name: "complete PO-style date coverage",
    run() {
      const coverage = buildDateCoverage({
        expectedDates: ["2026-01-01", "2026-01-02"],
        coveredDates: ["2026-01-01", "2026-01-02"]
      });

      assert.equal(coverage.status, "Complete");
      assert.equal(coverage.coverageComplete, true);
      assert.deepEqual(coverage.missingDates, []);
    }
  },
  {
    name: "partial PO-style date coverage",
    run() {
      const coverage = buildDateCoverage({
        expectedDates: ["2026-01-01", "2026-01-02", "2026-01-03"],
        coveredDates: ["2026-01-01", "2026-01-03"]
      });

      assert.equal(coverage.status, "Partial");
      assert.deepEqual(coverage.missingDates, ["2026-01-02"]);
    }
  },
  {
    name: "unknown PO coverage when metadata cannot prove completeness",
    run() {
      const coverage = buildDateCoverage({
        expectedDates: ["2026-01-01", "2026-01-02"],
        coveredDates: ["2026-01-01", "2026-01-02"],
        canProveCompleteness: false
      });

      assert.equal(coverage.status, "Coverage Unknown");
      assert.equal(coverage.coverageComplete, false);
    }
  },
  {
    name: "complete settlement coverage from imported settlement periods",
    run() {
      const audit = buildSettlementAudit({
        expectedDates: ["2026-01-01", "2026-01-02"],
        dateRange: range("2026-01-01", "2026-01-02"),
        payouts: [payout("2026-01-01", "2026-01-02", 100)],
        importRuns: [importRun({ unsupportedFinancialRows: 0 })],
        feeInputs: [],
        refundInputs: []
      });

      assert.equal(audit.status, "Complete");
    }
  },
  {
    name: "partial settlement coverage from incomplete settlement periods",
    run() {
      const audit = buildSettlementAudit({
        expectedDates: ["2026-01-01", "2026-01-02", "2026-01-03"],
        dateRange: range("2026-01-01", "2026-01-03"),
        payouts: [payout("2026-01-01", "2026-01-02", 100)],
        importRuns: [importRun({ unsupportedFinancialRows: 0 })],
        feeInputs: [],
        refundInputs: []
      });

      assert.equal(audit.status, "Partial");
    }
  },
  {
    name: "missing settlement coverage",
    run() {
      const audit = buildSettlementAudit({
        expectedDates: ["2026-01-01"],
        dateRange: range("2026-01-01", "2026-01-01"),
        payouts: [],
        importRuns: [],
        feeInputs: [],
        refundInputs: []
      });

      assert.equal(audit.status, "Missing");
    }
  },
  {
    name: "settlement detail rows use each payout period's financial dates",
    run() {
      const audit = buildSettlementAudit({
        expectedDates: ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
        dateRange: range("2026-01-01", "2026-01-04"),
        payouts: [
          payout("2026-01-01", "2026-01-02", 100),
          payout("2026-01-03", "2026-01-04", 200)
        ],
        importRuns: [importRun({ unsupportedFinancialRows: 0 })],
        feeInputs: [
          fee("commission", -10, false, "2026-01-01"),
          fee("commission", -20, false, "2026-01-03")
        ],
        refundInputs: [
          refund(-5, false, "2026-01-02"),
          refund(-7, false, "2026-01-04")
        ]
      });

      assert.equal(audit.relevantSettlements[0].marketplaceCommission, 10);
      assert.equal(audit.relevantSettlements[0].refundTotal, 5);
      assert.equal(audit.relevantSettlements[1].marketplaceCommission, 20);
      assert.equal(audit.relevantSettlements[1].refundTotal, 7);
    }
  },
  {
    name: "SEM complete coverage with confirmed zero-spend distinction",
    run() {
      const audit = buildSellerCenterSemAudit(
        ["2026-01-01", "2026-01-02"],
        [
          sem("2026-01-01", 10),
          sem("2026-01-01", 0, { confirmedZeroSpendDates: ["2026-01-02"] })
        ]
      );

      assert.equal(audit.status, "Complete");
      assert.deepEqual(audit.confirmedZeroSpendDates, ["2026-01-02"]);
    }
  },
  {
    name: "SEM missing dates are reported",
    run() {
      const audit = buildSellerCenterSemAudit(
        ["2026-01-01", "2026-01-02"],
        [sem("2026-01-01", 10)]
      );

      assert.equal(audit.status, "Partial");
      assert.deepEqual(audit.missingDates, ["2026-01-02"]);
    }
  },
  {
    name: "Walmart Connect daily rows provide coverage",
    run() {
      const audit = buildWalmartConnectAudit(
        ["2026-01-01"],
        [connect("2026-01-01", 12, "SKU-1", { grain: "daily" })]
      );

      assert.equal(audit.status, "Complete");
      assert.equal(audit.spend, 12);
      assert.equal(audit.skuAttributableSpend, 12);
    }
  },
  {
    name: "monthly Walmart Connect rows do not count as daily coverage",
    run() {
      const audit = buildWalmartConnectAudit(
        ["2026-01-01"],
        [connect("2026-01-01", 40, "SKU-1", { reportMonth: "2026-01" })]
      );

      assert.equal(audit.status, "Missing");
      assert.equal(audit.retiredMonthlyRows, 1);
      assert.equal(audit.retiredMonthlySpend, 40);
    }
  },
  {
    name: "complete COGS coverage",
    run() {
      const audit = buildCogsAudit({
        lines: [line("SKU-1", "2026-01-05", 2, 100)],
        costRecords: [cost("SKU-1", "2026-01-01", 8)]
      });

      assert.equal(audit.status, "Complete");
      assert.equal(audit.skusMissingCogs, 0);
    }
  },
  {
    name: "missing COGS coverage identifies affected SKU, units, and sales",
    run() {
      const audit = buildCogsAudit({
        lines: [line("SKU-2", "2026-01-05", 3, 150)],
        costRecords: []
      });

      assert.equal(audit.status, "Partial");
      assert.equal(audit.skusMissingCogs, 1);
      assert.equal(audit.unitsAffectedByMissingCogs, 3);
      assert.equal(audit.salesAffectedByMissingCogs, 150);
    }
  },
  {
    name: "attributable vs unallocated financial components are reported",
    run() {
      const audit = buildProductAttributionAudit({
        feeInputs: [
          fee("commission", -10, true),
          fee("commission", -2, false),
          fee("fulfillment_fee", -4, true)
        ],
        refundInputs: [
          refund(6, true),
          refund(3, false)
        ],
        advertisingCosts: [
          connect("2026-01-01", 8, "SKU-1", { grain: "daily" }),
          connect("2026-01-01", 5, null, { grain: "daily" }),
          sem("2026-01-01", 7)
        ]
      });

      assert.equal(audit.refunds.skuAttributable, 6);
      assert.equal(audit.refunds.unallocated, 3);
      assert.equal(audit.marketplaceCommission.skuAttributable, 10);
      assert.equal(audit.marketplaceCommission.unallocated, 2);
      assert.equal(audit.fulfillmentFees.skuAttributable, 4);
      assert.equal(audit.walmartConnectAdvertising.skuAttributable, 8);
      assert.equal(audit.walmartConnectAdvertising.unallocated, 5);
      assert.equal(audit.sellerCenterSem.amount, 7);
    }
  },
  {
    name: "P&L Ready requires all source statuses to be complete",
    run() {
      assert.equal(
        buildReadinessStatus({
          poSales: "Complete",
          settlements: "Complete",
          cogs: "Complete",
          sellerCenterSem: "Complete",
          walmartConnect: "Complete"
        }),
        "P&L Data Ready"
      );
      assert.equal(
        buildReadinessStatus({
          poSales: "Coverage Unknown",
          settlements: "Complete",
          cogs: "Complete",
          sellerCenterSem: "Complete",
          walmartConnect: "Complete"
        }),
        "P&L Data Incomplete"
      );
    }
  },
  {
    name: "audit date utilities use exact selected date range",
    run() {
      assert.deepEqual(getDateStringsInRange(range("2026-02-01", "2026-02-03")), [
        "2026-02-01",
        "2026-02-02",
        "2026-02-03"
      ]);
    }
  },
  {
    name: "audit service does not use retired Item Sales or Overview sources",
    run() {
      const source = readFileSync("src/server/audit/walmart-data-quality.ts", "utf8").toLowerCase();

      assert.equal(source.includes("item_sales"), false);
      assert.equal(source.includes("overview"), false);
      assert.equal(source.includes("item performance"), false);
    }
  },
  {
    name: "audit service is read-only",
    run() {
      const source = readFileSync("src/server/audit/walmart-data-quality.ts", "utf8");

      assert.equal(/\bprisma\.\w+\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b/.test(source), false);
      assert.equal(/\$transaction/.test(source), false);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function range(from, to) {
  return {
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T23:59:59.999Z`)
  };
}

function payout(start, end, amount) {
  return {
    settlementPeriodStart: new Date(`${start}T00:00:00.000Z`),
    settlementPeriodEnd: new Date(`${end}T00:00:00.000Z`),
    payoutDate: new Date(`${end}T00:00:00.000Z`),
    payoutAmount: amount,
    importedAt: new Date(`${end}T00:00:00.000Z`),
    source: "settlement_report"
  };
}

function importRun(summary) {
  return {
    summary,
    importedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-02T00:00:00.000Z")
  };
}

function line(sellerSku, orderDate, quantity, itemRevenue) {
  return {
    marketplace: "walmart",
    sellerSku,
    parentSku: "PARENT-1",
    orderId: `${sellerSku}-${orderDate}`,
    orderDate: new Date(`${orderDate}T00:00:00.000Z`),
    quantity,
    itemRevenue
  };
}

function cost(sellerSku, effectiveDate, unitCost) {
  return {
    marketplace: "walmart",
    sellerSku,
    effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`),
    unitCost
  };
}

function fee(feeType, amount, attributable, postedAt) {
  return {
    marketplace: "walmart",
    sellerSku: attributable ? "SKU-1" : null,
    parentSku: attributable ? "PARENT-1" : null,
    feeType,
    amount,
    postedAt: postedAt ? new Date(`${postedAt}T00:00:00.000Z`) : undefined,
    metadata: attributionMetadata(attributable)
  };
}

function refund(amount, attributable, refundDate) {
  return {
    marketplace: "walmart",
    sellerSku: attributable ? "SKU-1" : null,
    parentSku: attributable ? "PARENT-1" : null,
    amount,
    refundDate: refundDate ? new Date(`${refundDate}T00:00:00.000Z`) : undefined,
    metadata: attributionMetadata(attributable)
  };
}

function attributionMetadata(attributable) {
  return {
    productAttributionReliable: attributable,
    attributionScope: attributable ? "product" : "marketplace",
    amountSignConvention: "negative_expense_positive_credit"
  };
}

function sem(costDate, amount, metadata = {}) {
  return {
    marketplace: "walmart",
    source: "walmart_seller_center_sem",
    amount,
    costDate: new Date(`${costDate}T00:00:00.000Z`),
    metadata
  };
}

function connect(costDate, amount, sellerSku, metadata = {}) {
  return {
    marketplace: "walmart",
    source: "walmart_connect_item_performance",
    sellerSku,
    parentSku: sellerSku ? "PARENT-1" : null,
    amount,
    costDate: new Date(`${costDate}T00:00:00.000Z`),
    metadata
  };
}
