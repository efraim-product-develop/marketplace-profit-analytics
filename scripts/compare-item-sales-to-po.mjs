import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const number = new Intl.NumberFormat("en-US");

try {
  const args = parseArgs(process.argv.slice(2));
  const items = await prisma.salesOrderItem.findMany({
    where: {
      marketplace: args.marketplace,
      ...(args.from || args.to
        ? {
            order: {
              orderDate: {
                ...(args.from ? { gte: startOfDay(args.from) } : {}),
                ...(args.to ? { lte: endOfDay(args.to) } : {})
              }
            }
          }
        : {})
    },
    include: {
      fees: true,
      listing: true,
      order: {
        include: {
          salesImport: true
        }
      }
    }
  });

  const byMonth = new Map();

  for (const item of items) {
    const month = getMonthKey(item.order.orderDate);
    const bucket = getMonthBucket(byMonth, month);
    const gmv = getLineGmv(item);
    const isItemSales = isMonthlySummary(item);

    if (isItemSales) {
      bucket.itemSales.gmv += gmv;
      bucket.itemSales.units += item.quantity;
      bucket.itemSales.rows += 1;
      bucket.itemSales.orders += getItemSalesOrderCount(item);
      bucket.itemSales.files.add(item.order.salesImport?.originalFileName ?? "Unknown import");
      continue;
    }

    bucket.po.gmv += gmv;
    bucket.po.units += item.quantity;
    bucket.po.rows += 1;
    bucket.po.orders.add(item.order.externalOrderId);
    bucket.po.files.add(item.order.salesImport?.originalFileName ?? "Unknown import");

    const channel = classifyFulfillmentChannel(item);
    const channelBucket = getChannelBucket(bucket.channels, channel);
    channelBucket.gmv += gmv;
    channelBucket.units += item.quantity;
    channelBucket.rows += 1;
    channelBucket.orders.add(item.order.externalOrderId);
    channelBucket.files.add(item.order.salesImport?.originalFileName ?? "Unknown import");
  }

  const rows = Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
  const report = buildReport(rows, args);
  const outputPath = path.join(process.cwd(), "outputs", "item-sales-vs-po-comparison.md");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");

  console.log(report);
  console.log(`\nReport written to ${outputPath}`);
} catch (error) {
  console.error("Could not compare Item Sales to PO/order reports.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function parseArgs(args) {
  const values = {
    marketplace: "walmart",
    from: "",
    to: ""
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1] ?? "";

    if (arg === "--marketplace") {
      values.marketplace = next || values.marketplace;
      index += 1;
    } else if (arg === "--from") {
      values.from = normalizeDateInput(next);
      index += 1;
    } else if (arg === "--to") {
      values.to = normalizeDateInput(next);
      index += 1;
    }
  }

  return values;
}

