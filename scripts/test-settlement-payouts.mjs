import assert from "node:assert/strict";
import { calculateProfitRows } from "../src/server/pnl/engine.ts";
import { sortSettlementPayoutHistoryRows } from "../src/server/settlements/payouts.ts";

{
  const rows = sortSettlementPayoutHistoryRows([
    payout("older", "2026-01-14", "2026-01-15", "2026-01-20"),
    payout("newer", "2026-02-14", null, "2026-02-20"),
    payout("middle", "2026-02-01", "2026-02-02", "2026-02-05")
  ]);

  assert.deepEqual(rows.map((row) => row.id), ["newer", "middle", "older"]);
}

{
  const rows = calculateProfitRows(
    [
      {
        marketplace: "walmart",
        salesSource: "po_report",
        sellerSku: "SKU-1",
        quantity: 1,
        itemRevenue: 100,
        cogsTotal: 30,
        fees: [
          {
            marketplace: "walmart",
            feeType: "commission",
            amount: -10,
            metadata: { amountSignConvention: "negative_expense_positive_credit" }
          }
        ]
      }
    ],
    "sellerSku"
  );

  assert.equal(rows[0].netProfit, 60);
}

console.log("ok - settlement payout history sorting and profit separation work");

function payout(
  id,
  settlementPeriodEnd,
  payoutDate,
  importedAt
) {
  return {
    id,
    settlementPeriodEnd: settlementPeriodEnd ? new Date(`${settlementPeriodEnd}T00:00:00.000Z`) : null,
    payoutDate: payoutDate ? new Date(`${payoutDate}T00:00:00.000Z`) : null,
    importedAt: new Date(`${importedAt}T00:00:00.000Z`)
  };
}
