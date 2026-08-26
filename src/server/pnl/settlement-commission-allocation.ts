import {
  SettlementPeriodAllocator,
  parseDateToUtcDay,
  type SettlementAllocationResult,
  type SettlementDateRange
} from "./settlement-period-allocator.ts";
import type { ProfitFeeInput } from "./types.ts";

export const SETTLEMENT_COMMISSION_ALLOCATION_METADATA_KEY =
  "settlementCommissionAllocation";

const SETTLEMENT_ALLOCATION_METADATA_KEY = "settlementAllocation";
const WALMART_PAYMENTS_NEW_SOURCE = "walmart_payments_new";
const allocator = new SettlementPeriodAllocator();

export type SettlementCommissionDiagnostic = {
  originalCommissionAmount: number;
  settlementStart: string | null;
  settlementEnd: string | null;
  totalSettlementDays: number;
  selectedRangeStart: string | null;
  selectedRangeEnd: string | null;
  overlapDays: number;
  allocatedCommissionIncluded: number;
  fallback: boolean;
  missingPeriodMetadata: boolean;
};

type SettlementCommissionOverlapResult = {
  fee: ProfitFeeInput | null;
  diagnostic: SettlementCommissionDiagnostic;
};

export function prepareSettlementDerivedCommissionForDateRange(
  fee: ProfitFeeInput,
  dateRange?: SettlementDateRange
): SettlementCommissionOverlapResult {
  if (isSingleDaySettlementMetadata(fee.metadata)) {
    const included = isDateInRange(fee.postedAt, dateRange);
    const diagnostic = buildTransactionPostedCommissionDiagnostic(
      fee.amount,
      dateRange,
      included ? fee.amount : 0
    );

    return {
      fee: included
        ? {
            ...fee,
            metadata: {
              ...(fee.metadata ?? {}),
              [SETTLEMENT_COMMISSION_ALLOCATION_METADATA_KEY]: diagnostic
            }
          }
        : null,
      diagnostic
    };
  }

  const periodStart = readSettlementPeriodStart(fee.metadata);
  const periodEnd = readSettlementPeriodEnd(fee.metadata);
  const allocation = allocator.allocateForRange(
    {
      amount: fee.amount,
      settlementPeriodStart: periodStart,
      settlementPeriodEnd: periodEnd,
      postingDate: fee.postedAt
    },
    dateRange
  );
  const diagnostic = buildSettlementCommissionDiagnostic(
    fee.amount,
    periodStart,
    periodEnd,
    dateRange,
    allocation
  );

  if (allocation.amount === 0) {
    return { fee: null, diagnostic };
  }

  return {
    fee: {
      ...fee,
      amount: allocation.amount,
      metadata: {
        ...(fee.metadata ?? {}),
        [SETTLEMENT_ALLOCATION_METADATA_KEY]: {
          applied: allocation.applied,
          fallback: allocation.fallback,
          missingPeriodMetadata: allocation.missingPeriodMetadata,
          dayCount: allocation.dayCount,
          overlapDayCount: allocation.overlapDayCount
        },
        [SETTLEMENT_COMMISSION_ALLOCATION_METADATA_KEY]: diagnostic
      }
    },
    diagnostic
  };
}

export function isSettlementDerivedCommissionFee(fee: ProfitFeeInput) {
  return isCommissionFeeType(fee.feeType) && isWalmartPaymentsNewMetadata(fee.metadata);
}

export function getSettlementCommissionDiagnostic(
  fee: ProfitFeeInput
): SettlementCommissionDiagnostic | null {
  const value = fee.metadata?.[SETTLEMENT_COMMISSION_ALLOCATION_METADATA_KEY];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const originalCommissionAmount = readNumber(record.originalCommissionAmount);
  const allocatedCommissionIncluded = readNumber(record.allocatedCommissionIncluded);
  const totalSettlementDays = readInteger(record.totalSettlementDays);
  const overlapDays = readInteger(record.overlapDays);

  if (originalCommissionAmount === null || allocatedCommissionIncluded === null) {
    return null;
  }

  return {
    originalCommissionAmount,
    settlementStart: readOptionalText(record.settlementStart),
    settlementEnd: readOptionalText(record.settlementEnd),
    totalSettlementDays: totalSettlementDays ?? 0,
    selectedRangeStart: readOptionalText(record.selectedRangeStart),
    selectedRangeEnd: readOptionalText(record.selectedRangeEnd),
    overlapDays: overlapDays ?? 0,
    allocatedCommissionIncluded,
    fallback: record.fallback === true,
    missingPeriodMetadata: record.missingPeriodMetadata === true
  };
}

