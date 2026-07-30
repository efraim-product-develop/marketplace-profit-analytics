import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
loadEnv(path.join(rootDir, ".env"));

const prisma = new PrismaClient();
const organizationSlug = "local-workspace";
const marketplace = "walmart";
const datasetId = "cogs-effective-date-validation";
const reportPath = path.join(rootDir, "outputs", "cogs-validation-report.md");

const parents = [
  {
    sku: "VAL-PARENT-TUMBLER",
    title: "Summit Trail Insulated Tumbler"
  },
  {
    sku: "VAL-PARENT-ORGANIZER",
    title: "Brookside Bamboo Drawer Organizer"
  }
];

const skus = [
  {
    sku: "VAL-TMB-12-BLK",
    parentSku: "VAL-PARENT-TUMBLER",
    title: "Summit Trail Tumbler 12 oz Black"
  },
  {
    sku: "VAL-TMB-16-BLK",
    parentSku: "VAL-PARENT-TUMBLER",
    title: "Summit Trail Tumbler 16 oz Black"
  },
  {
    sku: "VAL-TMB-16-SAND",
    parentSku: "VAL-PARENT-TUMBLER",
    title: "Summit Trail Tumbler 16 oz Sand"
  },
  {
    sku: "VAL-ORG-SM",
    parentSku: "VAL-PARENT-ORGANIZER",
    title: "Brookside Bamboo Organizer Small"
  },
  {
    sku: "VAL-ORG-LG",
    parentSku: "VAL-PARENT-ORGANIZER",
    title: "Brookside Bamboo Organizer Large"
  }
];

const batches = [
  {
    shipmentId: "VAL-SHIP-2024-Q1",
    effectiveDate: "2024-01-01",
    notes: "Initial landed-cost shipment for validation",
    costs: [
      cost("VAL-TMB-12-BLK", 5.8, 1.2, 0.45, 0.4),
      cost("VAL-TMB-16-BLK", 7.1, 1.35, 0.5, 0.45),
      cost("VAL-TMB-16-SAND", 7.2, 1.35, 0.5, 0.45),
      cost("VAL-ORG-SM", 8.3, 1.9, 0.7, 0.6)
    ]
  },
  {
    shipmentId: "VAL-SHIP-2024-Q3",
    effectiveDate: "2024-07-01",
    notes: "Mid-year supplier and freight increase",
    costs: [
      cost("VAL-TMB-12-BLK", 6.05, 1.3, 0.45, 0.45),
      cost("VAL-TMB-16-BLK", 7.4, 1.45, 0.55, 0.5),
      cost("VAL-TMB-16-SAND", 7.55, 1.45, 0.55, 0.5),
      cost("VAL-ORG-SM", 8.75, 2.0, 0.75, 0.65)
    ]
  },
  {
    shipmentId: "VAL-SHIP-2025-Q1",
    effectiveDate: "2025-01-15",
    notes: "Newest validation shipment",
    costs: [
      cost("VAL-TMB-12-BLK", 6.4, 1.45, 0.5, 0.45),
      cost("VAL-TMB-16-BLK", 7.85, 1.55, 0.55, 0.55),
      cost("VAL-ORG-SM", 9.1, 2.1, 0.8, 0.7)
    ]
  }
];

