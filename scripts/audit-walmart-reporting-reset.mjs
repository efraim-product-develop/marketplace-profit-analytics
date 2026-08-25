import { readFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";

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
const DELETE_BATCH_SIZE = 500;
const REPORTING_IMPORT_KINDS = ["sales", "settlements", "advertising", "inventory"];

await main();

async function main() {
  try {
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
    const counts = await readCounts({ organizationIds, marketplace });
    const breakdowns = await readBreakdowns({ organizationIds, marketplace });
    const preserved = await readPreservedCounts({ organizationIds, marketplace });

    printPlan({ organizations, marketplace, counts, breakdowns, preserved });

    if (!confirmed) {
      console.log("");
      console.log("Dry run only. No data was deleted.");
      console.log("After approval, re-run with --confirm to execute the scoped cleanup.");
      return;
    }

    const deleted = await deleteReportingData({ organizationIds, marketplace });

    console.log("");
    console.log("Deleted Walmart reporting data");
    console.table(deleted);
    console.log("Cleanup complete.");
  } finally {
    await prisma.$disconnect();
  }
}

async function readCounts({ organizationIds, marketplace }) {
  const salesOrderWhere = scopedWhere(organizationIds, marketplace);
  const importRunWhere = {
    organizationId: { in: organizationIds },
    marketplace,
    importKind: { in: REPORTING_IMPORT_KINDS }
  };

  const [
    salesOrders,
    salesOrderItems,
    marketplaceDailyTotals,
    marketplaceFees,
    refunds,
    advertisingCosts,
    salesImports,
    salesImportIssues,
    importRuns,
    importRunIssues,
    importRunPreviewRows
  ] = await Promise.all([
    prisma.salesOrder.count({ where: salesOrderWhere }),
    prisma.salesOrderItem.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.marketplaceDailyTotal.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.marketplaceFee.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.refund.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.advertisingCost.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.salesImport.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.salesImportIssue.count({
      where: {
        organizationId: { in: organizationIds },
        import: { is: { marketplace } }
      }
    }),
    prisma.importRun.count({ where: importRunWhere }),
    prisma.importRunIssue.count({
      where: {
        organizationId: { in: organizationIds },
        importRun: { is: { marketplace, importKind: { in: REPORTING_IMPORT_KINDS } } }
      }
    }),
    prisma.importRunPreviewRow.count({
      where: {
        organizationId: { in: organizationIds },
        importRun: { is: { marketplace, importKind: { in: REPORTING_IMPORT_KINDS } } }
      }
    })
  ]);

  const settlementDerivedFees = await countRowsByMetadataSource(
    "MarketplaceFee",
    organizationIds,
    marketplace,
    "walmart_payments_new"
  );
  const settlementDerivedRefunds = await countRowsByMetadataSource(
    "Refund",
    organizationIds,
    marketplace,
    "walmart_payments_new"
  );
  const settlementDerivedSem = await countAdvertisingBySource(
    organizationIds,
    marketplace,
    "walmart_seller_center_sem"
  );
  const walmartConnectAdvertising = await countAdvertisingBySource(
    organizationIds,
    marketplace,
    "walmart_connect_item_performance"
  );
  const legacySemAdvertising = await countAdvertisingBySource(
    organizationIds,
    marketplace,
    "seller_center_sem"
  );

  return {
    salesOrders,
    salesOrderItems,
    marketplaceDailyTotals,
    marketplaceFees,
    settlementDerivedFees,
    refunds,
    settlementDerivedRefunds,
    advertisingCosts,
    walmartConnectAdvertising,
    settlementDerivedSem,
    legacySemAdvertising,
    salesImports,
    salesImportIssues,
    importRuns,
    importRunIssues,
    importRunPreviewRows,
    derivedCacheRows: marketplaceDailyTotals
  };
}

async function readBreakdowns({ organizationIds, marketplace }) {
  const [feesByType, adsBySource, importRunsByKindAndType, ordersByStatus] = await Promise.all([
    prisma.marketplaceFee.groupBy({
      by: ["feeType"],
      where: scopedWhere(organizationIds, marketplace),
      _count: { _all: true },
      _sum: { feeAmount: true },
      orderBy: { feeType: "asc" }
    }),
    prisma.advertisingCost.groupBy({
      by: ["source"],
      where: scopedWhere(organizationIds, marketplace),
      _count: { _all: true },
      _sum: { amount: true },
      orderBy: { source: "asc" }
    }),
    prisma.importRun.groupBy({
      by: ["importKind", "reportType", "source"],
      where: {
        organizationId: { in: organizationIds },
        marketplace,
        importKind: { in: REPORTING_IMPORT_KINDS }
      },
      _count: { _all: true },
      orderBy: [{ importKind: "asc" }, { reportType: "asc" }, { source: "asc" }]
    }),
    prisma.salesOrder.groupBy({
      by: ["status"],
      where: scopedWhere(organizationIds, marketplace),
      _count: { _all: true },
      orderBy: { status: "asc" }
    })
  ]);

  return {
    feesByType: feesByType.map((row) => ({
      feeType: row.feeType,
      rows: row._count._all,
      totalAmount: decimalToNumber(row._sum.feeAmount)
    })),
    adsBySource: adsBySource.map((row) => ({
      source: row.source,
      rows: row._count._all,
      totalAmount: decimalToNumber(row._sum.amount)
    })),
    importRunsByKindAndType: importRunsByKindAndType.map((row) => ({
      importKind: row.importKind,
      reportType: row.reportType,
      source: row.source,
      rows: row._count._all
    })),
    ordersByStatus: ordersByStatus.map((row) => ({
      status: row.status ?? "(blank)",
      rows: row._count._all
    }))
  };
}

async function readPreservedCounts({ organizationIds, marketplace }) {
  const [
    organizations,
    products,
    listings,
    costUploads,
    costUploadIssues,
    cogsBatches,
    costRecords,
    marketplaceConnections,
    organizationSettings
  ] = await Promise.all([
    prisma.organization.count({ where: { id: { in: organizationIds } } }),
    prisma.product.count({ where: { organizationId: { in: organizationIds } } }),
    prisma.listing.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.costUpload.count({
      where: {
        organizationId: { in: organizationIds },
        OR: [{ marketplace }, { marketplace: null }]
      }
    }),
    prisma.costUploadIssue.count({
      where: {
        organizationId: { in: organizationIds },
        upload: { is: { OR: [{ marketplace }, { marketplace: null }] } }
      }
    }),
    prisma.cogsBatch.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.costRecord.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.marketplaceConnection.count({ where: scopedWhere(organizationIds, marketplace) }),
    prisma.organizationSettings.count({ where: { organizationId: { in: organizationIds } } })
  ]);

  return {
    organizations,
    organizationSettings,
    marketplaceConnections,
    products,
    listings,
    costUploads,
    costUploadIssues,
    cogsBatches,
    costRecords
  };
}

async function deleteReportingData({ organizationIds, marketplace }) {
  const deleted = {};
  const scope = scopedWhere(organizationIds, marketplace);
  const importRunWhere = {
    organizationId: { in: organizationIds },
    marketplace,
    importKind: { in: REPORTING_IMPORT_KINDS }
  };

  deleted.marketplaceDailyTotals = (
    await prisma.marketplaceDailyTotal.deleteMany({ where: scope })
  ).count;

  deleted.marketplaceFees = (await prisma.marketplaceFee.deleteMany({ where: scope })).count;
  deleted.refunds = (await prisma.refund.deleteMany({ where: scope })).count;
  deleted.advertisingCosts = (await prisma.advertisingCost.deleteMany({ where: scope })).count;
  deleted.salesOrders = await deleteSalesOrdersInBatches(scope);
  deleted.salesImports = (await prisma.salesImport.deleteMany({ where: scope })).count;
  deleted.importRuns = (await prisma.importRun.deleteMany({ where: importRunWhere })).count;

  return deleted;
}

async function deleteSalesOrdersInBatches(where) {
  let totalDeleted = 0;

  while (true) {
    const batch = await prisma.salesOrder.findMany({
      where,
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
    console.log(`Deleted ${totalDeleted} sales orders...`);
  }
}

function printPlan({ organizations, marketplace, counts, breakdowns, preserved }) {
  console.log("Walmart reporting reset audit");
  console.log(`Marketplace: ${marketplace}`);
  console.log(
    `Organizations: ${organizations
      .map((organization) => `${organization.name} (${organization.slug})`)
      .join(", ")}`
  );
  console.log("");
  console.log("Rows proposed for deletion");
  console.table([
    row("Sales", "SalesOrder", counts.salesOrders, "Walmart PO/order rows plus any archived retired sales-summary rows."),
    row("Sales", "SalesOrderItem", counts.salesOrderItems, "Walmart sales/order lines. These are cascaded by SalesOrder deletion."),
    row("Derived/Cache Data", "MarketplaceDailyTotal", counts.marketplaceDailyTotals, "Legacy account-summary daily totals and cached daily sales totals."),
    row("Commission/Fulfillment", "MarketplaceFee", counts.marketplaceFees, "All Walmart fee rows, including commission, fulfillment, settlement adjustments, and order-linked fees."),
    row("Settlements", "MarketplaceFee metadata.source=walmart_payments_new", counts.settlementDerivedFees, "Settlement-derived fee rows included in MarketplaceFee."),
    row("Settlements", "Refund metadata.source=walmart_payments_new", counts.settlementDerivedRefunds, "Settlement-derived refund audit rows."),
    row("Sales", "Refund", counts.refunds, "All Walmart refund rows from sales/order imports and settlement audit rows."),
    row("Walmart Connect Advertising", "AdvertisingCost source=walmart_connect_item_performance", counts.walmartConnectAdvertising, "Walmart Connect daily/monthly/cumulative advertising uploads."),
    row("SEM", "AdvertisingCost source=walmart_seller_center_sem", counts.settlementDerivedSem, "Settlement-derived Seller Center SEM rows."),
    row("SEM", "AdvertisingCost source=seller_center_sem", counts.legacySemAdvertising, "Legacy manually uploaded SEM rows."),
    row("Walmart Connect Advertising / SEM", "AdvertisingCost", counts.advertisingCosts, "All Walmart advertising rows for the marketplace."),
    row("Import/Sync History", "SalesImport", counts.salesImports, "Legacy/direct sales import history for Walmart."),
    row("Import/Sync History", "SalesImportIssue", counts.salesImportIssues, "Row-level legacy/direct sales import issues. These cascade from SalesImport deletion."),
    row("Import/Sync History", "ImportRun", counts.importRuns, "Generic Walmart reporting import runs for sales, settlements, advertising, and inventory."),
    row("Import/Sync History", "ImportRunIssue", counts.importRunIssues, "Generic import issues. These cascade from ImportRun deletion."),
    row("Import/Sync History", "ImportRunPreviewRow", counts.importRunPreviewRows, "Generic import preview rows. These cascade from ImportRun deletion."),
    row("Derived/Cache Data", "Dedicated P&L cache tables", 0, "No dedicated derived/cached P&L table exists in the current schema.")
  ]);

  console.log("");
  console.log("Fee breakdown");
  console.table(breakdowns.feesByType);
  console.log("");
  console.log("Advertising breakdown");
  console.table(breakdowns.adsBySource);
  console.log("");
  console.log("Import run breakdown");
  console.table(breakdowns.importRunsByKindAndType);
  console.log("");
  console.log("Sales order status breakdown");
  console.table(breakdowns.ordersByStatus);
  console.log("");
  console.log("Records explicitly preserved");
  console.table(preserved);
  console.log("");
  console.log("Foreign-key/cascade effects");
  console.log("- SalesOrder deletion cascades SalesOrderItem rows. MarketplaceFee and Refund rows are deleted explicitly first.");
  console.log("- SalesImport deletion cascades SalesImportIssue rows. SalesOrder.importId would be set null, but targeted SalesOrder rows are deleted.");
  console.log("- ImportRun deletion cascades ImportRunIssue and ImportRunPreviewRow rows. MarketplaceDailyTotal rows are deleted explicitly first.");
  console.log("- Product, Listing, CostUpload, CogsBatch, CostRecord, Organization, OrganizationSettings, and MarketplaceConnection are not deleted.");
  console.log("");
  console.log("Cleanup script");
  console.log("- scripts/audit-walmart-reporting-reset.mjs");
}

function row(category, table, rows, reason) {
  return { category, table, rows, reason };
}

async function countRowsByMetadataSource(tableName, organizationIds, marketplace, source) {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM ${Prisma.raw(`"${tableName}"`)}
    WHERE "organizationId" IN (${Prisma.join(organizationIds)})
      AND "marketplace" = ${marketplace}
      AND "metadata"->>'source' = ${source}
  `;

  return Number(rows[0]?.count ?? 0);
}

async function countAdvertisingBySource(organizationIds, marketplace, source) {
  return prisma.advertisingCost.count({
    where: {
      organizationId: { in: organizationIds },
      marketplace,
      source
    }
  });
}

function scopedWhere(organizationIds, marketplace) {
  return {
    organizationId: { in: organizationIds },
    marketplace
  };
}

function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  return Number(value);
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
