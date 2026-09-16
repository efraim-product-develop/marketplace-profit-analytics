import assert from "node:assert/strict";
import {
  resolveSettlementFeeOrderLineMatches,
  walmartSettlementImportParsers
} from "../src/server/connectors/walmart/settlements.ts";

const parser = walmartSettlementImportParsers[0];
const headers = [
  "Period Start Date",
  "Period End Date",
  "Total Payable",
  "Currency",
  "Transaction Key",
  "Transaction Posted Timestamp",
  "Transaction Type",
  "Transaction Description",
  "Customer Order #",
  "Customer Order line #",
  "Purchase Order #",
  "Purchase Order line #",
  "Amount",
  "Amount Type",
  "Ship Qty",
  "Commission Rate",
  "Base Commission Rate",
  "Transaction Reason Description",
  "Partner Item Id",
  "Partner GTIN",
  "Partner Item Name",
  "Product Tax Code",
  "Ship to State",
  "Ship to City",
  "Ship to Zipcode",
  "Contract Category",
  "Product Type",
  "Commission Rule",
  "Shipping Method",
  "Fulfillment Type",
  "Fulfillment Details",
  "Payment Date"
];

const rows = [
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    totalPayable: "91108.89",
    paymentDate: "01/17/2026",
    postedAt: "01/15/2026",
    transactionType: "PaymentSummary",
    description: "Deposited in PAYONEER account"
  }),
  settlementRow({
    transactionKey: "sale-key-1",
    postedAt: "01/04/2026",
    transactionType: "Sale",
    description: "Purchase",
    amount: "25.00",
    amountType: "Product Price"
  }),
  settlementRow({
    postedAt: "01/04/2026",
    transactionType: "Adjustment",
    description: "WFS Fulfillment fee",
    amount: "-7.35",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/01/2026",
    postedAt: "01/04/2026",
    transactionType: "Campaigns",
    description: "SEM Marketing",
    amount: "-791.40",
    amountType: "SEM Marketing Fee",
    purchaseOrder: "",
    purchaseOrderLine: "",
    sku: ""
  }),
  settlementRow({
    postedAt: "01/04/2026",
    transactionType: "Sale",
    description: "Commission",
    amount: "-2.15",
    amountType: "Commission on Product"
  }),
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    postedAt: "01/15/2026",
    transactionType: "Refund",
    description: "Refund sales",
    amount: "-22.47",
    amountType: "Product Price"
  }),
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    postedAt: "01/15/2026",
    transactionType: "Refund",
    description: "Refunded Shipping",
    amount: "-3.99",
    amountType: "Shipping"
  }),
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    postedAt: "01/15/2026",
    transactionType: "Refund",
    description: "Walmart return shipping charge",
    amount: "-1.25",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    postedAt: "01/15/2026",
    transactionType: "Adjustment",
    description: "WFS Refund",
    amount: "88.66",
    amountType: "WFS Inventory Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Storage Fee",
    amount: "-9.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Inventory Transfer Fee",
    amount: "-4.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Inbound Transportation Fee",
    amount: "-5.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Long Term Storage Fee",
    amount: "-6.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Prep Service Fee",
    amount: "-7.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Inventory Disposal Order",
    amount: "-8.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Adjustment",
    description: "Review Accelerator",
    amount: "-3.00",
    amountType: "Review Accelerator"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Adjustment",
    description: "WFS Found Inventory",
    amount: "12.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Adjustment",
    description: "WFS Damage in Warehouse",
    amount: "-13.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Adjustment",
    description: "WFS Lost Inventory",
    amount: "-14.00",
    amountType: "Fee/Reimbursement"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Sale",
    description: "Seller promotion",
    amount: "-2.00",
    amountType: "Promo Code"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Sale",
    description: "Product tax",
    amount: "1.23",
    amountType: "Product Tax"
  })
];
const csv = [headers, ...rows]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");

const context = {
  marketplace: "walmart",
  importKind: "settlements",
  fileName: "payments-new.csv",
  buffer: Buffer.from(csv),
  options: {}
};

assert.equal(parser.detect(context), 100);

const parsed = parser.parse(context);
const categories = parsed.summary.otherWalmartFeesCategoryBreakdown;