const orders = [
  {
    externalOrderId: "VAL-ORDER-OLD-001",
    orderDate: "2024-03-15",
    lines: [
      orderLine("VAL-ORDER-OLD-001-1", "VAL-TMB-12-BLK", 10, 249.9, 5.0, 28.0, 7.85),
      orderLine("VAL-ORDER-OLD-001-2", "VAL-TMB-16-BLK", 5, 149.95, 0, 16.49, 9.4)
    ]
  },
  {
    externalOrderId: "VAL-ORDER-MID-001",
    orderDate: "2024-09-10",
    lines: [
      orderLine("VAL-ORDER-MID-001-1", "VAL-TMB-16-SAND", 8, 239.92, 10.0, 25.29, 10.05),
      orderLine("VAL-ORDER-MID-001-2", "VAL-ORG-SM", 6, 191.94, 0, 21.11, 12.15)
    ]
  },
  {
    externalOrderId: "VAL-ORDER-NEW-001",
    orderDate: "2025-02-20",
    lines: [
      orderLine("VAL-ORDER-NEW-001-1", "VAL-TMB-12-BLK", 12, 299.88, 0, 32.99, 8.8),
      orderLine("VAL-ORDER-NEW-001-2", "VAL-TMB-16-BLK", 6, 179.94, 8.0, 18.91, 10.5)
    ]
  },
  {
    externalOrderId: "VAL-ORDER-MISSING-001",
    orderDate: "2025-03-05",
    lines: [
      orderLine("VAL-ORDER-MISSING-001-1", "VAL-ORG-LG", 4, 159.96, 0, 17.6, null)
    ]
  }
];

async function main() {
  if (process.argv.includes("--expected-only")) {
    writeReport({
      created: expectedCreatedCounts(),
      validation: buildExpectedValidation(),
      mode: "Expected calculations only. The database was not changed."
    });
    console.log(`Expected calculation report: ${reportPath}`);
    return;
  }

  const organization = await prisma.organization.upsert({
    where: { slug: organizationSlug },
    update: {},
    create: {
      name: "Local Workspace",
      slug: organizationSlug,
      settings: {
        create: {
          defaultCurrency: "USD",
          timeZone: "America/New_York",
          defaultMarketplace: marketplace
        }
      }
    }
  });

  await resetValidationData(organization.id);
  const created = await createValidationData(organization.id);
  const validation = await validateSeededData(organization.id);
  writeReport({ created, validation, mode: "Database seeded and verified." });

  console.log(`Created validation data for ${organization.name}.`);
  console.log(`Report: ${reportPath}`);
}

async function resetValidationData(organizationId) {
  const skuValues = skus.map((item) => item.sku);
  const productValues = [...parents.map((item) => item.sku), ...skuValues];
  const shipmentIds = batches.map((batch) => batch.shipmentId);
  const orderIds = orders.map((order) => order.externalOrderId);

  await prisma.marketplaceFee.deleteMany({
    where: {
      organizationId,
      sellerSku: { in: skuValues }
    }
  });
  await prisma.salesOrder.deleteMany({
    where: { organizationId, externalOrderId: { in: orderIds } }
  });
  await prisma.salesImport.deleteMany({
    where: { organizationId, originalFileName: `${datasetId}-orders.xlsx` }
  });
  await prisma.advertisingCost.deleteMany({
    where: { organizationId, campaignId: `${datasetId}-sem` }
  });
  await prisma.costRecord.deleteMany({
    where: { organizationId, sellerSku: { in: skuValues } }
  });
  await prisma.cogsBatch.deleteMany({
    where: { organizationId, shipmentId: { in: shipmentIds } }
  });
  await prisma.costUpload.deleteMany({
    where: { organizationId, originalFileName: `${datasetId}-cogs.xlsx` }
  });
  await prisma.listing.deleteMany({
    where: { organizationId, sellerSku: { in: skuValues } }
  });
  await prisma.product.deleteMany({
    where: { organizationId, internalSku: { in: productValues } }
  });
}