function buildReport(rows, args) {
  const lines = [
    "# Item Sales vs PO/Order Comparison",
    "",
    `Marketplace: ${args.marketplace}`,
    args.from || args.to ? `Date filter: ${args.from || "beginning"} to ${args.to || "latest"}` : "Date filter: all imported dates",
    "",
    "GMV formula used for both sources:",
    "",
    "`itemRevenue + shippingRevenue - discountAmount`",
    "",
    "Important note: WFS vs Seller Fulfilled is inferred from the order-line fee metadata when available, then from the current listing fulfillment channel. If Walmart did not provide/store a channel for a row, it is shown as Unknown.",
    "",
    "| Month | Item Sales GMV | PO Total GMV | Difference | PO % of Item Sales | PO Rows | PO Orders | PO Units | WFS GMV | Seller Fulfilled GMV | Unknown GMV |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  ];

  for (const row of rows) {
    const itemSalesGmv = roundMoney(row.itemSales.gmv);
    const poGmv = roundMoney(row.po.gmv);
    const difference = roundMoney(itemSalesGmv - poGmv);
    const wfs = getChannelGmv(row, "WFS");
    const seller = getChannelGmv(row, "Seller Fulfilled");
    const unknown = Array.from(row.channels.entries())
      .filter(([channel]) => channel !== "WFS" && channel !== "Seller Fulfilled")
      .reduce((sum, [, value]) => sum + value.gmv, 0);

    lines.push(
      [
        row.month,
        formatMoney(itemSalesGmv),
        formatMoney(poGmv),
        formatMoney(difference),
        itemSalesGmv ? `${((poGmv / itemSalesGmv) * 100).toFixed(1)}%` : "n/a",
        formatNumber(row.po.rows),
        formatNumber(row.po.orders.size),
        formatNumber(row.po.units),
        formatMoney(wfs),
        formatMoney(seller),
        formatMoney(unknown)
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
    );
  }

  lines.push("", "## Detail By Month", "");

  for (const row of rows) {
    lines.push(`### ${row.month}`, "");
    lines.push(`- Item Sales GMV: ${formatMoney(row.itemSales.gmv)} from ${formatNumber(row.itemSales.rows)} rows, ${formatNumber(row.itemSales.units)} units, ${formatNumber(row.itemSales.orders)} orders.`);
    lines.push(`- PO/order GMV: ${formatMoney(row.po.gmv)} from ${formatNumber(row.po.rows)} rows, ${formatNumber(row.po.units)} units, ${formatNumber(row.po.orders.size)} orders.`);
    lines.push(`- Difference: ${formatMoney(row.itemSales.gmv - row.po.gmv)}.`);
    lines.push("", "| Fulfillment | GMV | Rows | Orders | Units | Files |", "|---|---:|---:|---:|---:|---|");

    for (const [channel, value] of Array.from(row.channels.entries()).sort()) {
      lines.push(
        [
          channel,
          formatMoney(value.gmv),
          formatNumber(value.rows),
          formatNumber(value.orders.size),
          formatNumber(value.units),
          Array.from(value.files).sort().join("<br>")
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}

function getMonthBucket(byMonth, month) {
  const existing = byMonth.get(month);
  if (existing) {
    return existing;
  }

  const created = {
    month,
    itemSales: {
      gmv: 0,
      units: 0,
      orders: 0,
      rows: 0,
      files: new Set()
    },
    po: {
      gmv: 0,
      units: 0,
      orders: new Set(),
      rows: 0,
      files: new Set()
    },
    channels: new Map()
  };
  byMonth.set(month, created);
  return created;
}

function getChannelBucket(channels, channel) {
  const existing = channels.get(channel);
  if (existing) {
    return existing;
  }

  const created = {
    gmv: 0,
    units: 0,
    orders: new Set(),
    rows: 0,
    files: new Set()
  };
  channels.set(channel, created);
  return created;
}

function classifyFulfillmentChannel(item) {
  const metadataChannel = item.fees
    .map((fee) => readMetadataText(fee.metadata, "fulfillmentEntity"))
    .find(Boolean);
  const listingChannel = item.listing?.fulfillmentChannel;
  const text = String(metadataChannel || listingChannel || "").toLowerCase();

  if (text.includes("wfs") || text.includes("walmart")) {
    return "WFS";
  }

  if (text.includes("seller") || text.includes("merchant")) {
    return "Seller Fulfilled";
  }

  return text.trim() ? metadataChannel || listingChannel || "Unknown" : "Unknown";
}

function getChannelGmv(row, channel) {
  return row.channels.get(channel)?.gmv ?? 0;
}

function isMonthlySummary(item) {
  return String(item.order.status ?? "").toLowerCase() === "monthly_summary";
}

function getItemSalesOrderCount(item) {
  for (const fee of item.fees) {
    const orders = readMetadataNumber(fee.metadata, "orders");
    if (orders !== null) {
      return orders;
    }
  }

  return 0;
}

function getLineGmv(item) {
  return (
    toNumber(item.itemRevenue) +
    toNumber(item.shippingRevenue) -
    toNumber(item.discountAmount)
  );
}

function readMetadataText(metadata, key) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? typeof metadata[key] === "string"
      ? metadata[key]
      : ""
    : "";
}

function readMetadataNumber(metadata, key) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function getMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function startOfDay(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDay(value) {
  return new Date(`${value}T23:59:59.999Z`);
}

function normalizeDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function toNumber(value) {
  return Number(value?.toString?.() ?? value ?? 0) || 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return currency.format(roundMoney(value));
}

function formatNumber(value) {
  return number.format(value);
}