assert.equal(parsed.reportType, "walmart_payments_new");
assert.equal(parsed.allowDuplicateFileImport, true);
assert.equal(parsed.rowCount, 21);
assert.equal(parsed.validCount, 17);
assert.equal(parsed.rejectedCount, 0);
assert.equal(parsed.summary.feeRows, 15);
assert.equal(parsed.summary.advertisingRows, 1);
assert.equal(parsed.summary.refundRows, 1);
assert.equal(parsed.summary.semAdvertisingTotal, 791.4);
assert.equal(parsed.summary.commissionFeeTotal, 2.15);
assert.equal(parsed.summary.fulfillmentFeeTotal, 7.35);
assert.equal(parsed.summary.returnFeeTotal, 1.25);
assert.equal(parsed.summary.refundSalesTotal, 22.47);
assert.equal(parsed.summary.semRowsExcluded, 0);
assert.equal(parsed.summary.semAdvertisingExcludedTotal, 0);
assert.equal(parsed.summary.settlementSaleRowsSkipped, 1);
assert.equal(parsed.summary.taxRowsSkipped, 1);
assert.equal(parsed.summary.unsupportedFinancialRows, 1);
assert.equal(parsed.summary.unsupportedFinancialTotal, -2);
assert.equal(parsed.summary.otherWalmartFeesChargesTotal, 74.24);
assert.equal(parsed.summary.otherWalmartFeesCreditsTotal, 100.66);
assert.equal(parsed.summary.otherWalmartFeesNetTotal, -26.42);
assert.equal(categoryTotal(categories, "wfs_storage_fee"), 9);
assert.equal(categoryTotal(categories, "wfs_inventory_transfer_fee"), 4);
assert.equal(categoryTotal(categories, "wfs_inbound_transportation_fee"), 5);
assert.equal(categoryTotal(categories, "wfs_long_term_storage_fee"), 6);
assert.equal(categoryTotal(categories, "wfs_prep_service_fee"), 7);
assert.equal(categoryTotal(categories, "wfs_inventory_disposal_fee"), 8);
assert.equal(categoryTotal(categories, "review_accelerator"), 3);
assert.equal(categoryTotal(categories, "wfs_found_inventory"), -12);
assert.equal(categoryTotal(categories, "wfs_damage_in_warehouse"), 13);
assert.equal(categoryTotal(categories, "wfs_lost_inventory"), 14);
assert.equal(categoryTotal(categories, "refunded_shipping"), 3.99);
assert.equal(parsed.summary.paymentSummaryTotalPayable, 91108.89);
assert.equal(parsed.summary.paymentSummaryPeriodStart, "2026-01-01T00:00:00.000Z");
assert.equal(parsed.summary.paymentSummaryPeriodEnd, "2026-01-14T00:00:00.000Z");
assert.equal(parsed.summary.settlementPayoutAmount, 91108.89);
assert.equal(parsed.summary.settlementPayoutPeriodStart, "2026-01-01T00:00:00.000Z");
assert.equal(parsed.summary.settlementPayoutPeriodEnd, "2026-01-14T00:00:00.000Z");
assert.equal(parsed.summary.settlementPayoutDate, "2026-01-17T00:00:00.000Z");
assert.equal(parsed.summary.settlementPayoutDateSource, "Payment Date");
assert.match(parsed.summary.settlementPayoutReference, /^walmart_payments_new::2026-01-01::2026-01-14::usd::91108.89$/);
assert.equal(parsed.summary.inheritedPaymentSummaryPeriodRows, 12);
assert.equal(parsed.summary.missingPeriodRows, 0);
const fulfillmentPreview = parsed.previewRows.find((row) => row.normalizedData?.feeType === "fulfillment_fee");
const semPreview = parsed.previewRows.find((row) => row.normalizedData?.feeType === "seller_center_sem");
const commissionPreview = parsed.previewRows.find((row) => row.normalizedData?.feeType === "commission");
const refundPreview = parsed.previewRows.find((row) => row.normalizedData?.target === "refund");
const refundedShippingPreview = parsed.previewRows.find(
  (row) => row.normalizedData?.adjustmentCategory === "refunded_shipping"
);
const returnFeePreview = parsed.previewRows.find((row) => row.normalizedData?.feeType === "return_fee");
const wfsRefundPreview = parsed.previewRows.find((row) => row.normalizedData?.adjustmentCategory === "wfs_refund");

assert.equal(fulfillmentPreview?.normalizedData?.periodStartDate, "2026-01-01");
assert.equal(fulfillmentPreview?.normalizedData?.periodEndDate, "2026-01-14");
assert.equal(fulfillmentPreview?.normalizedData?.periodDateSource, "payment_summary");
assert.equal(semPreview?.normalizedData?.target, "advertising");
assert.equal(semPreview?.normalizedData?.pnlReportingDate, "2026-01-04");
assert.equal(commissionPreview?.normalizedData?.periodDateSource, "payment_summary");
assert.equal(refundPreview?.normalizedData?.target, "refund");
assert.equal(refundedShippingPreview?.normalizedData?.attributionScope, "marketplace");
assert.equal(returnFeePreview?.normalizedData?.feeType, "return_fee");
assert.equal(wfsRefundPreview?.normalizedData?.adjustmentCategory, "wfs_refund");