async function createValidationData(organizationId) {
  const productBySku = new Map();
  const listingBySku = new Map();

  for (const parent of parents) {
    const product = await prisma.product.create({
      data: {
        organizationId,
        internalSku: parent.sku,
        title: parent.title,
        brand: parent.sku === "VAL-PARENT-TUMBLER" ? "Summit Trail" : "Brookside Home"
      }
    });
    productBySku.set(parent.sku, product);
  }

  for (const item of skus) {
    const product = await prisma.product.create({
      data: {
        organizationId,
        internalSku: item.sku,
        parentSku: item.parentSku,
        title: item.title,
        brand: item.parentSku === "VAL-PARENT-TUMBLER" ? "Summit Trail" : "Brookside Home"
      }
    });
    const listing = await prisma.listing.create({
      data: {
        organizationId,
        productId: product.id,
        marketplace,
        sellerSku: item.sku,
        parentSku: item.parentSku,
        marketplaceItemId: `${marketplace.toUpperCase()}-${item.sku}`,
        title: item.title,
        status: "active",
        fulfillmentChannel: "WFS"
      }
    });
    productBySku.set(item.sku, product);
    listingBySku.set(item.sku, listing);
  }

  const costUpload = await prisma.costUpload.create({
    data: {
      organizationId,
      marketplace,
      source: "validation_seed",
      originalFileName: `${datasetId}-cogs.xlsx`,
      status: "IMPORTED",
      rowCount: batches.reduce((count, batch) => count + batch.costs.length, 0),
      importedCount: batches.reduce((count, batch) => count + batch.costs.length, 0),
      rejectedCount: 0
    }
  });

  const batchByShipment = new Map();
  for (const batch of batches) {
    const createdBatch = await prisma.cogsBatch.create({
      data: {
        organizationId,
        uploadId: costUpload.id,
        marketplace,
        shipmentId: batch.shipmentId,
        notes: batch.notes
      }
    });
    batchByShipment.set(batch.shipmentId, createdBatch);

    for (const itemCost of batch.costs) {
      const sku = skus.find((item) => item.sku === itemCost.sku);
      const product = productBySku.get(itemCost.sku);
      const listing = listingBySku.get(itemCost.sku);

      await prisma.costRecord.create({
        data: {
          organizationId,
          uploadId: costUpload.id,
          batchId: createdBatch.id,
          productId: product.id,
          listingId: listing.id,
          marketplace,
          sellerSku: itemCost.sku,
          parentSku: sku.parentSku,
          shipmentId: batch.shipmentId,
          productName: parents.find((parent) => parent.sku === sku.parentSku).title,
          variationName: sku.title,
          unitCost: money(itemCost.total),
          unitCogs: money(itemCost.unitCogs),
          inboundFreightPerUnit: money(itemCost.inboundFreightPerUnit),
          prepCostPerUnit: money(itemCost.prepCostPerUnit),
          packagingCostPerUnit: money(itemCost.packagingCostPerUnit),
          currency: "USD",
          effectiveDate: asDate(batch.effectiveDate),
          notes: `${batch.notes}; generated validation data`,
          status: "ACTIVE",
          metadata: { datasetId }
        }
      });
    }
  }

  const salesImport = await prisma.salesImport.create({
    data: {
      organizationId,
      marketplace,
      source: "validation_seed",
      originalFileName: `${datasetId}-orders.xlsx`,
      status: "IMPORTED",
      rowCount: orders.reduce((count, order) => count + order.lines.length, 0),
      importedCount: orders.reduce((count, order) => count + order.lines.length, 0),
      rejectedCount: 0
    }
  });

  for (const order of orders) {
    const createdOrder = await prisma.salesOrder.create({
      data: {
        organizationId,
        importId: salesImport.id,
        marketplace,
        externalOrderId: order.externalOrderId,
        orderDate: asDate(order.orderDate),
        status: "shipped",
        currency: "USD"
      }
    });

    for (const line of order.lines) {
      const sku = skus.find((item) => item.sku === line.sku);
      const product = productBySku.get(line.sku);
      const listing = listingBySku.get(line.sku);
      const item = await prisma.salesOrderItem.create({
        data: {
          organizationId,
          orderId: createdOrder.id,
          productId: product.id,
          listingId: listing.id,
          marketplace,
          sellerSku: line.sku,
          parentSku: sku.parentSku,
          externalLineId: line.externalLineId,
          quantity: line.quantity,
          unitPrice: money(line.itemRevenue / line.quantity),
          itemRevenue: money(line.itemRevenue),
          shippingRevenue: money(0),
          taxCollected: money(0),
          discountAmount: money(line.discount),
          cogsUnit: null,
          cogsTotal: money(0)
        }
      });

      await prisma.marketplaceFee.create({
        data: {
          organizationId,
          orderId: createdOrder.id,
          orderItemId: item.id,
          marketplace,
          sellerSku: line.sku,
          feeType: "referral_fee",
          feeAmount: money(-line.fee),
          currency: "USD",
          postedAt: asDate(order.orderDate),
          metadata: { datasetId }
        }
      });
    }
  }

  return {
    parentsCreated: parents.length,
    skusCreated: skus.length,
    batchesCreated: batchByShipment.size,
    costRecordsCreated: batches.reduce((count, batch) => count + batch.costs.length, 0),
    ordersCreated: orders.length,
    orderLinesCreated: orders.reduce((count, order) => count + order.lines.length, 0)
  };
}

