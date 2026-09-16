import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  SELLER_FULFILLED_SHIPPING_FEE_TYPE,
  SELLER_FULFILLED_SHIPPING_SOURCE
} from "./seller-fulfilled-shipping-types";

export type SellerFulfilledShippingCostRow = {
  id: string;
  marketplace: string;
  month: string;
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  notes: string | null;
  updatedAt: Date | null;
  createdAt: Date;
};

export async function listSellerFulfilledShippingCosts({
  organizationId,
  marketplace,
  take = 24
}: {
  organizationId: string;
  marketplace: string;
  take?: number;
}): Promise<SellerFulfilledShippingCostRow[]> {
  const rows = await prisma.marketplaceFee.findMany({
    where: {
      organizationId,
      marketplace,
      feeType: SELLER_FULFILLED_SHIPPING_FEE_TYPE,
      orderId: null,
      orderItemId: null,
      sellerSku: null
    },
    orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }],
    take
  });

  return rows.map((row) => {
    const metadata = toRecord(row.metadata);
    const periodStart = parseMetadataDate(metadata?.periodStartDate) ?? row.postedAt ?? row.createdAt;
    const periodEnd = parseMetadataDate(metadata?.periodEndDate) ?? row.postedAt ?? row.createdAt;

    return {
      id: row.id,
      marketplace: row.marketplace,
      month: formatMonthValue(periodStart),
      periodStart,
      periodEnd,
      amount: toNumber(row.feeAmount),
      notes: readMetadataText(metadata, "notes"),
      updatedAt: null,
      createdAt: row.createdAt
    };
  });
}

export async function upsertSellerFulfilledShippingCost({
  amount,
  marketplace,
  month,
  notes,
  organizationId
}: {
  amount: number;
  marketplace: string;
  month: string;
  notes?: string | null;
  organizationId: string;
}) {
  const period = parseMonthPeriod(month);
  const metadata = buildSellerFulfilledShippingMetadata(period, notes);
  const existing = await prisma.marketplaceFee.findFirst({
    where: {
      organizationId,
      marketplace,
      feeType: SELLER_FULFILLED_SHIPPING_FEE_TYPE,
      postedAt: period.start,
      orderId: null,
      orderItemId: null,
      sellerSku: null
    },
    select: { id: true }
  });

  if (existing) {
    return prisma.marketplaceFee.update({
      where: { id: existing.id },
      data: {
        feeAmount: amount,
        metadata
      }
    });
  }

  return prisma.marketplaceFee.create({
    data: {
      organizationId,
      marketplace,
      feeType: SELLER_FULFILLED_SHIPPING_FEE_TYPE,
      feeAmount: amount,
      postedAt: period.start,
      metadata,
      currency: "USD"
    }
  });
}

function buildSellerFulfilledShippingMetadata(
  period: { start: Date; end: Date },
  notes?: string | null
): Prisma.InputJsonObject {
  return {
    source: SELLER_FULFILLED_SHIPPING_SOURCE,
    manualCostType: SELLER_FULFILLED_SHIPPING_FEE_TYPE,
    periodStartDate: period.start.toISOString(),
    periodEndDate: period.end.toISOString(),
    reportingDateSource: "manual_month_period",
    financialDirection: "charge",
    notes: notes?.trim() || null
  };
}

function parseMonthPeriod(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);

  if (!match) {
    throw new Error("Enter a valid month.");
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error("Enter a valid month.");
  }

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));

  return { start, end };
}

function formatMonthValue(date: Date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function parseMetadataDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readMetadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number(value.toString());
  }

  return 0;
}
