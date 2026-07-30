import assert from "node:assert/strict";
import { EffectiveCogsService } from "../src/server/cogs/effective-cogs.ts";

const tests = [
  {
    name: "returns newest preordered cost on or before order date",
    run() {
      const service = new EffectiveCogsService([
        costRecord("walmart", "SKU-1", "2026-02-01", 12.5),
        costRecord("walmart", "SKU-1", "2026-01-01", 10),
        costRecord("walmart", "SKU-1", "2025-12-01", 8)
      ]);

      const cogs = service.getEffectiveCogsForSku({
        marketplace: "walmart",
        sellerSku: "SKU-1",
        orderDate: date("2026-01-20")
      });

      assert.equal(cogs?.unitCost, 10);
    }
  },
  {
    name: "does not use future costs or costs from another marketplace",
    run() {
      const service = new EffectiveCogsService([
        costRecord("walmart", "SKU-1", "2026-02-01", 12.5),
        costRecord("amazon", "SKU-1", "2026-01-01", 99)
      ]);

      const cogs = service.getEffectiveCogsForSku({
        marketplace: "walmart",
        sellerSku: "SKU-1",
        orderDate: date("2026-01-20")
      });

      assert.equal(cogs, null);
    }
  },
  {
    name: "uses line-level COGS when present and does not flag missing COGS",
    run() {
      const service = new EffectiveCogsService([]);
      const results = service.getEffectiveCogsForOrderLines([
        {
          id: "line-1",
          marketplace: "walmart",
          sellerSku: "SKU-1",
          orderDate: date("2026-01-20"),
          quantity: 3,
          cogsUnit: decimalLike(7.25)
        }
      ]);

      assert.deepEqual(results.get("line-1"), {
        assignedCost: null,
        hasLineCost: true,
        unitCost: 7.25,
        cogsTotal: 21.75,
        missingCogs: false
      });
    }
  },
  {
    name: "assigns effective COGS to multiple order lines without changing totals",
    run() {
      const service = new EffectiveCogsService([
        costRecord("walmart", "SKU-2", "2026-02-01", decimalLike(5.5)),
        costRecord("walmart", "SKU-2", "2026-01-01", decimalLike(4)),
        costRecord("walmart", "SKU-3", "2026-01-15", decimalLike(2.25))
      ]);

      const results = service.getEffectiveCogsForOrderLines([
        {
          id: "old-line",
          marketplace: "walmart",
          sellerSku: "SKU-2",
          orderDate: date("2026-01-20"),
          quantity: 2,
          cogsUnit: null
        },
        {
          id: "new-line",
          marketplace: "walmart",
          sellerSku: "SKU-2",
          orderDate: date("2026-02-05"),
          quantity: 4,
          cogsUnit: null
        },
        {
          id: "missing-line",
          marketplace: "walmart",
          sellerSku: "SKU-4",
          orderDate: date("2026-02-05"),
          quantity: 1,
          cogsUnit: null
        }
      ]);

      assert.equal(results.get("old-line")?.unitCost, 4);
      assert.equal(results.get("old-line")?.cogsTotal, 8);
      assert.equal(results.get("old-line")?.missingCogs, false);
      assert.equal(results.get("new-line")?.unitCost, 5.5);
      assert.equal(results.get("new-line")?.cogsTotal, 22);
      assert.equal(results.get("new-line")?.missingCogs, false);
      assert.equal(results.get("missing-line")?.unitCost, 0);
      assert.equal(results.get("missing-line")?.cogsTotal, 0);
      assert.equal(results.get("missing-line")?.missingCogs, true);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function costRecord(marketplace, sellerSku, effectiveDate, unitCost) {
  return {
    marketplace,
    sellerSku,
    effectiveDate: date(effectiveDate),
    unitCost
  };
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function decimalLike(value) {
  return {
    toString() {
      return String(value);
    }
  };
}
