import assert from "node:assert/strict";
import { calculateProfitRows } from "../src/server/pnl/engine.ts";
import {
  getSettlementCommissionDiagnostic,
  prepareSettlementDerivedCommissionForDateRange
} from "../src/server/pnl/settlement-commission-allocation.ts";

const tests = [
  {
    name: "allocates custom range entirely inside a settlement period",
    run() {
      const result = allocateCommission(
        commissionFee(1400, {
          settlementPeriodStart: "2026-07-01",
          settlementPeriodEnd: "2026-07-14"
        }),
        range("2026-07-05", "2026-07-07")
      );

      assert.equal(result.fee?.amount, 300);
      assert.equal(result.diagnostic.overlapDays, 3);
      assert.equal(result.diagnostic.totalSettlementDays, 14);
    }
  },
  {
    name: "allocates custom range overlapping the start of a settlement period",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        range("2026-06-28", "2026-07-03")
      );

      assert.equal(result.fee?.amount, 300);
      assert.equal(result.diagnostic.overlapDays, 3);
    }
  },
  {
    name: "allocates custom range overlapping the end of a settlement period",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        range("2026-07-12", "2026-07-20")
      );

      assert.equal(result.fee?.amount, 300);
      assert.equal(result.diagnostic.overlapDays, 3);
    }
  },
  {
    name: "excludes custom range with no settlement-period overlap",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        range("2026-07-15", "2026-07-16")
      );

      assert.equal(result.fee, null);
      assert.equal(result.diagnostic.allocatedCommissionIncluded, 0);
      assert.equal(result.diagnostic.overlapDays, 0);
    }
  },
  {
    name: "allocates settlement crossing two months",
    run() {
      const july = allocateCommission(
        commissionFee(1400, {
          settlementPeriodStart: "2026-07-25",
          settlementPeriodEnd: "2026-08-07"
        }),
        range("2026-07-01", "2026-07-31")
      );
      const august = allocateCommission(
        commissionFee(1400, {
          settlementPeriodStart: "2026-07-25",
          settlementPeriodEnd: "2026-08-07"
        }),
        range("2026-08-01", "2026-08-31")
      );

      assert.equal(july.fee?.amount, 700);
      assert.equal(august.fee?.amount, 700);
    }
  },
  {
    name: "includes one-day custom range inclusively",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        range("2026-07-05", "2026-07-05")
      );

      assert.equal(result.fee?.amount, 100);
      assert.equal(result.diagnostic.overlapDays, 1);
    }
  },
  {
    name: "parent and SKU P&L grouping use the same allocated commission",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        range("2026-07-05", "2026-07-07")
      );

      assert.ok(result.fee);

      const parentRows = calculateProfitRows([], "parentSku", [], [result.fee]);
      const skuRows = calculateProfitRows([], "sellerSku", [], [result.fee]);

      assert.equal(parentRows[0]?.commissionFees, 300);
      assert.equal(skuRows[0]?.commissionFees, 300);
    }
  },
  {
    name: "falls back to posting date when settlement-period metadata is missing",
    run() {
      const result = allocateCommission(
        commissionFee(1400, {
          settlementPeriodStart: null,
          settlementPeriodEnd: null,
          periodStartDate: null,
          periodEndDate: null
        }),
        range("2026-07-14", "2026-07-14")
      );

      assert.equal(result.fee?.amount, 1400);
      assert.equal(result.diagnostic.fallback, true);
      assert.equal(result.diagnostic.missingPeriodMetadata, true);
    }
  },
  {
    name: "uses transaction posted timestamp without settlement-period allocation for new rows",
    run() {
      const included = allocateCommission(
        commissionFee(1400, {
          reportingDateSource: "transaction_posted_timestamp"
        }),
        range("2026-07-14", "2026-07-14")
      );
      const excluded = allocateCommission(
        commissionFee(1400, {
          reportingDateSource: "transaction_posted_timestamp"
        }),
        range("2026-07-05", "2026-07-07")
      );

      assert.equal(included.fee?.amount, 1400);
      assert.equal(included.diagnostic.fallback, false);
      assert.equal(included.diagnostic.missingPeriodMetadata, false);
      assert.equal(excluded.fee, null);
      assert.equal(excluded.diagnostic.allocatedCommissionIncluded, 0);
    }
  },
  {
    name: "UTC date values do not shift the selected calendar day",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        {
          from: new Date("2026-07-05T12:00:00.000Z"),
          to: new Date("2026-07-05T22:00:00.000Z")
        }
      );

      assert.equal(result.fee?.amount, 100);
      assert.equal(result.diagnostic.selectedRangeStart, "2026-07-05");
      assert.equal(result.diagnostic.selectedRangeEnd, "2026-07-05");
    }
  },
  {
    name: "stores diagnostic metadata on included commission rows",
    run() {
      const result = allocateCommission(
        commissionFee(1400),
        range("2026-07-05", "2026-07-07")
      );

      assert.ok(result.fee);
      const diagnostic = getSettlementCommissionDiagnostic(result.fee);
      assert.equal(diagnostic?.originalCommissionAmount, 1400);
      assert.equal(diagnostic?.allocatedCommissionIncluded, 300);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function allocateCommission(fee, dateRange) {
  return prepareSettlementDerivedCommissionForDateRange(fee, dateRange);
}

function commissionFee(amount, metadataOverrides = {}) {
  return {
    marketplace: "walmart",
    sellerSku: "SKU-1",
    parentSku: "PARENT-1",
    feeType: "commission",
    amount,
    postedAt: new Date("2026-07-14T12:00:00.000Z"),
    metadata: {
      source: "walmart_payments_new",
      periodStartDate: "2026-07-01",
      periodEndDate: "2026-07-14",
      ...metadataOverrides
    }
  };
}

function range(from, to) {
  return {
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T23:59:59.999Z`)
  };
}