async function validateSeededData(organizationId) {
  const orderIds = orders.map((order) => order.externalOrderId);
  const skuValues = skus.map((item) => item.sku);

  const [items, costRecords] = await Promise.all([
    prisma.salesOrderItem.findMany({
      where: {
        organizationId,
        order: { is: { externalOrderId: { in: orderIds } } }
      },
      include: { order: true, fees: true },
      orderBy: [{ order: { orderDate: "asc" } }, { externalLineId: "asc" }]
    }),
    prisma.costRecord.findMany({
      where: {
        organizationId,
        sellerSku: { in: skuValues },
        status: "ACTIVE"
      },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }]
    })
  ]);

  const expectedByLine = new Map();
  for (const order of orders) {
    for (const line of order.lines) {
      expectedByLine.set(line.externalLineId, { ...line, orderDate: order.orderDate });
    }
  }

  const lineResults = items.map((item) => {
    const expected = expectedByLine.get(item.externalLineId);
    const assignedCost = findEffectiveCost({
      marketplace: item.marketplace,
      sellerSku: item.sellerSku,
      orderDate: item.order.orderDate,
      costRecords
    });
    const actualUnitCost = assignedCost?.unitCost ?? null;
    const netRevenue = toNumber(item.itemRevenue) + toNumber(item.shippingRevenue) - toNumber(item.discountAmount);
    const fees = item.fees.reduce((sum, fee) => sum + Math.abs(toNumber(fee.feeAmount)), 0);
    const cogs = (actualUnitCost ?? 0) * item.quantity;
    const contribution = netRevenue - fees - cogs;
    const missingCogs = actualUnitCost === null;

    return {
      orderId: item.order.externalOrderId,
      orderDate: item.order.orderDate.toISOString().slice(0, 10),
      sku: item.sellerSku,
      parentSku: item.parentSku,
      quantity: item.quantity,
      netRevenue,
      fees,
      expectedUnitCost: expected.expectedUnitCost,
      actualUnitCost,
      cogs,
      contribution,
      missingCogs,
      pass:
        expected.expectedUnitCost === null
          ? actualUnitCost === null
          : almostEqual(actualUnitCost, expected.expectedUnitCost)
    };
  });

  const skuTotals = groupTotals(lineResults, "sku");
  const parentTotals = groupTotals(lineResults, "parentSku");
  const total = summarize(lineResults);

  const checks = [
    {
      name: "Older orders use older COGS",
      pass:
        findLine(lineResults, "VAL-ORDER-OLD-001", "VAL-TMB-12-BLK").actualUnitCost === 7.85 &&
        findLine(lineResults, "VAL-ORDER-OLD-001", "VAL-TMB-16-BLK").actualUnitCost === 9.4
    },
    {
      name: "Newer orders use newer COGS",
      pass:
        findLine(lineResults, "VAL-ORDER-NEW-001", "VAL-TMB-12-BLK").actualUnitCost === 8.8 &&
        findLine(lineResults, "VAL-ORDER-NEW-001", "VAL-TMB-16-BLK").actualUnitCost === 10.5
    },
    {
      name: "Parent aggregation works",
      pass:
        almostEqual(parentTotals.get("VAL-PARENT-TUMBLER").contribution, 600.41) &&
        almostEqual(parentTotals.get("VAL-PARENT-ORGANIZER").contribution, 240.29)
    },
    {
      name: "Missing COGS are flagged",
      pass:
        findLine(lineResults, "VAL-ORDER-MISSING-001", "VAL-ORG-LG").missingCogs === true &&
        parentTotals.get("VAL-PARENT-ORGANIZER").missingCogsUnits === 4
    }
  ];

  return { lineResults, skuTotals, parentTotals, total, checks };
}

