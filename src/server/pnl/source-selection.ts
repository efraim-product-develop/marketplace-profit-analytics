import type { PnlDateRange, ProfitLineInput } from "./types.ts";

export type ProfitLineSelection = {
  lines: ProfitLineInput[];
  suppressedDetailLines: ProfitLineInput[];
};

export function selectDashboardProfitLines(
  lines: ProfitLineInput[],
  _dateRange?: PnlDateRange
): ProfitLineSelection {
  const selectedLines = lines.filter(isSupportedSalesLine);

  return {
    lines: selectedLines,
    suppressedDetailLines: lines.filter((line) => !isSupportedSalesLine(line))
  };
}

function isSupportedSalesLine(line: ProfitLineInput) {
  return line.salesSource === "po_report";
}
