import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = parseArgs(process.argv.slice(2));
const marketplace = args.marketplace ?? "walmart";
const from = args.from ? parseDateArg(args.from, "from") : null;
const to = args.to ? parseDateArg(args.to, "to") : null;
const confirmed = Boolean(args.confirm);
const limit = Number.parseInt(args.limit ?? "80", 10);
const CHUNK_SIZE = 500;
const UPDATE_CHUNK_SIZE = 100;

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
    .filter((row) => row.metadata.source === "walmart_payments_new")
    .filter((row) => isInsideSelectedRange(row));

  const orderItems = await getCandidateOrderItems({
    organizationId: organization.id,
    marketplace,
    rows: settlementRows
  });
  const orderItemsByPoSku = buildPoSkuIndex(orderItems);
  const diagnostics = settlementRows.map((row) => diagnoseRow(row, orderItemsByPoSku));
  const repairableRows = diagnostics.filter((row) => row.action === "repair");
  const summary = summarize(diagnostics);

  if (confirmed) {
    await applyRepairs(repairableRows);
  }

  const reportPath = writeReport({
    organization,
    marketplace,
    from,
    to,
    confirmed,
    summary,
    diagnostics,
    limit: Number.isFinite(limit) ? limit : 80
  });

  console.log(
    confirmed
      ? "Settlement fee attribution repair complete."
      : "Settlement fee attribution repair dry-run complete."
  );
  console.table({
    organization: organization.name,
    marketplace,
    from: from ? formatDate(from) : "all",
    to: to ? formatDate(to) : "all",
    candidateRows: diagnostics.length,
    repairableRows: summary.repairableRows,
    repairedRows: confirmed ? summary.repairableRows : 0,
    commissionToRepair: summary.amounts.repairableCommission,
    fulfillmentToRepair: summary.amounts.repairableFulfillment,
    dateCorrections: summary.dateCorrections,
    ambiguousRows: summary.reasons.ambiguous,
    missingReferenceRows: summary.reasons.missingReference,
    notFoundRows: summary.reasons.notFound,
    report: reportPath
  });

  if (!confirmed && repairableRows.length) {
    console.log("Dry run only. Re-run with --confirm to update these rows.");
  }
}

async function getCandidateOrderItems({ organizationId, marketplace, rows }) {
  const purchaseOrderNumbers = uniqueStrings(rows.map((row) => row.purchaseOrderNumber));
  const byId = new Map();

  for (const chunk of chunkArray(purchaseOrderNumbers, CHUNK_SIZE)) {
    const orderItems = await prisma.salesOrderItem.findMany({
      where: {
        organizationId,
        marketplace,
        purchaseOrderNumber: { in: chunk }
      },
      select: {
        id: true,
        orderId: true,
        sellerSku: true,
        parentSku: true,
        purchaseOrderNumber: true,
        purchaseOrderLineNumber: true,
        customerOrderNumber: true,
        customerOrderLineNumber: true,
        quantity: true,
        itemRevenue: true
      }
    });

    for (const orderItem of orderItems) {
      byId.set(orderItem.id, orderItem);
    }
  }

  return Array.from(byId.values());
}

function buildPoSkuIndex(orderItems) {
  const index = new Map();

  for (const orderItem of orderItems) {
    const key = buildKey(orderItem.purchaseOrderNumber, orderItem.sellerSku);

    if (!key) {
      continue;
    }

    const existing = index.get(key) ?? [];
    existing.push(orderItem);
    index.set(key, existing);
  }

  return index;
}

function diagnoseRow(row, orderItemsByPoSku) {
  const poSkuKey = buildKey(row.purchaseOrderNumber, row.sellerSku);

  if (!poSkuKey) {
    return {
      ...row,
      action: "skip",
      reason: "missing_reference",
      matchCount: 0,
      match: null,
      correctedPostedAt: row.transactionPostedTimestamp ?? row.postedAt,
      dateWillChange: false
    };
  }

  const matches = orderItemsByPoSku.get(poSkuKey) ?? [];

  if (matches.length !== 1) {
    return {
      ...row,
      action: "skip",
      reason: matches.length > 1 ? "ambiguous" : "not_found",
      matchCount: matches.length,
      match: null,
      correctedPostedAt: row.transactionPostedTimestamp ?? row.postedAt,
      dateWillChange: false
    };
  }

  const [match] = matches;
  const correctedPostedAt = row.transactionPostedTimestamp ?? row.postedAt;

  return {
    ...row,
    action: "repair",
    reason: "matched_by_po_sku",
    matchCount: 1,
    match: summarizeOrderItem(match),
    correctedPostedAt,
    dateWillChange: Boolean(
      correctedPostedAt &&
        row.postedAt &&
        new Date(correctedPostedAt).getTime() !== new Date(row.postedAt).getTime()
    )
  };
}

