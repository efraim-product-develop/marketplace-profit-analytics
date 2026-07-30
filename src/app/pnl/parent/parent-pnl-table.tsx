"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable
} from "@tanstack/react-table";
import { ArrowDownUp, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "@/lib/format";
import { getParentPnlSourceLabel } from "@/server/pnl/parent-page";
import type { ProfitRow, SkuPnlOrderDrilldownRow } from "@/server/pnl/types";

const parentColumns: ColumnDef<ProfitRow>[] = [
  {
    accessorKey: "parentSku",
    header: "Parent SKU",
    cell: ({ row }) => row.original.parentSku ?? "Unassigned"
  },
  {
    accessorKey: "marketplace",
    header: "Marketplace"
  },
  {
    accessorKey: "salesSource",
    header: "Source",
    cell: ({ row }) => <SourceBadge source={row.original.salesSource} />
  },
  {
    accessorKey: "quantity",
    header: "Units",
    cell: ({ row }) => formatNumber(row.original.quantity)
  },
  {
    accessorKey: "grossRevenue",
    header: "Gross Revenue",
    cell: ({ row }) => formatCurrency(row.original.grossRevenue)
  },
  {
    accessorKey: "discounts",
    header: "Discounts",
    cell: ({ row }) => formatCurrency(row.original.discounts)
  },
  {
    accessorKey: "netRevenue",
    header: "Net Revenue",
    cell: ({ row }) => formatCurrency(row.original.netRevenue)
  },
  {
    accessorKey: "salesRefunds",
    header: "Refund Sales",
    cell: ({ row }) => formatCurrency(row.original.salesRefunds)
  },
  {
    accessorKey: "refunds",
    header: "Refund Adjustments",
    cell: ({ row }) => formatCurrency(row.original.refunds)
  },
  {
    accessorKey: "commissionFees",
    header: "Commission",
    cell: ({ row }) => formatCurrency(row.original.commissionFees)
  },
  {
    accessorKey: "fulfillmentFees",
    header: "Fulfillment",
    cell: ({ row }) => formatCurrency(row.original.fulfillmentFees)
  },
  {
    id: "otherSettlementFees",
    header: "Other Fees",
    cell: ({ row }) => formatCurrency(getOtherSettlementFees(row.original))
  },
  {
    accessorKey: "cogs",
    header: "COGS",
    cell: ({ row }) => formatCurrency(row.original.cogs)
  },
  {
    accessorKey: "missingCogsUnits",
    header: "COGS Status",
    cell: ({ row }) => <CogsStatusBadge missingUnits={row.original.missingCogsUnits} />
  },
  {
    accessorKey: "walmartConnectAdvertisingCost",
    header: "Walmart Connect Ads",
    cell: ({ row }) => formatCurrency(row.original.walmartConnectAdvertisingCost)
  },
  {
    accessorKey: "semAdvertisingCost",
    header: "SEM Ads",
    cell: ({ row }) => formatCurrency(row.original.semAdvertisingCost)
  },
  {
    accessorKey: "netProfit",
    header: "Profit",
    cell: ({ row }) => formatCurrency(row.original.netProfit)
  },
  {
    accessorKey: "netMarginPercent",
    header: "Profit Margin",
    cell: ({ row }) => formatPercent(row.original.netMarginPercent)
  },
  {
    accessorKey: "profitPerUnit",
    header: "Profit / Unit",
    cell: ({ row }) => formatCurrency(row.original.profitPerUnit)
  },
  {
    id: "orders",
    header: "Orders",
    cell: () => "-"
  }
];

export function ParentPnlTable({
  currentQueryString,
  orderHistoryRows,
  rows,
  selectedSku,
  skuRows
}: {
  currentQueryString: string;
  orderHistoryRows: SkuPnlOrderDrilldownRow[];
  rows: ProfitRow[];
  selectedSku: string;
  skuRows: ProfitRow[];
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const selectedParentKey = useMemo(() => {
    if (!selectedSku) {
      return null;
    }

    const selectedRow = skuRows.find((row) => row.sellerSku === selectedSku);
    return selectedRow ? getParentKey(selectedRow) : null;
  }, [selectedSku, skuRows]);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(
    () => new Set(selectedParentKey ? [selectedParentKey] : [])
  );

  const skuRowsByParent = useMemo(() => {
    const groups = new Map<string, ProfitRow[]>();

    for (const skuRow of skuRows) {
      const key = getParentKey(skuRow);
      const group = groups.get(key) ?? [];
      group.push(skuRow);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      group.sort((a, b) => (a.sellerSku ?? "").localeCompare(b.sellerSku ?? ""));
    }

    return groups;
  }, [skuRows]);

  useEffect(() => {
    if (!selectedParentKey) {
      return;
    }

    setExpandedParents((current) => {
      if (current.has(selectedParentKey)) {
        return current;
      }

      const next = new Set(current);
      next.add(selectedParentKey);
      return next;
    });
  }, [selectedParentKey]);

  const table = useReactTable({
    data: rows,
    columns: parentColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  function toggleParent(parentKey: string) {
    setExpandedParents((current) => {
      const next = new Set(current);
      if (next.has(parentKey)) {
        next.delete(parentKey);
      } else {
        next.add(parentKey);
      }

      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1660px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                <th className="w-12 border-b border-slate-200 px-3 py-3">
                  <span className="sr-only">Expand parent</span>
                </th>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="border-b border-slate-200 px-4 py-3 font-semibold">
                    {header.isPlaceholder ? null : (
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() ? (
                          <ArrowDownUp aria-hidden className="h-3.5 w-3.5 text-slate-400" />
                        ) : null}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const parentKey = getParentKey(row.original);
                const children = skuRowsByParent.get(parentKey) ?? [];
                const isExpanded = expandedParents.has(parentKey);

                return (
                  <Fragment key={row.id}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-3 align-middle">
                        <button
                          type="button"
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:border-teal-600 hover:text-teal-700",
                            isExpanded && "border-teal-600 bg-teal-50 text-teal-700"
                          )}
                          aria-label={`${isExpanded ? "Hide" : "Show"} SKUs for ${
                            row.original.parentSku ?? "Unassigned parent"
                          }`}
                          aria-expanded={isExpanded}
                          onClick={() => toggleParent(parentKey)}
                        >
                          {isExpanded ? (
                            <ChevronDown aria-hidden className="h-4 w-4" />
                          ) : (
                            <ChevronRight aria-hidden className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 align-middle text-slate-700">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                    {isExpanded ? (
                      children.length ? (
                        children.map((child) => {
                          const isSelected = selectedSku === child.sellerSku;

                          return (
                            <Fragment key={`${parentKey}:${child.sellerSku}`}>
                              <SkuChildRow
                                currentQueryString={currentQueryString}
                                isSelected={isSelected}
                                row={child}
                              />
                              {isSelected ? (
                                <OrderHistoryChildRow rows={orderHistoryRows} />
                              ) : null}
                            </Fragment>
                          );
                        })
                      ) : (
                        <tr className="border-b border-slate-100 bg-slate-50/70">
                          <td />
                          <td colSpan={parentColumns.length} className="px-4 py-4 text-slate-500">
                            No SKU rows found for this parent.
                          </td>
                        </tr>
                      )
                    ) : null}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td className="px-4 py-10 text-center text-slate-500" colSpan={parentColumns.length + 1}>
                  No parent P&L rows yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkuChildRow({
  currentQueryString,
  isSelected,
  row
}: {
  currentQueryString: string;
  isSelected: boolean;
  row: ProfitRow;
}) {
  return (
    <tr className={cn("border-b border-slate-100 bg-slate-50/70", isSelected && "bg-blue-50/70")}>
      <td />
      <td className="px-4 py-3 align-middle">
        <span className="ml-4 grid gap-0.5 border-l-2 border-teal-500 pl-3">
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">SKU</span>
          <span className="font-semibold text-slate-800">{row.sellerSku ?? "Unassigned SKU"}</span>
        </span>
      </td>
      <td className="px-4 py-3 align-middle text-slate-600">{row.marketplace}</td>
      <td className="px-4 py-3 align-middle">
        <SourceBadge source={row.salesSource} />
      </td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatNumber(row.quantity)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.grossRevenue)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.discounts)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.netRevenue)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.salesRefunds)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.refunds)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.commissionFees)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.fulfillmentFees)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(getOtherSettlementFees(row))}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.cogs)}</td>
      <td className="px-4 py-3 align-middle">
        <CogsStatusBadge missingUnits={row.missingCogsUnits} />
      </td>
      <td className="px-4 py-3 align-middle text-slate-600">
        {formatCurrency(row.walmartConnectAdvertisingCost)}
      </td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.semAdvertisingCost)}</td>
      <td className="px-4 py-3 align-middle font-semibold text-slate-800">
        {formatCurrency(row.netProfit)}
      </td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatPercent(row.netMarginPercent)}</td>
      <td className="px-4 py-3 align-middle text-slate-600">{formatCurrency(row.profitPerUnit)}</td>
      <td className="px-4 py-3 align-middle">
        {row.sellerSku ? (
          <a
            className={cn(
              "text-sm font-semibold text-ocean transition hover:text-ocean/80",
              isSelected && "text-blue-700"
            )}
            href={buildOrderHref(currentQueryString, row.sellerSku)}
          >
            {isSelected ? "Open" : "View"}
          </a>
        ) : (
          "-"
        )}
      </td>
    </tr>
  );
}

