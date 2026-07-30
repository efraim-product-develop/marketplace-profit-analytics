import assert from "node:assert/strict";
import {
  SettlementPeriodAllocator,
  toCents
} from "../src/server/pnl/settlement-period-allocator.ts";

const allocator = new SettlementPeriodAllocator();

const tests = [
  {
    name: "allocates a 14-day positive amount evenly",
    run() {
      const result = allocator.allocateForRange(
        settlement(1400, "2026-01-01", "2026-01-14"),
        range("2026-01-01", "2026-01-14")
      );

      assert.equal(result.amount, 1400);
      assert.equal(result.dayCount, 14);
      assert.equal(result.overlapDayCount, 14);
      assert.equal(result.applied, true);
    }
  },
  {
    name: "allocates a 14-day negative amount evenly",
    run() {
      const result = allocator.allocateForRange(
        settlement(-1400, "2026-01-01", "2026-01-14"),
        range("2026-01-01", "2026-01-07")
      );

      assert.equal(result.amount, -700);
    }
  },
  {
    name: "allocates partial overlap",
    run() {
      const result = allocator.allocateForRange(
        settlement(1400, "2026-01-01", "2026-01-14"),
        range("2026-01-04", "2026-01-10")
      );

      assert.equal(result.amount, 700);
    }
  },
  {
    name: "allocates week overlap",
    run() {
      const result = allocator.allocateForRange(
        settlement(2800, "2026-01-05", "2026-01-18"),
        range("2026-01-05", "2026-01-11")
      );

      assert.equal(result.amount, 1400);
    }
  },
  {
    name: "allocates month-boundary overlap",
    run() {
      const january = allocator.allocateForRange(
        settlement(1400, "2026-01-25", "2026-02-07"),
        range("2026-01-01", "2026-01-31")
      );
      const february = allocator.allocateForRange(
        settlement(1400, "2026-01-25", "2026-02-07"),
        range("2026-02-01", "2026-02-28")
      );

      assert.equal(january.amount, 700);
      assert.equal(february.amount, 700);
    }
  },
  {
    name: "allocates quarter-boundary overlap",
    run() {
      const q1 = allocator.allocateForRange(
        settlement(1400, "2026-03-25", "2026-04-07"),
        range("2026-01-01", "2026-03-31")
      );
      const q2 = allocator.allocateForRange(
        settlement(1400, "2026-03-25", "2026-04-07"),
        range("2026-04-01", "2026-06-30")
      );

      assert.equal(q1.amount, 700);
      assert.equal(q2.amount, 700);
    }
  },
  {
    name: "allocates year-boundary overlap",
    run() {
      const currentYear = allocator.allocateForRange(
        settlement(1400, "2025-12-25", "2026-01-07"),
        range("2026-01-01", "2026-12-31")
      );

      assert.equal(currentYear.amount, 700);
    }
  },
  {
    name: "supports one-day settlement period",
    run() {
      const result = allocator.allocateForRange(
        settlement(123.45, "2026-01-05", "2026-01-05"),
        range("2026-01-05", "2026-01-05")
      );

      assert.equal(result.amount, 123.45);
      assert.equal(result.dayCount, 1);
    }
  },
  {
    name: "reconciles exact cents with deterministic earliest-day remainder",
    run() {
      const daily = allocator.getDailyAllocations(
        toCents(100),
        day("2026-01-01"),
        day("2026-01-03")
      );

      assert.deepEqual(daily, [3334, 3333, 3333]);
      assert.equal(daily.reduce((sum, cents) => sum + cents, 0), 10000);
    }
  },
  {
    name: "falls back to posting date for invalid or missing period dates",
    run() {
      const included = allocator.allocateForRange(
        {
          amount: 50,
          settlementPeriodStart: null,
          settlementPeriodEnd: null,
          postingDate: "2026-01-05"
        },
        range("2026-01-01", "2026-01-31")
      );
      const excluded = allocator.allocateForRange(
        {
          amount: 50,
          settlementPeriodStart: "2026-02-10",
          settlementPeriodEnd: "2026-02-01",
          postingDate: "2026-02-05"
        },
        range("2026-01-01", "2026-01-31")
      );

      assert.equal(included.amount, 50);
      assert.equal(included.fallback, true);
      assert.equal(included.missingPeriodMetadata, true);
      assert.equal(excluded.amount, 0);
      assert.equal(excluded.fallback, true);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function settlement(amount, start, end) {
  return {
    amount,
    settlementPeriodStart: start,
    settlementPeriodEnd: end,
    postingDate: end
  };
}

function range(from, to) {
  return {
    from: new Date(`${from}T00:00:00.000Z`),
    to: new Date(`${to}T23:59:59.999Z`)
  };
}

function day(value) {
  return new Date(`${value}T00:00:00.000Z`);
}
