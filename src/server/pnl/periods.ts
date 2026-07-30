import type { PnlComparisonPeriod, PnlDateRange } from "./types.ts";

export type RollingPnlComparisonPeriod = Exclude<PnlComparisonPeriod, "custom">;

export type PnlPeriodRange = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

export function parsePnlComparisonPeriod(value?: string): PnlComparisonPeriod {
  if (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "quarter" ||
    value === "custom"
  ) {
    return value;
  }

  return "month";
}

export function parseDateInput(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }

  return value;
}

export function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function dateInputRangeToPnlDateRange(from: string, to: string): PnlDateRange {
  return {
    ...(from ? { from: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {})
  };
}

export function getRollingPeriodDateRange(
  period: RollingPnlComparisonPeriod,
  referenceDate = new Date()
): Required<PnlDateRange> {
  const currentStart = getPeriodStart(referenceDate, period);
  const from =
    period === "quarter"
      ? addMonths(currentStart, -9)
      : period === "month"
        ? addMonths(currentStart, -3)
        : period === "week"
          ? addDays(currentStart, -21)
          : addDays(currentStart, -3);

  return {
    from,
    to: getPeriodEnd(currentStart, period)
  };
}

export function buildPnlPeriodRanges(
  period: PnlComparisonPeriod,
  dateRange?: PnlDateRange,
  referenceDate = new Date()
): PnlPeriodRange[] {
  if (period === "custom") {
    const from = dateRange?.from ?? getPeriodStart(referenceDate, "day");
    const to = dateRange?.to ?? endOfDay(from);

    return [
      {
        key: `custom:${from.toISOString()}:${to.toISOString()}`,
        label: `Custom: ${formatCompactDateRangeLabel(from, to)}`,
        start: from,
        end: to
      }
    ];
  }

  const anchorDate = dateRange?.to ?? referenceDate;
  const currentStart = getPeriodStart(anchorDate, period);

  return [0, 1, 2, 3].map((offset) => {
    const start =
      period === "quarter"
        ? addMonths(currentStart, offset * -3)
        : period === "month"
          ? addMonths(currentStart, -offset)
          : period === "week"
            ? addDays(currentStart, offset * -7)
            : addDays(currentStart, -offset);
    const end = getPeriodEnd(start, period);

    return {
      key: `${period}:${start.toISOString()}`,
      label: getPeriodLabel(period, offset, start),
      start,
      end
    };
  });
}

export function getPeriodStart(date: Date, period: RollingPnlComparisonPeriod) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (period === "day") {
    return new Date(Date.UTC(year, month, day));
  }

  if (period === "week") {
    const start = new Date(Date.UTC(year, month, day));
    const dayOfWeek = start.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
    return start;
  }

  if (period === "quarter") {
    return new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1));
  }

  return new Date(Date.UTC(year, month, 1));
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function endOfDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

function getPeriodEnd(start: Date, period: RollingPnlComparisonPeriod) {
  if (period === "day") {
    return endOfDay(start);
  }

  if (period === "week") {
    return endOfDay(addDays(start, 6));
  }

  if (period === "quarter") {
    return endOfDay(addDays(addMonths(start, 3), -1));
  }

  return endOfDay(addDays(addMonths(start, 1), -1));
}

function getPeriodLabel(period: RollingPnlComparisonPeriod, offset: number, start: Date) {
  if (period === "day") {
    return offset === 0 ? "Current day" : offset === 1 ? "Previous day" : `${offset} days ago`;
  }

  if (period === "week") {
    return offset === 0 ? "Current week" : offset === 1 ? "Previous week" : `${offset} weeks ago`;
  }

  if (period === "quarter") {
    if (offset === 0) {
      return "Current quarter";
    }

    if (offset === 1) {
      return "Previous quarter";
    }

    return `${offset} quarters ago`;
  }

  if (offset === 0) {
    return "Current month";
  }

  if (offset === 1) {
    return "Previous month";
  }

  return `${offset} months ago`;
}

function formatCompactDateRangeLabel(start: Date, end: Date) {
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC"
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(end);

  return `${startLabel} - ${endLabel}`;
}
