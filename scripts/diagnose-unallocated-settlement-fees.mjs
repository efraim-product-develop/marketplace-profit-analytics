import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = parseArgs(process.argv.slice(2));
const marketplace = args.marketplace ?? "walmart";
const from = parseDateArg(args.from, "from");
const to = parseDateArg(args.to, "to");
const limit = Number.parseInt(args.limit ?? "80", 10);
const CHUNK_SIZE = 500;

try {
  await main();
} finally {
  await prisma.$disconnect();
}

async function main() {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true }
  });

  if (!organization) {
    throw new Error("No organization found.");
  }

  const fees = await prisma.marketplaceFee.findMany({
    where: {
      organizationId: organization.id,
      marketplace,
      feeType: { in: ["commission", "fulfillment_fee"] },
      postedAt: { gte: from, lte: to },
      orderItemId: null
    },
    orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      feeType: true,
      feeAmount: true,
      sellerSku: true,
      postedAt: true,
      metadata: true
    }
  });

  const settlementRows = fees
    .map(normalizeFee)
    .filter((row) => row.metadata.source === "walmart_payments_new");
  const orderItems = await getCandidateOrderItems({
    organizationId: organization.id,
    marketplace,
    rows: settlementRows
  });
  const indexes = buildOrderItemIndexes(orderItems);
  const diagnostics = settlementRows.map((row) => diagnoseRow(row, indexes));
  const summary = summarize(diagnostics);
  const reportPath = writeReport({
    organization,
    marketplace,
    from,
    to,
    summary,
    diagnostics,
    limit: Number.isFinite(limit) ? limit : 80
  });

  console.log("Unallocated settlement fee diagnostic complete.");
  console.table({
    organization: organization.name,
    marketplace,
    from: formatDate(from),
    to: formatDate(to),
    unallocatedRows: diagnostics.length,
    unallocatedCommission: summary.amounts.commission,
    unallocatedFulfillment: summary.amounts.fulfillment,
    safePoSkuFallbackRows: summary.reasons.safePoSkuFallback,
    safeCustomerSkuFallbackRows: summary.reasons.safeCustomerSkuFallback,
    poLineMismatchRows: summary.reasons.poLineMismatch,
    skuExistsButOrderMissingRows: summary.reasons.skuOnly,
    poNotImportedRows: summary.reasons.poNotImported,
    missingReferenceRows: summary.reasons.missingReference,
    ambiguousRows: summary.reasons.ambiguous,
    report: reportPath
  });

  console.log("Top diagnostic rows:");
  console.table(
    diagnostics.slice(0, Number.isFinite(limit) ? limit : 80).map((row) => ({
      feeType: row.feeType,
      expense: row.expenseAmount,
      postedAt: row.postedAt,
      po: row.purchaseOrderNumber ?? "",
      poLine: row.purchaseOrderLineNumber ?? "",
      customerOrder: row.customerOrderNumber ?? "",
      sku: row.sellerSku ?? "",
      currentMatch: row.currentMatchStatus ?? "",
      reason: row.reason,
      exactPoLine: row.matchCounts.exactPoLine,
      poSku: row.matchCounts.poSku,
      customerSku: row.matchCounts.customerSku
    }))
  );
}

async function getCandidateOrderItems({ organizationId, marketplace, rows }) {
  const purchaseOrderNumbers = uniqueStrings(rows.map((row) => row.purchaseOrderNumber));
  const customerOrderNumbers = uniqueStrings(rows.map((row) => row.customerOrderNumber));
  const sellerSkus = uniqueStrings(rows.map((row) => row.sellerSku));
  const byId = new Map();

  for (const chunk of chunkArray(purchaseOrderNumbers, CHUNK_SIZE)) {
    await collectOrderItems(byId, {
      organizationId,
      marketplace,
      purchaseOrderNumber: { in: chunk }
    });
  }

  for (const chunk of chunkArray(customerOrderNumbers, CHUNK_SIZE)) {
    await collectOrderItems(byId, {
      organizationId,
      marketplace,
      customerOrderNumber: { in: chunk }
    });
  }

  for (const chunk of chunkArray(sellerSkus, CHUNK_SIZE)) {
    await collectOrderItems(byId, {
      organizationId,
      marketplace,
      sellerSku: { in: chunk }
    });
  }

  return Array.from(byId.values());
}

