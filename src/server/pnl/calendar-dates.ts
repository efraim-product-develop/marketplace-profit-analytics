import type { PnlDateRange } from "./types.ts";

export const PNL_BUSINESS_TIME_ZONE = "UTC";
const DAY_MS = 86_400_000;

export type InclusiveCalendarRange = {
  from: Date;
  to: Date;
};

export function normalizePnlDateRange(dateRange?: PnlDateRange): InclusiveCalendarRange | null {
  if (!dateRange?.from && !dateRange?.to) {
    return null;
  }

  const from = startOfBusinessDay(dateRange.from ?? dateRange.to);
  const to = endOfBusinessDay(dateRange.to ?? dateRange.from);

  if (!from || !to) {
    return null;
  }

  return from <= to ? { from, to } : { from: startOfBusinessDay(to)!, to: endOfBusinessDay(from)! };
}

export function startOfBusinessDay(value?: Date | string | null) {
  const date = parseBusinessDate(value);

  if (!date) {
    return null;
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfBusinessDay(value?: Date | string | null) {
  const start = startOfBusinessDay(value);

  if (!start) {
    return null;
  }

  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 23, 59, 59, 999)
  );
}

export function businessDateKey(value?: Date | string | null) {
  return startOfBusinessDay(value)?.toISOString().slice(0, 10) ?? null;
}

export function isDateWithinInclusiveRange(value: Date | string | null | undefined, range?: PnlDateRange) {
  const normalizedRange = normalizePnlDateRange(range);
  const date = startOfBusinessDay(value);

  if (!normalizedRange || !date) {
    return false;
  }

  return date >= startOfBusinessDay(normalizedRange.from)! && date <= startOfBusinessDay(normalizedRange.to)!;
}

export function getInclusiveOverlapDays(
  periodStart: Date | string | null | undefined,
  periodEnd: Date | string | null | undefined,
  selectedRange: PnlDateRange | undefined
) {
  const periodFrom = startOfBusinessDay(periodStart);
  const periodTo = startOfBusinessDay(periodEnd);
  const range = normalizePnlDateRange(selectedRange);

  if (!periodFrom || !periodTo || !range || periodTo < periodFrom) {
    return 0;
  }

  const selectedFrom = startOfBusinessDay(range.from)!;
  const selectedTo = startOfBusinessDay(range.to)!;
  const overlapStart = selectedFrom > periodFrom ? selectedFrom : periodFrom;
  const overlapEnd = selectedTo < periodTo ? selectedTo : periodTo;

  if (overlapEnd < overlapStart) {
    return 0;
  }

  return inclusiveCalendarDayCount(overlapStart, overlapEnd);
}

export function inclusiveCalendarDayCount(start: Date, end: Date) {
  return Math.round((startOfBusinessDay(end)!.getTime() - startOfBusinessDay(start)!.getTime()) / DAY_MS) + 1;
}

export function isFullCalendarMonthRange(dateRange?: PnlDateRange) {
  const range = normalizePnlDateRange(dateRange);

  if (!range) {
    return false;
  }

  const from = startOfBusinessDay(range.from)!;
  const to = endOfBusinessDay(range.to)!;
  const monthStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const monthEnd = endOfBusinessDay(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)))!;

  return from.getTime() === monthStart.getTime() && to.getTime() === monthEnd.getTime();
}

function parseBusinessDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnlyMatch
    ? new Date(Date.UTC(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3])))
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}