function buildExpectedValidation() {
  const lineResults = [];

  for (const order of orders) {
    for (const line of order.lines) {
      const sku = skus.find((item) => item.sku === line.sku);
      const actualUnitCost = line.expectedUnitCost;
      const netRevenue = line.itemRevenue - line.discount;
      const cogs = (actualUnitCost ?? 0) * line.quantity;
      const contribution = netRevenue - line.fee - cogs;

      lineResults.push({
        orderId: order.externalOrderId,
        orderDate: order.orderDate,
        sku: line.sku,
        parentSku: sku.parentSku,
        quantity: line.quantity,
        netRevenue,
        fees: line.fee,
        expectedUnitCost: line.expectedUnitCost,
        actualUnitCost,
        cogs,
        contribution,
        missingCogs: actualUnitCost === null,
        pass: true
      });
    }
  }

  const skuTotals = groupTotals(lineResults, "sku");
  const parentTotals = groupTotals(lineResults, "parentSku");
  const total = summarize(lineResults);

  return {
    lineResults,
    skuTotals,
    parentTotals,
    total,
    checks: [
      { name: "Older orders use older COGS", pass: true },
      { name: "Newer orders use newer COGS", pass: true },
      { name: "Parent aggregation works", pass: true },
      { name: "Missing COGS are flagged", pass: true }
    ]
  };
}

function expectedCreatedCounts() {
  return {
    parentsCreated: parents.length,
    skusCreated: skus.length,
    batchesCreated: batches.length,
    costRecordsCreated: batches.reduce((count, batch) => count + batch.costs.length, 0),
    ordersCreated: orders.length,
    orderLinesCreated: orders.reduce((count, order) => count + order.lines.length, 0)
  };
}

function writeReport({ created, validation, mode }) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const lines = [
    "# COGS Validation Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Mode: ${mode}`,
    "",
    "## Seeded Data",
    "",
    `- Parent products: ${created.parentsCreated}`,
    `- SKUs: ${created.skusCreated}`,
    `- COGS batches: ${created.batchesCreated}`,
    `- COGS records: ${created.costRecordsCreated}`,
    `- Orders: ${created.ordersCreated}`,
    `- Order lines: ${created.orderLinesCreated}`,
    "",
    "## Verification Checks",
    "",
    "| Check | Result |",
    "| --- | --- |",
    ...validation.checks.map((check) => `| ${check.name} | ${check.pass ? "PASS" : "FAIL"} |`),
    "",
    "## Effective-Date Order Validation",
    "",
    "| Order Date | Order | SKU | Qty | Expected Unit COGS | Actual Unit COGS | Net Revenue | Commission | COGS | Profit | Missing COGS | Result |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...validation.lineResults.map((line) =>
      [
        line.orderDate,
        line.orderId,
        line.sku,
        line.quantity,
        currencyOrMissing(line.expectedUnitCost),
        currencyOrMissing(line.actualUnitCost),
        currency(line.netRevenue),
        currency(line.fees),
        currency(line.cogs),
        currency(line.contribution),
        line.missingCogs ? "Yes" : "No",
        line.pass ? "PASS" : "FAIL"
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
    ),
    "",
    "## SKU Expected Totals",
    "",
    "| SKU | Units | Net Revenue | Commission | COGS | Profit | Missing COGS Units |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Array.from(validation.skuTotals.entries()).map(([sku, total]) =>
      `| ${sku} | ${total.quantity} | ${currency(total.netRevenue)} | ${currency(total.fees)} | ${currency(total.cogs)} | ${currency(total.contribution)} | ${total.missingCogsUnits} |`
    ),
    "",
    "## Parent Expected Totals",
    "",
    "| Parent Product | Units | Net Revenue | Commission | COGS | Profit | Missing COGS Units |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...Array.from(validation.parentTotals.entries()).map(([parentSku, total]) =>
      `| ${parentSku} | ${total.quantity} | ${currency(total.netRevenue)} | ${currency(total.fees)} | ${currency(total.cogs)} | ${currency(total.contribution)} | ${total.missingCogsUnits} |`
    ),
    "",
    "## Seeded Total",
    "",
    `Net Revenue: ${currency(validation.total.netRevenue)}`,
    "",
    `Fees: ${currency(validation.total.fees)}`,
    "",
    `COGS: ${currency(validation.total.cogs)}`,
    "",
    `Profit: ${currency(validation.total.contribution)}`,
    "",
    `Missing COGS Units: ${validation.total.missingCogsUnits}`,
    ""
  ];

  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
}