async function applyRepairs(rows) {
  for (const chunk of chunkArray(rows, UPDATE_CHUNK_SIZE)) {
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.marketplaceFee.update({
          where: { id: row.id },
          data: {
            orderId: row.match.orderId,
            orderItemId: row.match.id,
            sellerSku: row.sellerSku ?? row.match.sellerSku,
            postedAt: row.correctedPostedAt
              ? new Date(row.correctedPostedAt)
              : row.postedAt
                ? new Date(row.postedAt)
                : null,
            metadata: buildRepairedMetadata(row)
          }
        })
      )
    );
  }
}

function buildRepairedMetadata(row) {
  return {
    ...row.metadata,
    sellerSku: row.sellerSku ?? row.match.sellerSku,
    originalSellerSku: row.metadata.originalSellerSku ?? row.sellerSku ?? row.match.sellerSku,
    partnerItemId: row.metadata.partnerItemId ?? row.sellerSku ?? row.match.sellerSku,
    reportingDateSource: "transaction_posted_timestamp",
    pnlReportingDate: row.correctedPostedAt,
    attributionScope: "product",
    productAttributionReliable: true,
    poLineMatchStatus: "matched",
    poLineMatchMethod: "purchase_order_sku_repair",
    matchedOrderId: row.match.orderId,
    matchedOrderItemId: row.match.id,
    matchedPurchaseOrderNumber: row.match.purchaseOrderNumber,
    matchedPurchaseOrderLineNumber: row.match.purchaseOrderLineNumber,
    matchedCustomerOrderNumber: row.match.customerOrderNumber,
    matchedCustomerOrderLineNumber: row.match.customerOrderLineNumber,
    repairedAt: new Date().toISOString(),
    repairSource: "repair-settlement-fee-attribution"
  };
}

function summarize(diagnostics) {
  const reasons = {
    matchedByPoSku: 0,
    ambiguous: 0,
    missingReference: 0,
    notFound: 0
  };
  const amounts = {
    repairableCommission: 0,
    repairableFulfillment: 0
  };
  let dateCorrections = 0;

  for (const row of diagnostics) {
    if (row.reason === "matched_by_po_sku") reasons.matchedByPoSku += 1;
    if (row.reason === "ambiguous") reasons.ambiguous += 1;
    if (row.reason === "missing_reference") reasons.missingReference += 1;
    if (row.reason === "not_found") reasons.notFound += 1;

    if (row.action === "repair") {
      if (row.feeType === "commission") {
        amounts.repairableCommission += row.expenseAmount;
      } else if (row.feeType === "fulfillment_fee") {
        amounts.repairableFulfillment += row.expenseAmount;
      }
    }

    if (row.dateWillChange) {
      dateCorrections += 1;
    }
  }

  return {
    repairableRows: reasons.matchedByPoSku,
    dateCorrections,
    reasons,
    amounts: {
      repairableCommission: roundMoney(amounts.repairableCommission),
      repairableFulfillment: roundMoney(amounts.repairableFulfillment)
    }
  };
}