function OrderHistoryChildRow({ rows }: { rows: SkuPnlOrderDrilldownRow[] }) {
  return (
    <tr className="border-b border-slate-100 bg-blue-50/40">
      <td />
      <td colSpan={parentColumns.length} className="px-4 py-4">
        <div className="overflow-hidden rounded-md border border-blue-100 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-blue-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-ink">Order History</div>
              <div className="mt-1 text-xs text-slate-500">
                Included sales-source rows for the selected parent and SKU.
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Order</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Date</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Source</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Status</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Units</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Net Revenue</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Refund Sales</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Refund Adjustments</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Commission</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Fulfillment</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Other Fees</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">COGS</th>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-700">{row.externalOrderId ?? "Summary"}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.orderDate ? formatDate(row.orderDate) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <SourcePill
                          label={getParentPnlSourceLabel(row.salesSource)}
                          muted={!row.dashboardIncluded}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.orderStatus ?? "-"}</td>
                      <td className="px-4 py-3 text-slate-700">{formatNumber(row.quantity)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(row.netRevenue)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(row.salesRefunds)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(row.refunds)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(row.commissionFees)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(row.fulfillmentFees)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(getOtherSettlementFees(row))}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCurrency(row.cogs)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {formatCurrency(row.netProfit)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-10 text-center text-slate-500" colSpan={13}>
                      No order rows match this SKU and filter set.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}

function getOtherSettlementFees({
  commissionFees,
  fulfillmentFees,
  marketplaceFees
}: {
  commissionFees: number;
  fulfillmentFees: number;
  marketplaceFees: number;
}) {
  return marketplaceFees - commissionFees - fulfillmentFees;
}

function SourceBadge({ source }: { source: ProfitRow["salesSource"] }) {
  return (
    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
      {getParentPnlSourceLabel(source)}
    </span>
  );
}

function SourcePill({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500"
          : "rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700"
      }
    >
      {muted ? `${label} audit` : label}
    </span>
  );
}

function CogsStatusBadge({ missingUnits }: { missingUnits: number }) {
  if (missingUnits > 0) {
    return (
      <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
        Missing {formatNumber(missingUnits)}
      </span>
    );
  }

  return (
    <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
      Complete
    </span>
  );
}

function buildOrderHref(currentQueryString: string, sellerSku: string) {
  const params = new URLSearchParams(currentQueryString);
  params.set("sku", sellerSku);
  return `/pnl/parent?${params.toString()}`;
}

function getParentKey(row: ProfitRow) {
  return `${row.marketplace}:${row.parentSku ?? "Unassigned parent"}`;
}