async function collectOrderItems(byId, where) {
  const rows = await prisma.salesOrderItem.findMany({
    where,
    select: {
      id: true,
      orderId: true,
      sellerSku: true,
      parentSku: true,
      purchaseOrderNumber: true,
      purchaseOrderLineNumber: true,
      customerOrderNumber: true,
      customerOrderLineNumber: true,
      poReportLineNumber: true,
      poReportFlids: true,
      poItemId: true,
      poProductName: true,
      poFulfillmentType: true,
      poOrderStatus: true,
      quantity: true,
      itemRevenue: true
    }
  });

  for (const row of rows) {
    byId.set(row.id, row);
  }
}

function buildOrderItemIndexes(orderItems) {
  const indexes = {
    exactPoLine: new Map(),
    poSku: new Map(),
    poOnly: new Map(),
    exactCustomerLine: new Map(),
    customerSku: new Map(),
    customerOnly: new Map(),
    skuOnly: new Map()
  };

  for (const item of orderItems) {
    addIndex(indexes.exactPoLine, buildKey(item.purchaseOrderNumber, item.purchaseOrderLineNumber), item);
    addIndex(indexes.poSku, buildKey(item.purchaseOrderNumber, item.sellerSku), item);
    addIndex(indexes.poOnly, normalizeKeyPart(item.purchaseOrderNumber), item);
    addIndex(
      indexes.exactCustomerLine,
      buildKey(item.customerOrderNumber, item.customerOrderLineNumber),
      item
    );
    addIndex(indexes.customerSku, buildKey(item.customerOrderNumber, item.sellerSku), item);
    addIndex(indexes.customerOnly, normalizeKeyPart(item.customerOrderNumber), item);
    addIndex(indexes.skuOnly, normalizeKeyPart(item.sellerSku), item);
  }

  return indexes;
}

function diagnoseRow(row, indexes) {
  const exactPoLineMatches = readMatches(
    indexes.exactPoLine,
    buildKey(row.purchaseOrderNumber, row.purchaseOrderLineNumber)
  );
  const poSkuMatches = readMatches(indexes.poSku, buildKey(row.purchaseOrderNumber, row.sellerSku));
  const poOnlyMatches = readMatches(indexes.poOnly, normalizeKeyPart(row.purchaseOrderNumber));
  const exactCustomerLineMatches = readMatches(
    indexes.exactCustomerLine,
    buildKey(row.customerOrderNumber, row.customerOrderLineNumber)
  );
  const customerSkuMatches = readMatches(
    indexes.customerSku,
    buildKey(row.customerOrderNumber, row.sellerSku)
  );
  const customerOnlyMatches = readMatches(indexes.customerOnly, normalizeKeyPart(row.customerOrderNumber));
  const skuOnlyMatches = readMatches(indexes.skuOnly, normalizeKeyPart(row.sellerSku));
  const matchCounts = {
    exactPoLine: exactPoLineMatches.length,
    poSku: poSkuMatches.length,
    poOnly: poOnlyMatches.length,
    exactCustomerLine: exactCustomerLineMatches.length,
    customerSku: customerSkuMatches.length,
    customerOnly: customerOnlyMatches.length,
    skuOnly: skuOnlyMatches.length
  };
  const reason = getReason(row, matchCounts);
  const bestCandidate =
    exactPoLineMatches[0] ??
    (poSkuMatches.length === 1 ? poSkuMatches[0] : null) ??
    (customerSkuMatches.length === 1 ? customerSkuMatches[0] : null) ??
    (exactCustomerLineMatches.length === 1 ? exactCustomerLineMatches[0] : null) ??
    null;

  return {
    ...row,
    reason,
    matchCounts,
    bestCandidate: bestCandidate ? summarizeOrderItem(bestCandidate) : null
  };
}

function getReason(row, matchCounts) {
  if (!row.purchaseOrderNumber && !row.customerOrderNumber && !row.sellerSku) {
    return "missing_reference";
  }

  if (matchCounts.exactPoLine > 1 || matchCounts.exactCustomerLine > 1) {
    return "ambiguous_exact_match";
  }

  if (matchCounts.exactPoLine === 1) {
    return "unexpected_exact_match_unlinked";
  }

  if (matchCounts.poSku === 1) {
    return "safe_po_sku_fallback_possible";
  }

  if (matchCounts.customerSku === 1) {
    return "safe_customer_sku_fallback_possible";
  }

  if (matchCounts.poOnly > 0) {
    return "po_exists_but_line_or_sku_mismatch";
  }

  if (matchCounts.customerOnly > 0) {
    return "customer_order_exists_but_line_or_sku_mismatch";
  }

  if (matchCounts.skuOnly > 0) {
    return "sku_exists_but_order_reference_not_found";
  }

  return "po_not_imported_or_identifier_format_mismatch";
}

