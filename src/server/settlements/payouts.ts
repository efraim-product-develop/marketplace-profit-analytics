export type SettlementPayoutSortInput = {
  settlementPeriodEnd: Date | null;
  payoutDate: Date | null;
  importedAt: Date;
};

export function sortSettlementPayoutHistoryRows<T extends SettlementPayoutSortInput>(
  rows: T[]
) {
  return [...rows].sort((first, second) => {
    return (
      compareNullableDatesDesc(first.settlementPeriodEnd, second.settlementPeriodEnd) ||
      compareNullableDatesDesc(first.payoutDate, second.payoutDate) ||
      compareNullableDatesDesc(first.importedAt, second.importedAt)
    );
  });
}

function compareNullableDatesDesc(first: Date | null, second: Date | null) {
  const firstTime = first?.getTime() ?? Number.NEGATIVE_INFINITY;
  const secondTime = second?.getTime() ?? Number.NEGATIVE_INFINITY;

  return secondTime - firstTime;
}
