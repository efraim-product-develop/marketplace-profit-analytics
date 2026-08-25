import assert from "node:assert/strict";
import { validateCogsRows } from "../src/lib/cogs-import.ts";

const tests = [
  {
    name: "accepts minimal COGS rows and derives the batch from effective date",
    run() {
      const results = validateCogsRows([
        {
          rowNumber: 2,
          sku: "SKU-1",
          effective_date: "2026-01-01",
          unit_cogs: "4.25"
        }
      ]);

      assert.equal(results.length, 1);
      assert.equal(results[0].errors.length, 0);
      assert.equal(results[0].row?.sku, "SKU-1");
      assert.equal(results[0].row?.shipmentId, "manual-cogs-2026-01-01");
      assert.equal(results[0].row?.unitCost, 4.25);
    }
  },
  {
    name: "rejects duplicate SKU and effective date rows inside one COGS file",
    run() {
      const results = validateCogsRows([
        {
          rowNumber: 2,
          sku: "SKU-1",
          effective_date: "2026-01-01",
          unit_cogs: "4.25"
        },
        {
          rowNumber: 3,
          sku: "sku-1",
          effective_date: "2026-01-01",
          unit_cogs: "5.00"
        }
      ]);

      assert.equal(results[0].errors.length, 0);
      assert.match(results[1].errors.join(" "), /Duplicate row for sku \+ effective_date/);
    }
  },
  {
    name: "keeps different effective dates as separate historical COGS rows",
    run() {
      const results = validateCogsRows([
        {
          rowNumber: 2,
          sku: "SKU-1",
          effective_date: "2026-01-01",
          unit_cogs: "4.25"
        },
        {
          rowNumber: 3,
          sku: "SKU-1",
          effective_date: "2026-02-01",
          unit_cogs: "5.00"
        }
      ]);

      assert.equal(results.every((result) => result.errors.length === 0), true);
      assert.deepEqual(
        results.map((result) => result.row?.effectiveDate.slice(0, 10)),
        ["2026-01-01", "2026-02-01"]
      );
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}
