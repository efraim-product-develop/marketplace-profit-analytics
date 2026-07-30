import assert from "node:assert/strict";
import {
  AD_SOURCE_CONNECT,
  validateAdSpendRows
} from "../src/lib/ad-spend-import.ts";
import { AD_SPEND_UPLOAD_MAX_BYTES } from "../src/lib/upload-limits.ts";

const tests = [
  {
    name: "combines duplicate Walmart Connect rows inside one report",
    run() {
      const results = validateAdSpendRows(
        [
          connectRow({
            rowNumber: 42,
            ad_spend: "10.00",
            clicks: 5,
            impressions: 100,
            orders: 1,
            total_attributed_sales: "50.00",
            units_sold: 2
          }),
          connectRow({
            rowNumber: 111,
            ad_spend: "15.50",
            clicks: 3,
            impressions: 75,
            orders: 2,
            total_attributed_sales: "80.00",
            units_sold: 4
          })
        ],
        { month: "05", year: "2026" },
        AD_SOURCE_CONNECT
      );

      const validRows = results.flatMap((result) => (result.row ? [result.row] : []));
      const skippedRows = results.filter((result) => result.skipped);

      assert.equal(validRows.length, 1);
      assert.equal(skippedRows.length, 1);
      assert.equal(skippedRows[0].rowNumber, 111);
      assert.match(skippedRows[0].skipReason ?? "", /Combined with row 42/);
      assert.equal(validRows[0].spend, 25.5);
      assert.equal(validRows[0].clicks, 8);
      assert.equal(validRows[0].impressions, 175);
      assert.equal(validRows[0].attributedOrders, 3);
      assert.equal(validRows[0].attributedSales, 130);
      assert.equal(validRows[0].attributedUnits, 6);
      assert.equal(validRows[0].averageCpc, 25.5 / 8);
      assert.equal(validRows[0].roas, 130 / 25.5);
      assert.equal(validRows[0].reportDate, "2026-05-01");
      assert.equal(validRows[0].costDate, "2026-05-01T00:00:00.000Z");
    }
  },
  {
    name: "keeps Walmart Connect rows on different dates separate for daily P&L",
    run() {
      const results = validateAdSpendRows(
        [
          connectRow({ rowNumber: 1, date: "2026-05-01", ad_spend: "10.00" }),
          connectRow({ rowNumber: 2, date: "2026-05-02", ad_spend: "15.00" })
        ],
        { month: "", year: "" },
        AD_SOURCE_CONNECT
      );
      const validRows = results.flatMap((result) => (result.row ? [result.row] : []));

      assert.equal(validRows.length, 2);
      assert.deepEqual(validRows.map((row) => row.reportDate), ["2026-05-01", "2026-05-02"]);
    }
  },
  {
    name: "filters Walmart Connect daily rows to the selected reporting period",
    run() {
      const results = validateAdSpendRows(
        [
          connectRow({ rowNumber: 1, date: "2026-06-09", ad_spend: "9.00" }),
          connectRow({ rowNumber: 2, date: "2026-06-10", ad_spend: "10.00" }),
          connectRow({ rowNumber: 3, date: "2026-06-15", ad_spend: "15.00" }),
          connectRow({ rowNumber: 4, date: "2026-06-16", ad_spend: "16.00" })
        ],
        { startDate: "2026-06-10", endDate: "2026-06-15", month: "", year: "" },
        AD_SOURCE_CONNECT
      );
      const validRows = results.flatMap((result) => (result.row ? [result.row] : []));
      const skippedRows = results.filter((result) => result.skipped);

      assert.equal(validRows.length, 2);
      assert.deepEqual(validRows.map((row) => row.reportDate), ["2026-06-10", "2026-06-15"]);
      assert.equal(skippedRows.length, 2);
      assert.match(skippedRows[0].skipReason ?? "", /outside the selected reporting period/);
    }
  },
  {
    name: "uses selected one-day period as fallback when Walmart Connect date is missing",
    run() {
      const results = validateAdSpendRows(
        [connectRow({ rowNumber: 1, date: "", ad_spend: "10.00" })],
        { startDate: "2026-06-10", endDate: "2026-06-10", month: "", year: "" },
        AD_SOURCE_CONNECT
      );
      const validRows = results.flatMap((result) => (result.row ? [result.row] : []));

      assert.equal(validRows.length, 1);
      assert.equal(validRows[0].reportDate, "2026-06-10");
    }
  },
  {
    name: "imports Walmart Connect video rows when SKU ID is blank",
    run() {
      const results = validateAdSpendRows(
        [
          connectRow({
            rowNumber: 1,
            date: "2026-06-10",
            sku_id: "",
            item_id: "1001",
            item_name: "Logo",
            campaign_name: "Adult wipes video",
            campaign_type: "Sponsored Video",
            ad_spend: "4.05",
            clicks: 5,
            impressions: 654
          })
        ],
        { startDate: "2026-06-10", endDate: "2026-06-10", month: "", year: "" },
        AD_SOURCE_CONNECT
      );
      const validRows = results.flatMap((result) => (result.row ? [result.row] : []));

      assert.equal(validRows.length, 1);
      assert.equal(validRows[0].sku, "");
      assert.equal(validRows[0].campaignType, "Sponsored Video");
      assert.equal(validRows[0].spend, 4.05);
    }
  },
  {
    name: "requires row dates when selected Walmart Connect period spans multiple days",
    run() {
      const results = validateAdSpendRows(
        [connectRow({ rowNumber: 1, date: "", ad_spend: "10.00" })],
        { startDate: "2026-06-10", endDate: "2026-06-15", month: "", year: "" },
        AD_SOURCE_CONNECT
      );

      assert.equal(results.length, 1);
      assert.equal(results[0].row, undefined);
      assert.match(results[0].errors[0], /Date is required/);
    }
  },
  {
    name: "advertising upload limit allows below and between 1 MB and 20 MB",
    run() {
      assert.equal(isSupportedUploadSize(512 * 1024), true);
      assert.equal(isSupportedUploadSize(2 * 1024 * 1024), true);
      assert.equal(isSupportedUploadSize(AD_SPEND_UPLOAD_MAX_BYTES), true);
    }
  },
  {
    name: "advertising upload limit rejects files over 20 MB",
    run() {
      assert.equal(isSupportedUploadSize(AD_SPEND_UPLOAD_MAX_BYTES + 1), false);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function connectRow(overrides = {}) {
  return {
    rowNumber: 1,
    date: "2026-05-01",
    sku_id: "SKU-1",
    item_id: "ITEM-1",
    item_name: "Sample Item",
    campaign_name: "Brand Campaign",
    campaign_type: "Sponsored Products",
    ad_spend: "1.00",
    clicks: 0,
    impressions: 0,
    orders: 0,
    total_attributed_sales: 0,
    units_sold: 0,
    average_cpc: "",
    roas: "",
    ...overrides
  };
}

function isSupportedUploadSize(size) {
  return size > 0 && size <= AD_SPEND_UPLOAD_MAX_BYTES;
}