function cost(sku, unitCogs, inboundFreightPerUnit, prepCostPerUnit, packagingCostPerUnit) {
  return {
    sku,
    unitCogs,
    inboundFreightPerUnit,
    prepCostPerUnit,
    packagingCostPerUnit,
    total: roundMoney(unitCogs + inboundFreightPerUnit + prepCostPerUnit + packagingCostPerUnit)
  };
}

function orderLine(externalLineId, sku, quantity, itemRevenue, discount, fee, expectedUnitCost) {
  return {
    externalLineId,
    sku,
    quantity,
    itemRevenue,
    discount,
    fee,
    expectedUnitCost
  };
}

function findEffectiveCost({ marketplace: recordMarketplace, sellerSku, orderDate, costRecords }) {
  const costRecord = costRecords.find(
    (record) =>
      record.marketplace === recordMarketplace &&
      record.sellerSku === sellerSku &&
      record.effectiveDate <= orderDate
  );
  return costRecord ? { unitCost: toNumber(costRecord.unitCost) } : null;
}

function groupTotals(lines, key) {
  const groups = new Map();
  for (const line of lines) {
    const groupKey = line[key] ?? "Unassigned";
    const total = groups.get(groupKey) ?? emptyTotal();
    total.quantity += line.quantity;
    total.netRevenue += line.netRevenue;
    total.fees += line.fees;
    total.cogs += line.cogs;
    total.contribution += line.contribution;
    total.missingCogsUnits += line.missingCogs ? line.quantity : 0;
    groups.set(groupKey, total);
  }

  for (const total of groups.values()) {
    roundTotal(total);
  }

  return groups;
}

function summarize(lines) {
  const total = emptyTotal();
  for (const line of lines) {
    total.quantity += line.quantity;
    total.netRevenue += line.netRevenue;
    total.fees += line.fees;
    total.cogs += line.cogs;
    total.contribution += line.contribution;
    total.missingCogsUnits += line.missingCogs ? line.quantity : 0;
  }
  return roundTotal(total);
}

function emptyTotal() {
  return {
    quantity: 0,
    netRevenue: 0,
    fees: 0,
    cogs: 0,
    contribution: 0,
    missingCogsUnits: 0
  };
}

function roundTotal(total) {
  total.netRevenue = roundMoney(total.netRevenue);
  total.fees = roundMoney(total.fees);
  total.cogs = roundMoney(total.cogs);
  total.contribution = roundMoney(total.contribution);
  return total;
}

function findLine(lines, orderId, sku) {
  return lines.find((line) => line.orderId === orderId && line.sku === sku);
}

function asDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function money(value) {
  return roundMoney(value).toFixed(4);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }

  return 0;
}

function almostEqual(actual, expected) {
  return Math.abs(actual - expected) < 0.005;
}

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(roundMoney(value));
}

function currencyOrMissing(value) {
  return value === null ? "Missing" : currency(value);
}

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
