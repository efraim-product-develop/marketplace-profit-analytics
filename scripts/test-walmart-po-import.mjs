import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { walmartPoReportParser } from "../src/server/connectors/walmart/po-reports.ts";

const tests = [
  {
    name: "detects and previews Walmart PO order sales report rows",
    run() {
      const buffer = buildWorkbook([
        {
          "PO#": "119118392769067",
          "Order#": "200015034663668",
          "Order Date": "2026-07-01",
          "Line#": "1",
          UPC: "50893765001703",
          Status: "Delivered",
          "Item Description": "Inspire Adult Wet Wipes",
          Qty: "2",
          SKU: "INSJWC50-CS12",
          "Item Cost": "32.99",
          "Shipping Cost": "4.50",
          Tax: "3.21",
          Discount: "1.00",
          "Fulfillment Entity": "WFSFulfilled"
        },
        {
          "PO#": "119118392769067",
          "Order#": "200015034663668",
          "Order Date": "2026-07-01",
          "Line#": "1",
          Status: "Delivered",
          Qty: "2",
          SKU: "INSJWC50-CS12",
          "Item Cost": "32.99"
        },
        {
          "PO#": "119118392769068",
          "Order#": "200015034663669",
          "Order Date": "2026-07-01",
          "Line#": "1",
          Status: "Cancelled",
          Qty: "1",
          SKU: "CANCELLED-SKU",
          "Item Cost": "10.00"
        },
        {
          "PO#": "119118392769070",
          "Order#": "200015034663671",
          "Order Date": "2026-07-02",
          "Line#": "1",
          Status: "Delivered",
          Qty: "3",
          SKU: "THREE-UNIT-SKU",
          "Item Cost": "12.00"
        },
        {
          "PO#": "119118392769071",
          "Order#": "200015034663672",
          "Order Date": "2026-07-02",
          "Line#": "1",
          Status: "Delivered",
          Qty: "4",
          SKU: "EXTENDED-SKU",
          "Gross Sales": "80.00"
        },
        {
          "PO#": "119118392769072",
          "Order#": "200015034663673",
          "Order Date": "2026-07-03",
          "Line#": "1",
          Status: "Delivered",
          Qty: "5",
          "Cancelled Qty": "2",
          SKU: "PARTIAL-CANCEL-SKU",
          "Item Cost": "9.00"
        },
        {
          "PO#": "119118392769069",
          "Order#": "200015034663670",
          "Order Date": "2026-07-01",
          "Line#": "1",
          Status: "Delivered",
          Qty: "1",
          SKU: "",
          "Item Cost": "10.00"
        }
      ]);
      const context = {
        marketplace: "walmart",
        importKind: "sales",
        fileName: "po.xlsx",
        buffer,
        options: {}
      };

      assert.equal(walmartPoReportParser.detect(context), 100);

      const parsed = walmartPoReportParser.parse(context);
      const [
        preview,
        cancelledPreview,
        threeUnitPreview,
        extendedPreview,
        partialCancelPreview
      ] = parsed.previewRows;

      assert.equal(parsed.reportType, "walmart_po_order_sales");
      assert.equal(parsed.allowDuplicateFileImport, true);
      assert.equal(parsed.validCount, 5);
      assert.equal(parsed.rejectedCount, 2);
      assert.equal(parsed.summary.totalRowsRead, 7);
      assert.equal(parsed.summary.validRows, 5);
      assert.equal(parsed.summary.skippedDuplicateRows, 1);
      assert.equal(parsed.summary.cancelledRows, 1);
      assert.equal(parsed.summary.missingSkuRows, 1);
      assert.equal(parsed.summary.totalUnits, 12);
      assert.equal(parsed.summary.totalPoGmv, 208.98);
      assert.equal(parsed.summary.uniqueOrders, 4);
      assert.equal(parsed.summary.earliestOrderDate, "2026-07-01");
      assert.equal(parsed.summary.latestOrderDate, "2026-07-03");
      assert.equal(parsed.summary.fulfillmentBreakdown.wfs.units, 2);
      assert.equal(preview.normalizedData.purchaseOrderNumber, "119118392769067");
      assert.equal(preview.normalizedData.purchaseOrderLineNumber, "1");
      assert.equal(preview.normalizedData.customerOrderNumber, "200015034663668");
      assert.equal(preview.normalizedData.sku, "INSJWC50-CS12");
      assert.equal(preview.normalizedData.poGmv, 65.98);
      assert.equal(preview.normalizedData.priceSourceKind, "unit_price");
      assert.equal(cancelledPreview.normalizedData.cancelled, true);
      assert.equal(cancelledPreview.normalizedData.quantity, 0);
      assert.equal(cancelledPreview.normalizedData.originalQuantity, 1);
      assert.equal(cancelledPreview.normalizedData.cancelledQuantity, 1);
      assert.equal(cancelledPreview.normalizedData.poGmv, 0);
      assert.equal(cancelledPreview.normalizedData.originalPoGmv, 10);
      assert.equal(threeUnitPreview.normalizedData.quantity, 3);
      assert.equal(threeUnitPreview.normalizedData.poGmv, 36);
      assert.equal(extendedPreview.normalizedData.quantity, 4);
      assert.equal(extendedPreview.normalizedData.unitPrice, 20);
      assert.equal(extendedPreview.normalizedData.poGmv, 80);
      assert.equal(extendedPreview.normalizedData.priceSourceKind, "extended_line_amount");
      assert.equal(partialCancelPreview.normalizedData.quantity, 3);
      assert.equal(partialCancelPreview.normalizedData.originalQuantity, 5);
      assert.equal(partialCancelPreview.normalizedData.cancelledQuantity, 2);
      assert.equal(partialCancelPreview.normalizedData.poGmv, 27);
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
  XLSX.utils.book_append_sheet(workbook, worksheet, "Po Details");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
