export type SettlementAllocationInput = {
  amount: number;
  settlementPeriodStart?: Date | string | null;
  settlementPeriodEnd?: Date | string | null;
  postingDate?: Date | string | null;
};

export type SettlementAllocationResult = {
  amount: number;
  applied: boolean;
  fallback: boolean;
  missingPeriodMetadata: boolean;
  dayCount: number;
  overlapDayCount: number;
};

export type SettlementDateRange = {
  from?: Date;
  to?: Date;
};

export class SettlementPeriodAllocator {
  allocateForRange(
    input: SettlementAllocationInput,
    dateRange?: SettlementDateRange
  ): SettlementAllocationResult {
    const amountCents = toCents(input.amount);

    if (!dateRange?.from && !dateRange?.to) {
      return {
        amount: fromCents(amountCents),
        applied: false,
        fallback: false,
        missingPeriodMetadata: false,
        dayCount: 0,
        overlapDayCount: 0
      };
    }

    const period = this.parsePeriod(input.settlementPeriodStart, input.settlementPeriodEnd);

    if (!period) {
      const fallbackAmount = this.isPostingDateInRange(input.postingDate, dateRange)
        ? amountCents
        : 0;

      return {
        amount: fromCents(fallbackAmount),
        applied: false,
        fallback: true,
        missingPeriodMetadata: true,
        dayCount: 0,
        overlapDayCount: fallbackAmount === 0 ? 0 : 1
      };
    }

    const dailyAllocations = this.getDailyAllocations(amountCents, period.start, period.end);
    const overlap = getOverlapRange(period.start, period.end, dateRange);

    if (!overlap) {
      return {
        amount: 0,
        applied: true,
        fallback: false,
        missingPeriodMetadata: false,
        dayCount: dailyAllocations.length,
        overlapDayCount: 0
      };
    }

    const startOffset = daysBetween(period.start, overlap.start);
    const overlapDayCount = inclusiveDayCount(overlap.start, overlap.end);
    const allocatedCents = dailyAllocations
      .slice(startOffset, startOffset + overlapDayCount)
      .reduce((sum, cents) => sum + cents, 0);

    return {
      amount: fromCents(allocatedCents),
      applied: true,
      fallback: false,
      missingPeriodMetadata: false,
      dayCount: dailyAllocations.length,
      overlapDayCount
    };
  }

  getDailyAllocations(amountCents: number, start: Date, end: Date) {
    const dayCount = inclusiveDayCount(start, end);

    if (dayCount <= 0) {
      return [];
    }

    const sign = amountCents < 0 ? -1 : 1;
    const absoluteCents = Math.abs(amountCents);
    const baseAmount = Math.floor(absoluteCents / dayCount);
    const remainder = absoluteCents % dayCount;

    return Array.from({ length: dayCount }, (_, index) =>
      sign * (baseAmount + (index < remainder ? 1 : 0))
    );
  }

  parsePeriod(start?: Date | string | null, end?: Date | string | null) {
    const parsedStart = parseDateToUtcDay(start);
    const parsedEnd = parseDateToUtcDay(end);

    if (!parsedStart || !parsedEnd || parsedEnd < parsedStart) {
      return null;
    }

    return {
      start: parsedStart,
      end: parsedEnd,
      dayCount: inclusiveDayCount(parsedStart, parsedEnd)
    };
  }

  private isPostingDateInRange(postingDate: Date | string | null | undefined, dateRange: SettlementDateRange) {
    const parsedPostingDate = parseDateToUtcDay(postingDate);

    if (!parsedPostingDate) {
      return false;
    }

    const from = dateRange.from ? parseDateToUtcDay(dateRange.from) : null;
    const to = dateRange.to ? parseDateToUtcDay(dateRange.to) : null;

    return (!from || parsedPostingDate >= from) && (!to || parsedPostingDate <= to);
  }
}

export function toCents(amount: number) {
  return Math.round(amount * 100);
}

export function fromCents(cents: number) {
  return cents / 100;
}

export function parseDateToUtcDay(value?: Date | string | null) {
  return startOfBusinessDay(value);
}

function getOverlapRange(
  periodStart: Date,
  periodEnd: Date,
  dateRange: SettlementDateRange
) {
  const from = dateRange.from ? parseDateToUtcDay(dateRange.from) : periodStart;
  const to = dateRange.to ? parseDateToUtcDay(dateRange.to) : periodEnd;

  if (!from || !to) {
    return null;
  }

  const start = from > periodStart ? from : periodStart;
  const end = to < periodEnd ? to : periodEnd;

  if (end < start) {
    return null;
  }

  return { start, end };
}

function inclusiveDayCount(start: Date, end: Date) {
  return inclusiveCalendarDayCount(start, end);
}

function daysBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}
import {
  inclusiveCalendarDayCount,
  startOfBusinessDay
} from "./calendar-dates.ts";
