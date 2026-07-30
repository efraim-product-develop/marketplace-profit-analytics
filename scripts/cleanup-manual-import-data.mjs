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
const DELETE_BATCH_SIZE = 500;

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

    printPlan({ organizations, marketplace, counts });

    if (!confirmed) {
      console.log("");
      console.log("Dry run only. Re-run with --confirm to delete this data.");
      return;
    }

    const deleted = await deleteManualImportData({ organizationIds, marketplace });

    console.log("");
    console.log("Deleted manual import data");
    console.table(deleted);
    console.log("Cleanup complete.");
  } finally {
    await prisma.$disconnect();
  }
}

async function deleteManualImportData({ organizationIds, marketplace }) {
  const deleted = {};

  deleted.salesOrders = await deleteSalesOrdersInBatches({ organizationIds, marketplace });

  deleted.marketplaceDailyTotals = (
    await prisma.marketplaceDailyTotal.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.marketplaceFees = (
    await prisma.marketplaceFee.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.refunds = (
    await prisma.refund.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.advertisingCosts = (
    await prisma.advertisingCost.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.costRecords = (
    await prisma.costRecord.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.cogsBatches = (
    await prisma.cogsBatch.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.costUploads = (
    await prisma.costUpload.deleteMany({
      where: {
        organizationId: { in: organizationIds },
        OR: [{ marketplace }, { marketplace: null }]
      }
    })
  ).count;

  deleted.salesImports = (
    await prisma.salesImport.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.importRuns = (
    await prisma.importRun.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.listings = (
    await prisma.listing.deleteMany({
      where: { organizationId: { in: organizationIds }, marketplace }
    })
  ).count;

  deleted.products = (
    await prisma.product.deleteMany({
      where: { organizationId: { in: organizationIds } }
    })
  ).count;

  return deleted;
}

async function deleteSalesOrdersInBatches({ organizationIds, marketplace }) {
  let totalDeleted = 0;

  while (true) {
    const batch = await prisma.salesOrder.findMany({
      where: { organizationId: { in: organizationIds }, marketplace },
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

async function readCounts({ organizationIds, marketplace }) {
  const counts = {};

  counts.salesOrders = await prisma.salesOrder.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.salesOrderItems = await prisma.salesOrderItem.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.marketplaceDailyTotals = await prisma.marketplaceDailyTotal.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.marketplaceFees = await prisma.marketplaceFee.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.refunds = await prisma.refund.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.advertisingCosts = await prisma.advertisingCost.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.costRecords = await prisma.costRecord.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.cogsBatches = await prisma.cogsBatch.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.costUploads = await prisma.costUpload.count({
    where: {
      organizationId: { in: organizationIds },
      OR: [{ marketplace }, { marketplace: null }]
    }
  });
  counts.costUploadIssues = await prisma.costUploadIssue.count({
      where: {
        organizationId: { in: organizationIds },
        upload: { is: { OR: [{ marketplace }, { marketplace: null }] } }
      }
  });
  counts.salesImports = await prisma.salesImport.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.salesImportIssues = await prisma.salesImportIssue.count({
    where: { organizationId: { in: organizationIds }, import: { is: { marketplace } } }
  });
  counts.importRuns = await prisma.importRun.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.importRunIssues = await prisma.importRunIssue.count({
    where: { organizationId: { in: organizationIds }, importRun: { is: { marketplace } } }
  });
  counts.importRunPreviewRows = await prisma.importRunPreviewRow.count({
    where: { organizationId: { in: organizationIds }, importRun: { is: { marketplace } } }
  });
  counts.listings = await prisma.listing.count({
    where: { organizationId: { in: organizationIds }, marketplace }
  });
  counts.products = await prisma.product.count({
    where: { organizationId: { in: organizationIds } }
  });

  return counts;
}

function printPlan({ organizations, marketplace, counts }) {
  console.log("Manual import cleanup target");
  console.log(`Marketplace: ${marketplace}`);
  console.log(
    `Organizations: ${organizations
      .map((organization) => `${organization.name} (${organization.slug})`)
      .join(", ")}`
  );
  console.log("");
  console.table(counts);
  console.log("");
  console.log("Will keep: organization, settings, marketplace connections, and Prisma migrations.");
  console.log(
    "Will delete: sales/order rows, generic import history, sales import history, settlement fees/refunds, ad spend, COGS uploads/history, products, and listings."
  );
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