function summarize(diagnostics) {
  const amounts = { commission: 0, fulfillment: 0 };
  const reasons = {
    safePoSkuFallback: 0,
    safeCustomerSkuFallback: 0,
    poLineMismatch: 0,
    customerLineMismatch: 0,
    poNotImported: 0,
    missingReference: 0,
    ambiguous: 0,
    unexpectedExactMatch: 0,
    skuOnly: 0
  };
  const byFeeType = new Map();

  for (const row of diagnostics) {
    if (row.feeType === "commission") {
      amounts.commission += row.expenseAmount;
    } else if (row.feeType === "fulfillment_fee") {
      amounts.fulfillment += row.expenseAmount;
    }

    byFeeType.set(row.feeType, (byFeeType.get(row.feeType) ?? 0) + row.expenseAmount);

    if (row.reason === "safe_po_sku_fallback_possible") reasons.safePoSkuFallback += 1;
    if (row.reason === "safe_customer_sku_fallback_possible") reasons.safeCustomerSkuFallback += 1;
    if (row.reason === "po_exists_but_line_or_sku_mismatch") reasons.poLineMismatch += 1;
    if (row.reason === "customer_order_exists_but_line_or_sku_mismatch") reasons.customerLineMismatch += 1;
    if (row.reason === "po_not_imported_or_identifier_format_mismatch") reasons.poNotImported += 1;
    if (row.reason === "missing_reference") reasons.missingReference += 1;
    if (row.reason === "ambiguous_exact_match") reasons.ambiguous += 1;
    if (row.reason === "unexpected_exact_match_unlinked") reasons.unexpectedExactMatch += 1;
    if (row.reason === "sku_exists_but_order_reference_not_found") reasons.skuOnly += 1;
  }

  return {
    amounts: {
      commission: roundMoney(amounts.commission),
      fulfillment: roundMoney(amounts.fulfillment)
    },
    reasons,
    byFeeType: Object.fromEntries(
      Array.from(byFeeType.entries()).map(([key, value]) => [key, roundMoney(value)])
    )
  };
}

function writeReport({ organization, marketplace, from, to, summary, diagnostics, limit }) {
  const outputsDir = resolve("outputs");
  mkdirSync(outputsDir, { recursive: true });
  const reportPath = resolve(
    outputsDir,
    `unallocated-settlement-fees-${formatDate(from)}-${formatDate(to)}.md`
  );
  const visibleRows = diagnostics.slice(0, limit);
  const lines = [
    "# Unallocated Settlement Fee Diagnostic",
    "",
    `Organization: ${organization.name}`,
    `Marketplace: ${marketplace}`,
    `Date range: ${formatDate(from)} to ${formatDate(to)}`,
    "",
    "## Summary",
    "",
    `- Unallocated rows: ${diagnostics.length}`,
    `- Unallocated commission: ${formatCurrency(summary.amounts.commission)}`,
    `- Unallocated fulfillment: ${formatCurrency(summary.amounts.fulfillment)}`,
    `- Safe PO + SKU fallback candidates: ${summary.reasons.safePoSkuFallback}`,
    `- Safe customer order + SKU fallback candidates: ${summary.reasons.safeCustomerSkuFallback}`,
    `- PO exists but line/SKU mismatch: ${summary.reasons.poLineMismatch}`,
    `- SKU exists but settlement PO/order reference is not found: ${summary.reasons.skuOnly}`,
    `- PO not imported or identifier format mismatch: ${summary.reasons.poNotImported}`,
    `- Missing references: ${summary.reasons.missingReference}`,
    `- Ambiguous exact matches: ${summary.reasons.ambiguous}`,
    "",
    "## Diagnostic Rows",
    "",
    "| Fee Type | Expense | Posted At | PO # | PO Line | Customer Order | Customer Line | SKU | Current Match | Reason | Exact PO Line | PO + SKU | Customer + SKU | Best Candidate |",
    "| --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...visibleRows.map((row) =>
      [
        row.feeType,
        formatCurrency(row.expenseAmount),
        row.postedAt,
        row.purchaseOrderNumber ?? "",
        row.purchaseOrderLineNumber ?? "",
        row.customerOrderNumber ?? "",
        row.customerOrderLineNumber ?? "",
        row.sellerSku ?? "",
        row.currentMatchStatus ?? "",
        row.reason,
        row.matchCounts.exactPoLine,
        row.matchCounts.poSku,
        row.matchCounts.customerSku,
        row.bestCandidate ? formatCandidate(row.bestCandidate) : ""
      ]
        .map(markdownCell)
        .join("|")
        .replace(/^/, "|")
        .replace(/$/, "|")
    )
  ];

  writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}

