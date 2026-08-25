import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnvFile();

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const marketplace = readArgValue("--marketplace") ?? "walmart";
const organizationSlug = readArgValue("--organization-slug");

const SALES_IMPORT_SOURCES = ["sales_upload", "generic_import_framework"];
const SALES_IMPORT_RUN_TYPES = ["walmart_purchase_order", "walmart_item_sales"];
const ORDER_DELETE_BATCH_SIZE = 500;

await main();

async function main() {
  try {
    const organizationWhere = organizationSlug ? { slug: organizationSlug } : undefined;
    const organizations = await prisma.organization.findMany({
      where: organizationWhere,
      select: { id: true, name: true, slug: true },
      orderBy: { createdAt: "asc" }
    });

    if (!organizations.length) {
      throw new Error(
        organizationSlug
          ? `No organization found for slug "${organizationSlug}".`
          : "No organizations found."
      );
    }

    const organizationIds = organizations.map((organization) => organization.id);
    const orderWhere = buildSalesOrderWhere(organizationIds, marketplace);
    const salesImportWhere = buildSalesImportWhere(organizationIds, marketplace);
    const importRunWhere = buildImportRunWhere(organizationIds, marketplace);

    const counts = await readCounts({ orderWhere, salesImportWhere, importRunWhere });
    printPlan({ organizations, marketplace, counts });

    if (!confirmed) {
      console.log("");
      console.log("Dry run only. Re-run with --confirm to delete this data.");
      return;
    }

    const deletedOrders = await deleteSalesOrdersInBatches(orderWhere);
    const deletedSalesImports = await prisma.salesImport.deleteMany({ where: salesImportWhere });
    const deletedImportRuns = await prisma.importRun.deleteMany({ where: importRunWhere });

    console.log("");
    console.log(`Deleted sales orders: ${deletedOrders}`);
    console.log(`Deleted sales imports: ${deletedSalesImports.count}`);
    console.log(`Deleted generic import runs: ${deletedImportRuns.count}`);
    console.log("Cleanup complete.");
  } finally {
    await prisma.$disconnect();
  }
}

async function deleteSalesOrdersInBatches(orderWhere) {
  let totalDeleted = 0;

  while (true) {
    const batch = await prisma.salesOrder.findMany({
      where: orderWhere,
      select: { id: true },
      orderBy: { id: "asc" },
      take: ORDER_DELETE_BATCH_SIZE
    });

    if (!batch.length) {
      return totalDeleted;
    }

    const result = await prisma.salesOrder.deleteMany({
      where: { id: { in: batch.map((order) => order.id) } }
    });

    totalDeleted += result.count;
    console.log(`Deleted ${totalDeleted} sales orders...`);
  }
}

function buildSalesOrderWhere(organizationIds, marketplace) {
  return {
    organizationId: { in: organizationIds },
    marketplace,
    OR: [
      { status: "monthly_summary" },
      { externalOrderId: { startsWith: "walmart-item-sales:" } },
      { salesImport: { is: { source: { in: SALES_IMPORT_SOURCES } } } }
    ]
  };
}

function buildSalesImportWhere(organizationIds, marketplace) {
  return {
    organizationId: { in: organizationIds },
    marketplace,
    source: { in: SALES_IMPORT_SOURCES }
  };
}

function buildImportRunWhere(organizationIds, marketplace) {
  return {
    organizationId: { in: organizationIds },
    marketplace,
    importKind: "sales",
    reportType: { in: SALES_IMPORT_RUN_TYPES }
  };
}

async function readCounts({ orderWhere, salesImportWhere, importRunWhere }) {
  const [
    salesOrders,
    salesOrderItems,
    orderLinkedFees,
    orderLinkedRefunds,
    salesImports,
    salesImportIssues,
    importRuns,
    importRunIssues,
    importRunPreviewRows
  ] = await Promise.all([
    prisma.salesOrder.count({ where: orderWhere }),
    prisma.salesOrderItem.count({ where: { order: { is: orderWhere } } }),
    prisma.marketplaceFee.count({ where: { order: { is: orderWhere } } }),
    prisma.refund.count({ where: { order: { is: orderWhere } } }),
    prisma.salesImport.count({ where: salesImportWhere }),
    prisma.salesImportIssue.count({ where: { import: { is: salesImportWhere } } }),
    prisma.importRun.count({ where: importRunWhere }),
    prisma.importRunIssue.count({ where: { importRun: { is: importRunWhere } } }),
    prisma.importRunPreviewRow.count({ where: { importRun: { is: importRunWhere } } })
  ]);

  return {
    salesOrders,
    salesOrderItems,
    orderLinkedFees,
    orderLinkedRefunds,
    salesImports,
    salesImportIssues,
    importRuns,
    importRunIssues,
    importRunPreviewRows
  };
}

function printPlan({ organizations, marketplace, counts }) {
  console.log("Walmart sales cleanup target");
  console.log(`Marketplace: ${marketplace}`);
  console.log(
    `Organizations: ${organizations
      .map((organization) => `${organization.name} (${organization.slug})`)
      .join(", ")}`
  );
  console.log("");
  console.table(counts);
  console.log("");
  console.log("Will keep: COGS, COGS history, products, listings, settlements, ads, settings.");
  console.log("Will delete: PO/order sales rows, archived retired sales-summary rows, sales import history, sales import preview/history rows.");
}

function readArgValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : null;
}

function loadEnvFile() {
  let envText = "";

  try {
    envText = readFileSync(".env", "utf8");
  } catch {
    return;
  }

  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
