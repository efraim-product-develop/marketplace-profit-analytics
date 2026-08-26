import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

loadEnvFile();

const args = parseArgs(process.argv.slice(2));
const sellerSku = optionalString(args.sku);
const parentSku = optionalString(args.parent ?? "DISCONTINUED");
const parentTitle = optionalString(args["parent-title"] ?? "Discontinued");
const marketplace = optionalString(args.marketplace ?? "walmart");
const confirmed = args.confirm === "true";
const prisma = new PrismaClient();

try {
  await main();
} finally {
  await prisma.$disconnect();
}

async function main() {
  if (!sellerSku) {
    throw new Error("Missing --sku. Example: pnpm run catalog:map-sku-parent -- --sku=INSPNG-CS10-XL --parent=DISCONTINUED --confirm");
  }

  if (!parentSku) {
    throw new Error("Missing --parent.");
  }

  if (!marketplace) {
    throw new Error("Missing --marketplace.");
  }

  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true }
  });

  if (!organization) {
    throw new Error("No organization found.");
  }

  const before = await readCurrentState(organization.id);

  console.log("SKU parent mapping target");
  console.table({
    organization: organization.name,
    marketplace,
    sellerSku,
    parentSku,
    parentTitle,
    confirmed
  });

  console.log("Current state");
  console.table(before);

  if (!confirmed) {
    console.log("Dry run only. Re-run with --confirm to apply this mapping.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const parentProduct = await tx.product.upsert({
      where: {
        organizationId_internalSku: {
          organizationId: organization.id,
          internalSku: parentSku
        }
      },
      create: {
        organizationId: organization.id,
        internalSku: parentSku,
        title: parentTitle
      },
      update: {
        title: parentTitle
      },
      select: { id: true }
    });

    const childProduct = await tx.product.upsert({
      where: {
        organizationId_internalSku: {
          organizationId: organization.id,
          internalSku: sellerSku
        }
      },
      create: {
        organizationId: organization.id,
        internalSku: sellerSku,
        parentSku,
        title: sellerSku
      },
      update: {
        parentSku
      },
      select: { id: true }
    });

    await tx.listing.upsert({
      where: {
        organizationId_marketplace_sellerSku: {
          organizationId: organization.id,
          marketplace,
          sellerSku
        }
      },
      create: {
        organizationId: organization.id,
        productId: childProduct.id,
        marketplace,
        sellerSku,
        parentSku,
        title: sellerSku
      },
      update: {
        productId: childProduct.id,
        parentSku
      }
    });

    const [orderItems, costRecords] = await Promise.all([
      tx.salesOrderItem.updateMany({
        where: {
          organizationId: organization.id,
          marketplace,
          sellerSku
        },
        data: {
          productId: childProduct.id,
          parentSku
        }
      }),
      tx.costRecord.updateMany({
        where: {
          organizationId: organization.id,
          marketplace,
          sellerSku
        },
        data: {
          productId: childProduct.id,
          parentSku
        }
      })
    ]);

    return {
      parentProductId: parentProduct.id,
      childProductId: childProduct.id,
      orderItemsUpdated: orderItems.count,
      costRecordsUpdated: costRecords.count
    };
  });

  const after = await readCurrentState(organization.id);

  console.log("Updated state");
  console.table(after);
  console.log("Mapping applied.");
  console.table(result);
}

async function readCurrentState(organizationId) {
  const [parentProduct, childProduct, listing, orderItems, costRecords] = await Promise.all([
    prisma.product.findUnique({
      where: {
        organizationId_internalSku: {
          organizationId,
          internalSku: parentSku
        }
      },
      select: { internalSku: true, title: true, parentSku: true }
    }),
    prisma.product.findUnique({
      where: {
        organizationId_internalSku: {
          organizationId,
          internalSku: sellerSku
        }
      },
      select: { internalSku: true, title: true, parentSku: true }
    }),
    prisma.listing.findUnique({
      where: {
        organizationId_marketplace_sellerSku: {
          organizationId,
          marketplace,
          sellerSku
        }
      },
      select: { sellerSku: true, parentSku: true, title: true }
    }),
    prisma.salesOrderItem.count({
      where: { organizationId, marketplace, sellerSku }
    }),
    prisma.costRecord.count({
      where: { organizationId, marketplace, sellerSku }
    })
  ]);

  return {
    parentProduct: parentProduct
      ? `${parentProduct.internalSku} / ${parentProduct.title ?? "-"}`
      : "missing",
    childProductParent: childProduct?.parentSku ?? "missing",
    listingParent: listing?.parentSku ?? "missing",
    orderItemsForSku: orderItems,
    costRecordsForSku: costRecords
  };
}

function loadEnvFile() {
  const envPath = resolve(".env");
  let contents = "";

  try {
    contents = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

function parseArgs(values) {
  return values.reduce((result, value) => {
    if (!value.startsWith("--")) {
      return result;
    }

    const [key, rawValue] = value.slice(2).split("=");
    result[key] = rawValue ?? "true";
    return result;
  }, {});
}

function optionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const stringValue = String(value).trim();
  return stringValue || null;
}
