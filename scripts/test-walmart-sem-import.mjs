import assert from "node:assert/strict";
import { parseWalmartSellerCenterSemReport } from "../src/server/connectors/walmart/sem-advertising.ts";

const tests = [
  {
    name: "detects Walmart Seller Center SEM daily campaign report",
    run() {
      const parsed = parseWalmartSellerCenterSemReport(
        csvBuffer([
          semRow({ date: "2026-01-31", campaignName: "Nitrile gloves", campaignId: "1165910926", spend: "$6.52" }),
          semRow({ date: "2026-01-30", campaignName: "Wipes", campaignId: "1658259983", spend: "$16.49" })
        ])
      );

      assert.equal(parsed.reportType, "walmart_seller_center_sem_campaign_daily");
      assert.equal(parsed.validCount, 2);
      assert.equal(parsed.summary.detectedGrain, "daily");
      assert.equal(parsed.summary.spendField, "Spend");
      assert.equal(parsed.summary.attributedSalesField, "Sales");
      assert.equal(parsed.summary.skuAttributionAvailable, false);
      assert.equal(parsed.allowDuplicateFileImport, true);
    }
  },
  {
    name: "parses spend, attributed sales, clicks, impressions, ctr, and roas",
    run() {
      const parsed = parseWalmartSellerCenterSemReport(
        csvBuffer([
          semRow({
            date: "2026-01-31",
            campaignName: "Nitrile gloves",
            campaignId: "1165910926",
            impressions: "1,152",
            clicks: "13",
            averageCtr: "1.13%",
            spend: "$6.52",
            sales: "$8.18",
            roas: "1.25"
          })
        ])
      );

      assert.equal(parsed.summary.totalSemSpend, 6.52);
      assert.equal(parsed.summary.totalAttributedSales, 8.18);
      assert.equal(parsed.previewRows[0].normalizedData.impressions, 1152);
      assert.equal(parsed.previewRows[0].normalizedData.clicks, 13);
      assert.equal(parsed.previewRows[0].normalizedData.roas, 1.25);
    }
  },
  {
    name: "skips zero spend rows without blocking the import",
    run() {
      const parsed = parseWalmartSellerCenterSemReport(
        csvBuffer([
          semRow({ date: "2026-01-31", campaignName: "Zero spend", campaignId: "1", spend: "$0.00" }),
          semRow({ date: "2026-01-31", campaignName: "Valid spend", campaignId: "2", spend: "$10.00" })
        ])
      );

      assert.equal(parsed.validCount, 1);
      assert.equal(parsed.summary.zeroSpendRows, 1);
      assert.equal(parsed.issues[0].severity, "warning");
      assert.match(parsed.issues[0].message, /zero SEM spend/);
    }
  },
  {
    name: "aggregates duplicate campaign and date rows inside one report",
    run() {
      const parsed = parseWalmartSellerCenterSemReport(
        csvBuffer([
          semRow({
            date: "2026-01-31",
            campaignName: "Nitrile gloves",
            campaignId: "1165910926",
            impressions: "100",
            clicks: "10",
            spend: "$6.52",
            sales: "$8.18"
          }),
          semRow({
            date: "2026-01-31",
            campaignName: "Nitrile gloves",
            campaignId: "1165910926",
            impressions: "50",
            clicks: "5",
            spend: "$3.48",
            sales: "$1.82"
          })
        ])
      );

      assert.equal(parsed.validCount, 1);
      assert.equal(parsed.summary.duplicateRowsAggregated, 1);
      assert.equal(parsed.summary.duplicateGroupsAggregated, 1);
      assert.equal(parsed.summary.totalSemSpend, 10);
      assert.equal(parsed.summary.totalAttributedSales, 10);
      assert.equal(parsed.previewRows[0].normalizedData.impressions, 150);
      assert.equal(parsed.previewRows[0].normalizedData.clicks, 15);
    }
  },
  {
    name: "rejects files missing SEM campaign daily columns",
    run() {
      const parsed = parseWalmartSellerCenterSemReport(
        Buffer.from("Date,Campaign Name,Spend\n2026-01-31,Test,$10.00\n", "utf8")
      );

      assert.equal(parsed.validCount, 0);
      assert.equal(parsed.rejectedCount, 1);
      assert.match(parsed.issues[0].message, /Missing columns/);
    }
  },
  {
    name: "previews only first 50 valid rows",
    run() {
      const rows = Array.from({ length: 55 }, (_, index) =>
        semRow({
          date: "2026-01-31",
          campaignName: `Campaign ${index + 1}`,
          campaignId: String(index + 1),
          spend: "$1.00"
        })
      );
      const parsed = parseWalmartSellerCenterSemReport(csvBuffer(rows));

      assert.equal(parsed.validCount, 55);
      assert.equal(parsed.previewRows.length, 50);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function csvBuffer(rows) {
  return Buffer.from(
    [
      '"Date","Campaign Name","Campaign ID","Impressions","Clicks","Average CTR","Spend","Sales","ROAS"',
      ...rows
    ].join("\n"),
    "utf8"
  );
}

function semRow({
  date = "2026-01-31",
  campaignName = "Campaign",
  campaignId = "123",
  impressions = "1,000",
  clicks = "10",
  averageCtr = "1.00%",
  spend = "$1.00",
  sales = "$2.00",
  roas = "2.00"
} = {}) {
  return [
    date,
    campaignName,
    campaignId,
    impressions,
    clicks,
    averageCtr,
    spend,
    sales,
    roas
  ]
    .map((value) => `"${String(value).replaceAll('"', '""')}"`)
    .join(",");
}
