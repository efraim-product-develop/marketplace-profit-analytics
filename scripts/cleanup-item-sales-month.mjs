import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

loadEnvFile();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: withConnectionLimit(process.env.DATABASE_URL)
    }
  }
});
const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const marketplace = readArgValue("--marketplace") ?? "walmart";
const organizationSlug = readArgValue("--organization-slug");
const month = readArgValue("--month");
const DELETE_BATCH_SIZE = 500;

await main();

async function main() {
  try {
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new Error("Pass the target month as --month=YYYY-MM, for example --month=2026-06.");
    }

    const organizations = await prisma.organization.findMany({
      where: organizationSlug ? { slug: organizationSlug } : undefined,
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
    const { start, end } = getMonthRange(month);
    const orderWhere = buildItemSalesOrderWhere({ organizationIds, marketplace, start, end });
    const salesImportIds = await findSalesImportIds(orderWhere);
    const importRunIds = await findItemSalesImportRunIds({
      organizationIds,
      marketplace,
      month
    });
    const counts = await readCounts({ orderWhere, salesImportIds, importRunIds });
    const recentRuns = await readRecentItemSalesRuns({ organizationIds, marketplace });

    printPlan({
      organizations,
      marketplace,
      month,
      counts,
      recentRuns
    });

    if (!confirmed) {
      console.log("");
      console.log("Dry run only. Re-run with --confirm to delete this data.");
      return;
    }

    const deletedOrders = await deleteSalesOrdersInBatches(orderWhere);
    const deletedSalesImports = salesImportIds.length
      ? await prisma.salesImport.deleteMany({ where: { id: { in: salesImportIds } } })
      : { count: 0 };
    const deletedImportRuns = importRunIds.length
      ? await prisma.importRun.deleteMany({ where: { id: { in: importRunIds } } })
      : { count: 0 };

    console.log("");
    console.log("Deleted Walmart Item Sales data");
    console.table({
      salesOrders: deletedOrders,
      salesImports: deletedSalesImports.count,
      importRuns: deletedImportRuns.count
    });
    console.log("Cleanup complete.");
  } finally {
    await prisma.$disconnect();
  }
}

function buildItemSalesOrderWhere({ organizationIds, marketplace, start, end }) {
  return {
    organizationId: { in: organizationIds },
    marketplace,
    orderDate: { gte: start, lte: end },
    OR: [
      { status: "daily_summary" },
      { status: "monthly_summary" },
      { externalOrderId: { startsWith: "walmart-item-sales:" } },
      { salesImport: { is: { source: "walmart_item_sales_import" } } }
    ]
  };
}

async function findSalesImportIds(orderWhere) {
  const orders = await prisma.salesOrder.findMany({
    where: {
      ...orderWhere,
      importId: { not: null }
    },
    select: { importId: true },
    distinct: ["importId"]
  });

  return orders.flatMap((order) => (order.importId ? [order.importId] : []));
}

async function findItemSalesImportRunIds({ organizationIds, marketplace, month }) {
  const runs = await prisma.importRun.findMany({
    where: {
      organizationId: { in: organizationIds },
      marketplace,
      importKind: "sales",
      reportType: "walmart_item_sales"
    },
    select: {
      id: true,
      options: true,
      summary: true
    }
  });

  return runs
    .filter((run) => importRunMatchesMonth(run, month))
    .map((run) => run.id);
}

function importRunMatchesMonth(run, month) {
  const optionRecord = toRecord(run.options);
  const summaryRecord = toRecord(run.summary);
  const candidates = [
    optionRecord.reportDate,
    optionRecord.reportMonth,
    summaryRecord.reportDate,
    summaryRecord.reportMonth
  ];

  return candidates.some((value) => typeof value === "string" && value.startsWith(month));
}

async function readCounts({ orderWhere, salesImportIds, importRunIds }) {
  const counts = {};

  counts.salesOrders = await prisma.salesOrder.count({ where: orderWhere });
  counts.salesOrderItems = await prisma.salesOrderItem.count({
    where: { order: { is: orderWhere } }
  });
  counts.orderLinkedFees = await prisma.marketplaceFee.count({
    where: { order: { is: orderWhere } }
  });
  counts.orderLinkedRefunds = await prisma.refund.count({
    where: { order: { is: orderWhere } }
  });
  counts.salesImports = salesImportIds.length
    ? await prisma.salesImport.count({ where: { id: { in: salesImportIds } } })
    : 0;
  counts.salesImportIssues = salesImportIds.length
    ? await prisma.salesImportIssue.count({ where: { importId: { in: salesImportIds } } })
    : 0;
  counts.importRuns = importRunIds.length
    ? await prisma.importRun.count({ where: { id: { in: importRunIds } } })
    : 0;
  counts.importRunIssues = importRunIds.length
    ? await prisma.importRunIssue.count({ where: { importRunId: { in: importRunIds } } })
    : 0;
  counts.importRunPreviewRows = importRunIds.length
    ? await prisma.importRunPreviewRow.count({ where: { importRunId: { in: importRunIds } } })
    : 0;

  return counts;
}

async function readRecentItemSalesRuns({ organizationIds, marketplace }) {
  const runs = await prisma.importRun.findMany({
    where: {
      organizationId: { in: organizationIds },
      marketplace,
      importKind: "sales",
      reportType: "walmart_item_sales"
    },
    select: {
      id: true,
      originalFileName: true,
      status: true,
      createdAt: true,
      importedAt: true,
      options: true,
      summary: true
    },
    orderBy: { createdAt: "desc" },
    take: 10
  });

  return runs.map((run) => {
    const options = toRecord(run.options);
    const summary = toRecord(run.summary);

    return {
      id: run.id,
      file: run.originalFileName,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      importedAt: run.importedAt?.toISOString() ?? "",
      reportDate: readText(options.reportDate) || readText(summary.reportDate),
      reportMonth: readText(options.reportMonth) || readText(summary.reportMonth)
    };
  });
}

async function deleteSalesOrdersInBatches(orderWhere) {
  let totalDeleted = 0;

  while (true) {
    const batch = await prisma.salesOrder.findMany({
      where: orderWhere,
      select: { id: true },
      orderBy: { id: "asc" },
      take: DELETE_BATCH_SIZE
    });

    if (!batch.length) {
      return totalDeleted;
    }

    const result = await prisma.salesOrder.deleteMany({
      where: { id: { in: batch.map((order) => order.id) } }
    });

    totalDeleted += result.count;
    console.log(`Deleted ${totalDeleted} Item Sales rows...`);
  }
}

function printPlan({ organizations, marketplace, month, counts, recentRuns }) {
  console.log("Walmart Item Sales cleanup target");
  console.log(`Marketplace: ${marketplace}`);
  console.log(`Month: ${month}`);
  console.log(
    `Organizations: ${organizations
      .map((organization) => `${organization.name} (${organization.slug})`)
      .join(", ")}`
  );
  console.log("");
  console.table(counts);
  console.log("");
  console.log("Will keep: COGS, settlements, refunds, advertising, products, listings, settings.");
  console.log(
    "Will delete: Item Sales rows dated in this month and matching Item Sales import history."
  );

  if (recentRuns.length) {
    console.log("");
    console.log("Recent Walmart Item Sales import runs");
    console.table(recentRuns);
  }
}

function getMonthRange(month) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  return {
    start: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999))
  };
}

function readArgValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : null;
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readText(value) {
  return typeof value === "string" ? value : "";
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

function withConnectionLimit(databaseUrl) {
  if (!databaseUrl) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    url.searchParams.set("connection_limit", "1");
    url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return databaseUrl;
  }
}
