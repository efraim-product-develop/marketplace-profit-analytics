import { PrismaClient } from "@prisma/client";
import { getWalmartDataQualityAudit } from "../src/server/audit/walmart-data-quality.ts";

const prisma = new PrismaClient();
const args = parseArgs(process.argv.slice(2));
const marketplace = args.marketplace ?? "walmart";
const from = parseDateArg(args.from, "from");
const to = parseDateArg(args.to, "to");

try {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" }
  });

  if (!organization) {
    throw new Error("No organization found.");
  }

  const audit = await getWalmartDataQualityAudit({
    organizationId: organization.id,
    marketplace,
    dateRange: { from, to }
  });

  console.log("Walmart P&L data quality validation");
  console.table({
    organization: organization.name,
    marketplace,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    overallStatus: audit.overallStatus
  });

  console.log("MARKETPLACE P&L");
  console.table(audit.marketplacePnl);

  console.log("PRODUCT P&L AGGREGATE");
  console.table(audit.productPnl);

  console.log("MARKETPLACE-ONLY / UNALLOCATED");
  console.table({
    sellerCenterSem: audit.attribution.sellerCenterSem.amount,
    unallocatedRefunds: audit.attribution.refunds.unallocated,
    unallocatedCommission: audit.attribution.marketplaceCommission.unallocated,
    unallocatedFulfillmentFees: audit.attribution.fulfillmentFees.unallocated,
    unallocatedWalmartConnectAdvertising: audit.attribution.walmartConnectAdvertising.unallocated,
    otherWalmartFeesAndAdjustments: audit.attribution.otherWalmartFeesAndAdjustments.amount
  });

  console.log("DATA COVERAGE");
  console.table(audit.checklist);

  if (audit.missingReasons.length) {
    console.log("MISSING / UNCERTAIN");
    for (const reason of audit.missingReasons) {
      console.log(`- ${reason}`);
    }
  }
} finally {
  await prisma.$disconnect();
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
