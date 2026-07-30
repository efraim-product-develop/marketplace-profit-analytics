export type EffectiveCogsCostRecord = {
  marketplace: string | null;
  sellerSku: string;
  effectiveDate: Date;
  unitCost: unknown;
};

export type EffectiveCogsSkuInput = {
  marketplace: string;
  sellerSku: string;
  orderDate: Date;
};

export type EffectiveCogsOrderLineInput = EffectiveCogsSkuInput & {
  id: string;
  quantity: number;
  cogsUnit: unknown | null;
};

export type EffectiveCogsResult = {
  unitCost: number;
  record: EffectiveCogsCostRecord;
};

export type EffectiveCogsOrderLineResult = {
  assignedCost: EffectiveCogsResult | null;
  hasLineCost: boolean;
  unitCost: number;
  cogsTotal: number;
  missingCogs: boolean;
};

export class EffectiveCogsService {
  private readonly recordsBySkuKey = new Map<string, EffectiveCogsCostRecord[]>();

  constructor(costRecords: EffectiveCogsCostRecord[]) {
    for (const record of costRecords) {
      if (!record.marketplace) {
        continue;
      }

      const key = buildSkuKey(record.marketplace, record.sellerSku);
      const records = this.recordsBySkuKey.get(key) ?? [];
      records.push(record);
      this.recordsBySkuKey.set(key, records);
    }
  }

  getEffectiveCogsForSku(input: EffectiveCogsSkuInput): EffectiveCogsResult | null {
    const records = this.recordsBySkuKey.get(buildSkuKey(input.marketplace, input.sellerSku)) ?? [];
    const record = records.find((candidate) => candidate.effectiveDate <= input.orderDate);

    return record ? { unitCost: toNumber(record.unitCost), record } : null;
  }

  getEffectiveCogsForOrderLines<TLine extends EffectiveCogsOrderLineInput>(
    lines: TLine[]
  ): Map<TLine["id"], EffectiveCogsOrderLineResult> {
    const results = new Map<TLine["id"], EffectiveCogsOrderLineResult>();

    for (const line of lines) {
      const assignedCost = this.getEffectiveCogsForSku({
        marketplace: line.marketplace,
        sellerSku: line.sellerSku,
        orderDate: line.orderDate
      });
      const hasLineCost = line.cogsUnit !== null;
      const unitCost = hasLineCost ? toNumber(line.cogsUnit) : assignedCost?.unitCost ?? 0;

      results.set(line.id, {
        assignedCost,
        hasLineCost,
        unitCost,
        cogsTotal: unitCost * line.quantity,
        missingCogs: !hasLineCost && !assignedCost
      });
    }

    return results;
  }
}

function buildSkuKey(marketplace: string, sellerSku: string) {
  return `${marketplace}:${sellerSku}`;
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