function normalizeFee(fee) {
  const metadata = isObject(fee.metadata) ? fee.metadata : {};

  return {
    id: fee.id,
    feeType: fee.feeType,
    feeAmount: toNumber(fee.feeAmount),
    expenseAmount: toExpenseAmount(toNumber(fee.feeAmount), metadata),
    postedAt: fee.postedAt ? formatDateTime(fee.postedAt) : "",
    sellerSku:
      normalizeOptionalText(metadata.partnerItemId) ??
      normalizeOptionalText(metadata.originalSellerSku) ??
      normalizeOptionalText(fee.sellerSku),
    purchaseOrderNumber:
      normalizeOptionalText(metadata.purchaseOrderNumber) ??
      normalizeOptionalText(metadata.externalOrderId),
    purchaseOrderLineNumber:
      normalizeOptionalText(metadata.purchaseOrderLineNumber) ??
      normalizeOptionalText(metadata.externalLineId),
    customerOrderNumber: normalizeOptionalText(metadata.customerOrderNumber),
    customerOrderLineNumber: normalizeOptionalText(metadata.customerOrderLineNumber),
    currentMatchStatus: normalizeOptionalText(metadata.poLineMatchStatus),
    transactionType: normalizeOptionalText(metadata.transactionType),
    amountType: normalizeOptionalText(metadata.amountType),
    transactionDescription: normalizeOptionalText(metadata.transactionDescription),
    transactionReference: normalizeOptionalText(metadata.transactionReference),
    metadata
  };
}

function summarizeOrderItem(item) {
  return {
    id: item.id,
    sellerSku: item.sellerSku,
    parentSku: item.parentSku,
    purchaseOrderNumber: item.purchaseOrderNumber,
    purchaseOrderLineNumber: item.purchaseOrderLineNumber,
    customerOrderNumber: item.customerOrderNumber,
    customerOrderLineNumber: item.customerOrderLineNumber,
    poReportFlids: item.poReportFlids,
    poItemId: item.poItemId,
    quantity: item.quantity,
    itemRevenue: roundMoney(toNumber(item.itemRevenue))
  };
}

function formatCandidate(candidate) {
  return [
    `sku=${candidate.sellerSku}`,
    `parent=${candidate.parentSku ?? ""}`,
    `poLine=${candidate.purchaseOrderLineNumber ?? ""}`,
    `customerLine=${candidate.customerOrderLineNumber ?? ""}`,
    `qty=${candidate.quantity}`,
    `sales=${formatCurrency(candidate.itemRevenue)}`
  ].join("; ");
}

function toExpenseAmount(amount, metadata) {
  if (metadata.amountSignConvention === "negative_expense_positive_credit") {
    return roundMoney(-amount);
  }

  return roundMoney(amount < 0 ? Math.abs(amount) : amount);
}

function readMatches(index, key) {
  if (!key) {
    return [];
  }

  return index.get(key) ?? [];
}

function addIndex(index, key, item) {
  if (!key) {
    return;
  }

  const existing = index.get(key) ?? [];
  existing.push(item);
  index.set(key, existing);
}

function buildKey(...parts) {
  const normalized = parts.map(normalizeKeyPart);

  if (normalized.some((part) => !part)) {
    return null;
  }

  return normalized.join("::");
}

function normalizeKeyPart(value) {
  const text = normalizeOptionalText(value);
  return text ? text.toLowerCase() : null;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(values.map(normalizeOptionalText).filter((value) => typeof value === "string"))
  );
}

function chunkArray(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function parseArgs(values) {
  return Object.fromEntries(
    values
      .filter((value) => value.startsWith("--") && value.includes("="))
      .map((value) => {
        const [key, ...rest] = value.slice(2).split("=");
        return [key, rest.join("=")];
      })
  );
}

function parseDateArg(value, label) {
  if (!value) {
    throw new Error(`Missing --${label}=YYYY-MM-DD`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --${label} date: ${value}`);
  }

  if (label === "to") {
    parsed.setUTCHours(23, 59, 59, 999);
  }

  return parsed;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function toNumber(value) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value) {
  return `$${roundMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date) {
  return date.toISOString().replace(".000Z", "Z");
}

function markdownCell(value) {
  return ` ${String(value ?? "").replace(/\|/g, "\\|")} `;
}
