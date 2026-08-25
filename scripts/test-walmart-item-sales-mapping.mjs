import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { walmartItemSalesMappingParser } from "../src/server/connectors/walmart/item-sales-mapping.ts";
import { normalizeMarketplaceSku } from "../src/server/sales/sku-normalization.ts";

const tests = [
  {
    name: "detects Walmart Item Sales as product mapping only",
    run() {
      const buffer = buildWorkbook([
        {
          SKU: " insjwc50-cs12 ",
          "Base Item ID": "277574957",
          "Item ID": "123456789",
          "Item Name": "Inspire Adult Wet Wipes",
          Brand: "Inspire",
          Department: "Health",
          GMV: "999.99",
          "Units Sold": "20",
          Orders: "10",
          "Refund Sales": "12.34"
        }
      ]);
      const context = {
        marketplace: "walmart",
        importKind: "inventory",
        fileName: "ItemSalesReport.csv",
        buffer,
        options: {}
      };

      assert.equal(walmartItemSalesMappingParser.detect(context), 100);

      const parsed = walmartItemSalesMappingParser.parse(context);
      const [preview] = parsed.previewRows;

      assert.equal(parsed.importKind, "inventory");
      assert.equal(parsed.reportType, "walmart_item_sales_product_mapping");
      assert.equal(parsed.validCount, 1);
      assert.equal(parsed.rejectedCount, 0);
      assert.equal(parsed.allowDuplicateFileImport, true);
      assert.equal(parsed.summary.financialDataUsedForPnl, false);
      assert.deepEqual(parsed.summary.itemSalesFinancialFieldsIgnored, [
        "GMV",
        "Orders",
        "Refund Sales",
        "Units Sold"
      ]);
      assert.equal(preview.normalizedData.sku, "INSJWC50-CS12");
      assert.equal(preview.normalizedData.parentSku, "277574957");
      assert.equal(preview.normalizedData.itemId, "123456789");
      assert.equal(preview.normalizedData.financialDataUsedForPnl, false);
    }
  },
  {
    name: "skips duplicate SKU mapping rows and missing parent rows",
    run() {
      const buffer = buildWorkbook([
        {
          SKU: "SKU-A",
          "Base Item ID": "PARENT-A",
          "Item ID": "1",
          "Item Name": "Product A",
          GMV: "100"
        },
        {
          SKU: " sku-a ",
          "Base Item ID": "PARENT-B",
          "Item ID": "1",
          "Item Name": "Product A duplicate",
          GMV: "200"
        },
        {
          SKU: "SKU-B",
          "Base Item ID": "",
          "Item ID": "2",
          "Item Name": "Product B",
          GMV: "300"
        }
      ]);
      const parsed = walmartItemSalesMappingParser.parse({
        marketplace: "walmart",
        importKind: "inventory",
        fileName: "ItemSalesReport.csv",
        buffer,
        options: {}
      });

      assert.equal(parsed.validCount, 1);
      assert.equal(parsed.rejectedCount, 2);
      assert.equal(parsed.summary.duplicatesSkipped, 1);
      assert.equal(parsed.summary.invalidRows, 1);
      assert.equal(parsed.summary.parentGroupsFound, 1);
      assert.equal(parsed.previewRows[0].normalizedData.parentSku, "PARENT-A");
      assert.equal(parsed.issues.some((issue) => issue.code === "DUPLICATE_SKU_MAPPING"), true);
      assert.equal(parsed.issues.some((issue) => issue.code === "MISSING_PARENT_IDENTIFIER"), true);
    }
  },
  {
    name: "normalizes marketplace SKUs consistently",
    run() {
      assert.equal(normalizeMarketplaceSku("  abc-123  "), "ABC-123");
      assert.equal(normalizeMarketplaceSku("\uFEFFabc   123"), "ABC 123");
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

function buildWorkbook(rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Item Sales Report");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