const sameReport = parser.parse({ ...context, buffer: Buffer.from(csv) });
assert.equal(sameReport.summary.settlementPayoutReference, parsed.summary.settlementPayoutReference);

const correctedAmountCsv = [
  headers,
  settlementRow({
    transactionKey: "corrected-commission-1",
    postedAt: "01/04/2026",
    transactionType: "Sale",
    description: "Commission",
    amount: "-2.15",
    amountType: "Commission on Product"
  })
]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
const revisedCorrectedAmountCsv = [
  headers,
  settlementRow({
    transactionKey: "corrected-commission-1",
    postedAt: "01/04/2026",
    transactionType: "Sale",
    description: "Commission",
    amount: "-3.15",
    amountType: "Commission on Product"
  })
]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
const originalCorrection = parser.parse({ ...context, buffer: Buffer.from(correctedAmountCsv) });
const revisedCorrection = parser.parse({ ...context, buffer: Buffer.from(revisedCorrectedAmountCsv) });
const originalCorrectionRow = getPayloadRows(originalCorrection)[0];
const revisedCorrectionRow = getPayloadRows(revisedCorrection)[0];

assert.equal(originalCorrectionRow.duplicateKey, revisedCorrectionRow.duplicateKey);
assert.equal(originalCorrectionRow.amount, -2.15);
assert.equal(revisedCorrectionRow.amount, -3.15);

const zeroPayoutCsv = [headers, settlementRow({
  periodStartDate: "02/01/2026",
  periodEndDate: "02/14/2026",
  totalPayable: "0.00",
  postedAt: "02/15/2026",
  transactionType: "PaymentSummary",
  description: "Deposited in PAYONEER account"
})]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
const zeroPayout = parser.parse({ ...context, buffer: Buffer.from(zeroPayoutCsv) });
assert.equal(zeroPayout.summary.settlementPayoutAmount, 0);
assert.equal(zeroPayout.summary.settlementPayoutDate, null);
assert.notEqual(zeroPayout.summary.settlementPayoutReference, parsed.summary.settlementPayoutReference);

const negativePayoutCsv = [headers, settlementRow({
  periodStartDate: "03/01/2026",
  periodEndDate: "03/14/2026",
  totalPayable: "-10.50",
  postedAt: "03/15/2026",
  transactionType: "PaymentSummary",
  description: "Deposited in PAYONEER account"
})]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
const negativePayout = parser.parse({ ...context, buffer: Buffer.from(negativePayoutCsv) });
assert.equal(negativePayout.summary.settlementPayoutAmount, -10.5);

const unmatchedFeeDateCsv = [
  headers,
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    postedAt: "01/15/2026",
    transactionType: "PaymentSummary",
    description: "Deposited in PAYONEER account"
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Service Fee",
    description: "WFS Storage Fee",
    amount: "-9.00",
    amountType: "Fee/Reimbursement",
    purchaseOrder: "",
    purchaseOrderLine: "",
    customerOrder: "",
    customerOrderLine: "",
    sku: ""
  }),
  settlementRow({
    postedAt: "01/16/2026",
    transactionType: "Sale",
    description: "Commission",
    amount: "-2.15",
    amountType: "Commission on Product"
  })
]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
const unmatchedFeeDateReport = parser.parse({
  ...context,
  buffer: Buffer.from(unmatchedFeeDateCsv)
});
const unmatchedFeeRows = getPayloadRows(unmatchedFeeDateReport);
const storageFee = unmatchedFeeRows.find((row) => row.adjustmentCategory === "wfs_storage_fee");
const matchedCommission = unmatchedFeeRows.find((row) => row.feeType === "commission");
assert.equal(storageFee.reportingDate.slice(0, 10), "2026-01-16");
assert.equal(storageFee.reportingDateSource, "transaction_posted_timestamp");
assert.equal(storageFee.postedAt.slice(0, 10), "2026-01-16");
assert.equal(matchedCommission.reportingDate.slice(0, 10), "2026-01-16");
assert.equal(matchedCommission.reportingDateSource, "transaction_posted_timestamp");

const feeLinkingCsv = [
  headers,
  settlementRow({
    periodStartDate: "01/01/2026",
    periodEndDate: "01/14/2026",
    postedAt: "01/15/2026",
    transactionType: "PaymentSummary",
    description: "Deposited in PAYONEER account"
  }),
  settlementRow({
    transactionKey: "matched-commission",
    postedAt: "01/10/2026",
    transactionType: "Sale",
    description: "Commission",
    amount: "-2.15",
    amountType: "Commission on Product",
    purchaseOrder: "PO-123",
    purchaseOrderLine: "1",
    sku: "PO-SKU"
  }),
  settlementRow({
    transactionKey: "ambiguous-commission",
    postedAt: "01/10/2026",
    transactionType: "Sale",
    description: "Commission",
    amount: "-1.11",
    amountType: "Commission on Product",
    purchaseOrder: "PO-456",
    purchaseOrderLine: "1",
    sku: "DUP-SKU"
  }),
  settlementRow({
    transactionKey: "unmatched-fulfillment",
    postedAt: "01/11/2026",
    transactionType: "Adjustment",
    description: "WFS Fulfillment fee",
    amount: "-7.35",
    amountType: "Fee/Reimbursement",
    purchaseOrder: "PO-999",
    purchaseOrderLine: "9",
    sku: "SETTLEMENT-SKU"
  })
]
  .map((row) => row.map(csvCell).join(","))
  .join("\n");
