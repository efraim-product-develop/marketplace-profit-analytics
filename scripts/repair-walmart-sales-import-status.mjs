import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const marketplace = "walmart";
const confirmed = process.argv.includes("--confirm");

async function main() {
  const pendingImports = await prisma.salesImport.findMany({
    where: {
      marketplace,
      source: "generic_import_framework",
      status: "PENDING"
    },
    orderBy: { createdAt: "asc" }
  });

  const rows = [];

  for (const salesImport of pendingImports) {
    const [completedSibling, orderCount, itemCount, totals] = await Promise.all([
      prisma.salesImport.findFirst({
        where: {
          marketplace,
          source: salesImport.source,
          originalFileName: salesImport.originalFileName,
          status: { in: ["IMPORTED", "NEEDS_REVIEW"] },
          id: { not: salesImport.id }
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.salesOrder.count({ where: { importId: salesImport.id } }),
      prisma.salesOrderItem.count({ where: { order: { importId: salesImport.id } } }),
      prisma.salesOrderItem.aggregate({
        where: { order: { importId: salesImport.id } },
        _sum: { itemRevenue: true, quantity: true }
      })
    ]);

    const action =
      itemCount <= 0
        ? "mark_failed_empty"
        : completedSibling
          ? "mark_needs_review_recovered"
          : "leave_pending_no_completed_sibling";

    rows.push({
      id: salesImport.id,
      file: salesImport.originalFileName,
      createdAt: salesImport.createdAt.toISOString(),
      orderCount,
      itemCount,
      units: totals._sum.quantity ?? 0,
      gmv: totals._sum.itemRevenue?.toString() ?? "0",
      completedSiblingId: completedSibling?.id ?? "",
      action
    });
  }

  console.log("Walmart sales import status repair");
  console.log(`Mode: ${confirmed ? "CONFIRM" : "dry run"}`);
  console.table(rows);

  if (!confirmed) {
    console.log("Dry run only. Re-run with --confirm to apply these status repairs.");
    return;
  }

  for (const row of rows) {
    if (row.action === "mark_failed_empty") {
      await prisma.salesImport.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          importedCount: 0
        }
      });
    }

    if (row.action === "mark_needs_review_recovered") {
      await prisma.salesImport.update({
        where: { id: row.id },
        data: {
          status: "NEEDS_REVIEW",
          importedCount: row.itemCount
        }
      });
    }
  }

  console.log("Repair complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