function buildSettlementCommissionDiagnostic(
  originalAmount: number,
  periodStart: string | null,
  periodEnd: string | null,
  dateRange: SettlementDateRange | undefined,
  allocation: SettlementAllocationResult
): SettlementCommissionDiagnostic {
  return {
    originalCommissionAmount: originalAmount,
    settlementStart: formatUtcDay(parseDateToUtcDay(periodStart)),
    settlementEnd: formatUtcDay(parseDateToUtcDay(periodEnd)),
    totalSettlementDays: allocation.dayCount,
    selectedRangeStart: formatUtcDay(dateRange?.from ? parseDateToUtcDay(dateRange.from) : null),
    selectedRangeEnd: formatUtcDay(dateRange?.to ? parseDateToUtcDay(dateRange.to) : null),
    overlapDays: allocation.overlapDayCount,
    allocatedCommissionIncluded: allocation.amount,
    fallback: allocation.fallback,
    missingPeriodMetadata: allocation.missingPeriodMetadata
  };
}

function readSettlementPeriodStart(metadata: Record<string, unknown> | undefined) {
  return (
    readMetadataText(metadata, "settlementPeriodStart") ??
    readMetadataText(metadata, "settlementPeriodStartDate") ??
    readMetadataText(metadata, "periodStartDate")
  );
}

function readSettlementPeriodEnd(metadata: Record<string, unknown> | undefined) {
  return (
    readMetadataText(metadata, "settlementPeriodEnd") ??
    readMetadataText(metadata, "settlementPeriodEndDate") ??
    readMetadataText(metadata, "periodEndDate")
  );
}

function isWalmartPaymentsNewMetadata(metadata: Record<string, unknown> | undefined) {
  return readMetadataText(metadata, "source") === WALMART_PAYMENTS_NEW_SOURCE;
}

function isSingleDaySettlementMetadata(metadata: Record<string, unknown> | undefined) {
  const reportingDateSource = readMetadataText(metadata, "reportingDateSource");
  return (
    reportingDateSource === "transaction_posted_timestamp" ||
    reportingDateSource === "settlement_period_end_unmatched_fee" ||
    reportingDateSource === "transaction_posted_timestamp_missing_period_end"
  );
}

function isCommissionFeeType(feeType: string) {
  const normalized = feeType.toLowerCase().replace(/[\s-]+/g, "_");
  return (
    normalized.includes("commission") ||
    normalized.includes("referral") ||
    normalized.includes("marketplace")
  );
}

function readMetadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() || null : null;
}

function buildTransactionPostedCommissionDiagnostic(
  originalAmount: number,
  dateRange: SettlementDateRange | undefined,
  includedAmount: number
): SettlementCommissionDiagnostic {
  return {
    originalCommissionAmount: originalAmount,
    settlementStart: null,
    settlementEnd: null,
    totalSettlementDays: 0,
    selectedRangeStart: formatUtcDay(dateRange?.from ? parseDateToUtcDay(dateRange.from) : null),
    selectedRangeEnd: formatUtcDay(dateRange?.to ? parseDateToUtcDay(dateRange.to) : null),
    overlapDays: includedAmount === 0 ? 0 : 1,
    allocatedCommissionIncluded: includedAmount,
    fallback: false,
    missingPeriodMetadata: false
  };
}

function isDateInRange(date: Date | null | undefined, dateRange?: SettlementDateRange) {
  if (!date) {
    return false;
  }

  if (!dateRange?.from && !dateRange?.to) {
    return true;
  }

  return (!dateRange.from || date >= dateRange.from) && (!dateRange.to || date <= dateRange.to);
}

function formatUtcDay(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function readOptionalText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