const feeLinkingReport = parser.parse({
  ...context,
  buffer: Buffer.from(feeLinkingCsv)
});
const feeLinkRows = getPayloadRows(feeLinkingReport).filter(
  (row) => row.target === "marketplace_fee"
);
const feeLinks = resolveSettlementFeeOrderLineMatches(feeLinkRows, [
  {
    id: "order-item-1",
    orderId: "order-1",
    sellerSku: "PO-SKU",
    purchaseOrderNumber: "PO-123",
    purchaseOrderLineNumber: "1"
  },
  {
    id: "order-item-2",
    orderId: "order-2",
    sellerSku: "DUP-SKU",
    purchaseOrderNumber: "PO-456",
    purchaseOrderLineNumber: "1"
  },
  {
    id: "order-item-3",
    orderId: "order-3",
    sellerSku: "DUP-SKU",
    purchaseOrderNumber: "PO-456",
    purchaseOrderLineNumber: "2"
  }
]);
const matchedFeeLink = feeLinks.get(
  feeLinkRows.find((row) => row.transactionKey === "matched-commission").duplicateKey
);
const ambiguousFeeLink = feeLinks.get(
  feeLinkRows.find((row) => row.transactionKey === "ambiguous-commission").duplicateKey
);
const unmatchedFeeLink = feeLinks.get(
  feeLinkRows.find((row) => row.transactionKey === "unmatched-fulfillment").duplicateKey
);
assert.equal(matchedFeeLink.matchStatus, "matched");
assert.equal(matchedFeeLink.orderId, "order-1");
assert.equal(matchedFeeLink.orderItemId, "order-item-1");
assert.equal(matchedFeeLink.sellerSku, "PO-SKU");
assert.equal(matchedFeeLink.reportingDate.slice(0, 10), "2026-01-10");
assert.equal(matchedFeeLink.productAttributionReliable, true);
assert.equal(ambiguousFeeLink.matchStatus, "ambiguous");
assert.equal(ambiguousFeeLink.orderId, null);
assert.equal(ambiguousFeeLink.orderItemId, null);
assert.equal(ambiguousFeeLink.sellerSku, null);
assert.equal(ambiguousFeeLink.productAttributionReliable, false);
assert.equal(unmatchedFeeLink.matchStatus, "not_found");
assert.equal(unmatchedFeeLink.orderId, null);
assert.equal(unmatchedFeeLink.orderItemId, null);
assert.equal(unmatchedFeeLink.sellerSku, null);
assert.equal(unmatchedFeeLink.reportingDate.slice(0, 10), "2026-01-11");
assert.equal(unmatchedFeeLink.reportingDateSource, "transaction_posted_timestamp");
assert.equal(unmatchedFeeLink.productAttributionReliable, false);

console.log("ok - parses Walmart Payments New settlement financial categories safely");

function settlementRow({
  periodStartDate = "",
  periodEndDate = "",
  totalPayable = "",
  currency = "USD",
  transactionKey = "",
  postedAt = "",
  transactionType = "",
  description = "",
  customerOrder = "200015034663668",
  customerOrderLine = "4",
  purchaseOrder = "129100357863767",
  purchaseOrderLine = "4",
  amount = "",
  amountType = "",
  shipQuantity = "",
  sku = "SKU-1",
  itemName = "Sample item",
  fulfillmentType = "Walmart-fulfilled(WFS)",
  paymentDate = ""
} = {}) {
  return [
    periodStartDate,
    periodEndDate,
    totalPayable,
    currency,
    transactionKey,
    postedAt,
    transactionType,
    description,
    customerOrder,
    customerOrderLine,
    purchaseOrder,
    purchaseOrderLine,
    amount,
    amountType,
    shipQuantity,
    "",
    "",
    "",
    sku,
    "",
    itemName,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    fulfillmentType,
    "",
    paymentDate
  ];
}

function categoryTotal(categories, category) {
  const line = categories.find((row) => row.category === category);
  return line?.netAmount ?? 0;
}

function getPayloadRows(report) {
  return Array.isArray(report.payload?.rows) ? report.payload.rows : [];
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