function writeReport({ organization, marketplace, from, to, confirmed, summary, diagnostics, limit }) {
  const outputsDir = resolve("outputs");
  mkdirSync(outputsDir, { recursive: true });
  const datePart =
    from && to ? `${formatDate(from)}-${formatDate(to)}` : "all-dates";
  const reportPath = resolve(
    outputsDir,
    `settlement-fee-attribution-repair-${datePart}.md`
  );
  const visibleRows = diagnostics.slice(0, limit);
  const lines = [
    "# Settlement Fee Attribution Repair",
    "",
    `Organization: ${organization.name}`,
    `Marketplace: ${marketplace}`,
    `Date range: ${from ? formatDate(from) : "all"} to ${to ? formatDate(to) : "all"}`,
    `Mode: ${confirmed ? "confirmed repair" : "dry run"}`,
    "",
    "## Summary",
    "",
    `- Candidate unallocated commission/fulfillment rows: ${diagnostics.length}`,
    `- Repairable by PO # + SKU: ${summary.repairableRows}`,
    `- Commission that will become product-attributed: ${formatCurrency(summary.amounts.repairableCommission)}`,
    `- Fulfillment that will become product-attributed: ${formatCurrency(summary.amounts.repairableFulfillment)}`,
    `- Rows whose reporting date will be corrected to Transaction Posted Timestamp: ${summary.dateCorrections}`,
    `- Ambiguous PO # + SKU matches left unchanged: ${summary.reasons.ambiguous}`,
    `- Missing reference rows left unchanged: ${summary.reasons.missingReference}`,
    `- Not found rows left unchanged: ${summary.reasons.notFound}`,
    "",
    "## Rows",
    "",
    "| Action | Fee Type | Expense | Current Posted At | Corrected Posted At | PO # | SKU | Reason | Match Count | Matched PO Line | Matched Order Item |",
    "| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | --- | --- |",
    ...visibleRows.map((row) =>
      [
        row.action,
        row.feeType,
        formatCurrency(row.expenseAmount),
        row.postedAt ?? "",
        row.correctedPostedAt ?? "",
        row.purchaseOrderNumber ?? "",
        row.sellerSku ?? "",
        row.reason,
        row.matchCount,
        row.match?.purchaseOrderLineNumber ?? "",
        row.match?.id ?? ""
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
    sellerSku:
      normalizeOptionalText(metadata.partnerItemId) ??
      normalizeOptionalText(metadata.originalSellerSku) ??
      normalizeOptionalText(fee.sellerSku),
    postedAt: fee.postedAt ? fee.postedAt.toISOString() : null,
    transactionPostedTimestamp: normalizeOptionalIsoDate(metadata.transactionPostedTimestamp),
    purchaseOrderNumber:
      normalizeOptionalText(metadata.purchaseOrderNumber) ??
      normalizeOptionalText(metadata.externalOrderId),
    purchaseOrderLineNumber:
      normalizeOptionalText(metadata.purchaseOrderLineNumber) ??
      normalizeOptionalText(metadata.externalLineId),
    customerOrderNumber: normalizeOptionalText(metadata.customerOrderNumber),
    customerOrderLineNumber: normalizeOptionalText(metadata.customerOrderLineNumber),
    metadata
  };
}

function summarizeOrderItem(item) {
  return {
    id: item.id,
    orderId: item.orderId,
    sellerSku: item.sellerSku,
    parentSku: item.parentSku,
    purchaseOrderNumber: item.purchaseOrderNumber,
    purchaseOrderLineNumber: item.purchaseOrderLineNumber,
    customerOrderNumber: item.customerOrderNumber,
    customerOrderLineNumber: item.customerOrderLineNumber,
    quantity: item.quantity,
    itemRevenue: roundMoney(toNumber(item.itemRevenue))
  };
}

function isInsideSelectedRange(row) {
  if (!from && !to) {
    return true;
  }

  const dates = [row.transactionPostedTimestamp, row.postedAt]
    .filter(Boolean)
    .map((value) => new Date(value));

  return dates.some((date) => {
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    if (from && date < from) {
      return false;
    }

    if (to && date > to) {
      return false;
    }

    return true;
  });
}

function toExpenseAmount(amount, metadata) {
  if (metadata.amountSignConvention === "negative_expense_positive_credit") {
    return roundMoney(-amount);
  }

  return roundMoney(amount < 0 ? Math.abs(amount) : amount);
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
  const parsed = {};

  for (const value of values) {
    if (!value.startsWith("--")) {
      continue;
    }

    const withoutPrefix = value.slice(2);

    if (!withoutPrefix.includes("=")) {
      parsed[withoutPrefix] = true;
      continue;
    }

    const [key, ...rest] = withoutPrefix.split("=");
    parsed[key] = rest.join("=");
  }

  return parsed;
}

function parseDateArg(value, label) {
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

function normalizeOptionalIsoDate(value) {
  const text = normalizeOptionalText(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function markdownCell(value) {
  return ` ${String(value ?? "").replace(/\|/g, "\\|")} `;
}
