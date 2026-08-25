import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

loadEnvFile();

const args = parseArgs(process.argv.slice(2));
const marketplace = args.marketplace ?? "walmart";
const limit = Number(args.limit ?? 200);
const outputPath = resolve(args.output ?? "outputs/virtual-pack-parent-grouping-audit.md");
const skuFilter = args.sku ? new Set(String(args.sku).split(",").map(normalizeSku)) : null;

const prisma = new PrismaClient();

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

  const itemSalesMappings = await getLatestItemSalesMappings(organization.id, marketplace);
  const catalogMappings = await getCatalogMappings(organization.id, marketplace);
  const mappings = itemSalesMappings.size ? itemSalesMappings : catalogMappings;
  const mappingSource = itemSalesMappings.size ? "Item Sales mapping importer" : "Catalog fallback";
  const poRows = await getPoSalesBySku(organization.id, marketplace);
  const poBySku = new Map(poRows.map((row) => [normalizeSku(row.sellerSku), row]));

  const auditedRows = Array.from(mappings.values())
    .filter((row) => !skuFilter || skuFilter.has(normalizeSku(row.sellerSku)))
    .map((mapping) => {
      const normalizedSku = normalizeSku(mapping.sellerSku);
      const po = poBySku.get(normalizedSku) ?? null;
      const catalogParent = catalogMappings.get(normalizedSku)?.parentSku ?? null;
      const storedPoParent = po?.storedParentSku ?? null;
      const resolvedParent = catalogParent ?? storedPoParent ?? null;
      const parentMatches = resolvedParent === mapping.parentSku;
      const matchingPoSku = po?.sellerSku ?? null;

      return {
        sellerSku: mapping.sellerSku,
        itemSalesParent: mapping.parentSku,
        matchingPoSku,
        storedPoParent,
        catalogParent,
        resolvedParent,
        poGrossSales: po?.grossSales ?? 0,
        units: po?.units ?? 0,
        orders: po?.orders ?? 0,
        itemName: mapping.itemName ?? catalogMappings.get(normalizedSku)?.itemName ?? null,
        virtualSignal: getVirtualSignal(mapping, catalogMappings.get(normalizedSku)),
        status: !po
          ? "No PO sales"
          : !resolvedParent
            ? "Unmapped"
            : parentMatches
              ? "Correct"
              : "Mismatch"
      };
    });

  const rowsWithPo = auditedRows.filter((row) => row.matchingPoSku);
  const virtualRows = auditedRows.filter((row) => row.virtualSignal !== "None");
  const reportedRows = (virtualRows.length ? virtualRows : rowsWithPo)
    .sort((a, b) => b.poGrossSales - a.poGrossSales)
    .slice(0, limit);

  const unmappedPoRows = poRows
    .filter((row) => {
      const mapping = mappings.get(normalizeSku(row.sellerSku));
      const catalogParent = catalogMappings.get(normalizeSku(row.sellerSku))?.parentSku ?? null;
      return !mapping?.parentSku && !catalogParent && !row.storedParentSku;
    })
    .sort((a, b) => b.grossSales - a.grossSales)
    .slice(0, limit);

  const formatMoney = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  });
  const lines = [
    "# Virtual-Pack Parent Grouping Audit",
    "",
    `Organization: ${organization.name} (${organization.id})`,
    `Marketplace: ${marketplace}`,
    `Mapping source used: ${mappingSource}`,
    `Item Sales mapping rows found: ${itemSalesMappings.size}`,
    `Current catalog parent mappings found: ${catalogMappings.size}`,
    `PO SKUs with sales found: ${poRows.length}`,
    "",
    "## Important Finding",
    "",
    itemSalesMappings.size
      ? "The Item Sales mapping importer has stored SKU-to-parent relationships. Its parser ignores Item Sales financial columns, and P&L reads sales from PO order lines."
      : "No Item Sales mapping import runs were found in import history. This report used current catalog mappings as a fallback, so it can verify current behavior but cannot prove each mapping originally came from Item Sales.",
    "",
    virtualRows.length
      ? "Rows below include mappings with an explicit virtual/pack signal in imported SKU, parent, or item text."
      : "No explicit virtual-pack marker was found in the stored Item Sales mapping data. To avoid guessing from SKU names, the table below shows parent-mapped Item Sales SKUs that also appear in PO sales.",
    "",
    "## Mapping Results",
    "",
    "| Virtual-pack SKU | Item Sales Parent | Matching PO SKU | Parent resolution result | PO Gross Sales | Units | Mapping status |",
    "| --- | --- | --- | --- | ---: | ---: | --- |",
    ...reportedRows.map((row) =>
      [
        row.sellerSku,
        row.itemSalesParent,
        row.matchingPoSku ?? "Not found",
        row.resolvedParent ?? "Unmapped",
        formatMoney.format(row.poGrossSales),
        String(row.units),
        row.status
      ].map(escapeMarkdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |")
    ),
    "",
    "## PO SKUs With No Parent Mapping",
    "",
    unmappedPoRows.length
      ? "| PO SKU | PO Gross Sales | Units | Orders |\n| --- | ---: | ---: | ---: |\n" +
        unmappedPoRows
          .map((row) =>
            [
              row.sellerSku,
              formatMoney.format(row.grossSales),
              String(row.units),
              String(row.orders)
            ].map(escapeMarkdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |")
          )
          .join("\n")
      : "No PO SKUs with sales are currently missing a parent mapping.",
    "",
    "## How Parent Resolution Works",
    "",
    "- Item Sales mapping imports create/update Product and Listing parentSku values.",
    "- PO imports store order-line sellerSku and copy the current parent mapping when available.",
    "- P&L re-checks catalog parent mappings at query time, so a SKU can remain its own SKU P&L row while rolling up to the mapped Parent P&L.",
    "- Item Sales financial values are excluded from P&L by the importer and are not used by the P&L queries.",
    "",
    "## Potential SKU Format Issues",
    "",
    getSkuFormatIssueSummary(Array.from(mappings.values()), poRows),
    ""
  ];

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log("Virtual-pack parent grouping audit complete.");
  console.table({
    organization: organization.name,
    marketplace,
    mappingSource,
    itemSalesMappings: itemSalesMappings.size,
    catalogMappings: catalogMappings.size,
    poSkusWithSales: poRows.length,
    explicitVirtualRows: virtualRows.length,
    reportedRows: reportedRows.length,
    unmappedPoSkus: unmappedPoRows.length,
    report: outputPath
  });

  console.table(
    reportedRows.slice(0, 30).map((row) => ({
      sku: row.sellerSku,
      itemSalesParent: row.itemSalesParent,
      matchingPoSku: row.matchingPoSku ?? "Not found",
      resolvedParent: row.resolvedParent ?? "Unmapped",
      poGrossSales: roundMoney(row.poGrossSales),
      units: row.units,
      status: row.status
    }))
  );

  if (unmappedPoRows.length) {
    console.log("Top PO SKUs currently missing a parent mapping:");
    console.table(
      unmappedPoRows.slice(0, 30).map((row) => ({
        sku: row.sellerSku,
        grossSales: roundMoney(row.grossSales),
        units: row.units,
        orders: row.orders
      }))
    );
  }
}

async function getLatestItemSalesMappings(organizationId, marketplace) {
  const runs = await prisma.importRun.findMany({
    where: {
      organizationId,
      marketplace,
      reportType: "walmart_item_sales_product_mapping",
      status: { in: ["IMPORTED", "NEEDS_REVIEW"] }
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      originalFileName: true,
      parsedPayload: true,
      createdAt: true
    }
  });
  const mappings = new Map();

  for (const run of runs) {
    const payloadRows = Array.isArray(run.parsedPayload?.rows) ? run.parsedPayload.rows : [];

    for (const row of payloadRows) {
      const sellerSku = normalizeSku(row?.sellerSku);
      const parentSku = normalizeSku(row?.parentSku);

      if (!sellerSku || !parentSku) {
        continue;
      }

      mappings.set(sellerSku, {
        sellerSku,
        parentSku,
        itemId: optionalString(row?.itemId),
        itemName: optionalString(row?.itemName),
        sourceRunId: run.id,
        sourceFile: run.originalFileName,
        sourceImportedAt: run.createdAt
      });
    }
  }

  return mappings;
}

async function getCatalogMappings(organizationId, marketplace) {
  const listings = await prisma.listing.findMany({
    where: {
      organizationId,
      marketplace,
      parentSku: { not: null }
    },
    include: {
      product: {
        select: { title: true, parentSku: true }
      }
    }
  });
  const mappings = new Map();

  for (const listing of listings) {
    const sellerSku = normalizeSku(listing.sellerSku);
    const parentSku = normalizeSku(listing.parentSku ?? listing.product?.parentSku);

    if (!sellerSku || !parentSku) {
      continue;
    }

    mappings.set(sellerSku, {
      sellerSku,
      parentSku,
      itemId: optionalString(listing.marketplaceItemId),
      itemName: optionalString(listing.title ?? listing.product?.title),
      sourceRunId: null,
      sourceFile: "current catalog",
      sourceImportedAt: null
    });
  }

  return mappings;
}

async function getPoSalesBySku(organizationId, marketplace) {
  const rows = await prisma.$queryRaw`
    SELECT
      soi."sellerSku",
      MAX(soi."parentSku") FILTER (WHERE soi."parentSku" IS NOT NULL) AS "storedParentSku",
      COALESCE(SUM(soi."itemRevenue"), 0)::float AS "grossSales",
      COALESCE(SUM(soi."quantity"), 0)::int AS "units",
      COUNT(DISTINCT so."externalOrderId")::int AS "orders"
    FROM "SalesOrderItem" soi
    JOIN "SalesOrder" so ON so.id = soi."orderId"
    LEFT JOIN "SalesImport" si ON si.id = so."importId"
    WHERE soi."organizationId" = ${organizationId}
      AND soi."marketplace" = ${marketplace}
      AND so.status = 'PO_DETAIL'
      AND soi."quantity" > 0
      AND (so."importId" IS NULL OR si.status IN ('IMPORTED', 'NEEDS_REVIEW'))
    GROUP BY soi."sellerSku"
  `;

  return rows.map((row) => ({
    sellerSku: normalizeSku(row.sellerSku),
    storedParentSku: row.storedParentSku ? normalizeSku(row.storedParentSku) : null,
    grossSales: Number(row.grossSales) || 0,
    units: Number(row.units) || 0,
    orders: Number(row.orders) || 0
  }));
}

function getVirtualSignal(mapping, catalogMapping) {
  const text = [
    mapping.sellerSku,
    mapping.parentSku,
    mapping.itemName,
    catalogMapping?.itemName
  ].filter(Boolean).join(" ");

  if (/virtual[-_\s]?pack/i.test(text)) {
    return "Explicit virtual-pack text";
  }

  if (/\bvirtual\b/i.test(text)) {
    return "Explicit virtual text";
  }

  return "None";
}

function getSkuFormatIssueSummary(mappings, poRows) {
  const exactMappingSkus = new Set(mappings.map((row) => row.sellerSku));
  const upperMappingBySku = new Map(mappings.map((row) => [row.sellerSku.toUpperCase(), row.sellerSku]));
  const whitespaceSensitiveMatches = poRows
    .filter((po) => !exactMappingSkus.has(po.sellerSku))
    .map((po) => ({ poSku: po.sellerSku, itemSalesSku: upperMappingBySku.get(po.sellerSku.toUpperCase()) }))
    .filter((row) => row.itemSalesSku);

  if (!whitespaceSensitiveMatches.length) {
    return "No case-only SKU mismatches were found between mapped Item Sales SKUs and PO SKUs. Both importers currently normalize SKUs by trimming whitespace.";
  }

  return [
    "Potential case-only SKU differences found:",
    "",
    "| PO SKU | Item Sales SKU |",
    "| --- | --- |",
    ...whitespaceSensitiveMatches
      .slice(0, 25)
      .map((row) => `| ${escapeMarkdownCell(row.poSku)} | ${escapeMarkdownCell(row.itemSalesSku)} |`)
  ].join("\n");
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

function normalizeSku(value) {
  return optionalString(value)?.trim() ?? "";
}

function optionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const stringValue = String(value).trim();
  return stringValue || null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function escapeMarkdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}
