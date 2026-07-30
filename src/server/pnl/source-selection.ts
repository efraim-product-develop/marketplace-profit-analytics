import type { PnlDateRange, ProfitLineInput } from "./types.ts";

export type ProfitLineSelection = {
  lines: ProfitLineInput[];
  suppressedDetailLines: ProfitLineInput[];
};

export function selectDashboardProfitLines(
  lines: ProfitLineInput[],
  _dateRange?: PnlDateRange
): ProfitLineSelection {
  const selectedLines = lines.filter(isDailyItemSalesSummaryLine);

  return {
    lines: selectedLines,
    suppressedDetailLines: lines.filter((line) => !isDailyItemSalesSummaryLine(line))
  };
}

function isDailyItemSalesSummaryLine(line: ProfitLineInput) {
  return line.salesSource === "item_sales_daily_summary";
}
