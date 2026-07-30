"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable
} from "@tanstack/react-table";
import { ArrowDownUp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  CostAuditRow,
  CostUploadHistoryRow,
  CostUploadIssueRow
} from "@/server/cogs/queries";

const costColumns: ColumnDef<CostAuditRow>[] = [
  {
    accessorKey: "sellerSku",
    header: "SKU"
  },
  {
    accessorKey: "parentProduct",
    header: "Parent Product",
    cell: ({ row }) => (
      <span className="grid min-w-[170px] gap-0.5">
        <span className="font-medium text-slate-800">{row.original.parentProduct}</span>
        <span className="text-xs text-slate-500">{row.original.parentSku}</span>
      </span>
    )
  },
  {
    accessorKey: "variationName",
    header: "Variation",
    cell: ({ row }) => <span className="block min-w-[150px]">{row.original.variationName}</span>
  },
  {
    accessorKey: "shipmentId",
    header: "Shipment ID"
  },
  {
    accessorKey: "effectiveDate",
    header: "Effective Date",
    cell: ({ row }) => formatDate(row.original.effectiveDate)
  },
  {
    accessorKey: "unitCogs",
    header: "Unit COGS",
    cell: ({ row }) => formatCurrency(row.original.unitCogs, row.original.currency)
  },
  {
    accessorKey: "inboundFreightPerUnit",
    header: "Inbound Freight",
    cell: ({ row }) => formatCurrency(row.original.inboundFreightPerUnit, row.original.currency)
  },
  {
    accessorKey: "prepCostPerUnit",
    header: "Prep",
    cell: ({ row }) => formatCurrency(row.original.prepCostPerUnit, row.original.currency)
  },
  {
    accessorKey: "packagingCostPerUnit",
    header: "Packaging",
    cell: ({ row }) => formatCurrency(row.original.packagingCostPerUnit, row.original.currency)
  },
  {
    accessorKey: "unitCost",
    header: "Total Unit Cost",
    cell: ({ row }) => formatCurrency(row.original.unitCost, row.original.currency)
  },
  {
    accessorKey: "isActiveNow",
    header: "Active Now",
    cell: ({ row }) => <ActiveBadge active={row.original.isActiveNow} />
  },
  {
    accessorKey: "notes",
    header: "Notes",
    cell: ({ row }) => row.original.notes || "-"
  }
];

const uploadColumns: ColumnDef<CostUploadHistoryRow>[] = [
  {
    accessorKey: "originalFileName",
    header: "File"
  },
  {
    accessorKey: "marketplace",
    header: "Marketplace"
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge value={row.original.status} />
  },
  {
    accessorKey: "rowCount",
    header: "Rows"
  },
  {
    accessorKey: "importedCount",
    header: "Imported"
  },
  {
    accessorKey: "rejectedCount",
    header: "Rejected"
  },
  {
    accessorKey: "issueCount",
    header: "Issues"
  },
  {
    accessorKey: "batchCount",
    header: "Batches"
  },
  {
    accessorKey: "createdAt",
    header: "Uploaded",
    cell: ({ row }) => formatDate(row.original.createdAt)
  }
];

const issueColumns: ColumnDef<CostUploadIssueRow>[] = [
  {
    accessorKey: "uploadFileName",
    header: "File"
  },
  {
    accessorKey: "rowNumber",
    header: "Row"
  },
  {
    accessorKey: "severity",
    header: "Severity",
    cell: ({ row }) => <StatusBadge value={row.original.severity} />
  },
  {
    accessorKey: "code",
    header: "Code"
  },
  {
    accessorKey: "message",
    header: "Message"
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatDate(row.original.createdAt)
  }
];

export function CogsAuditTable({ rows }: { rows: CostAuditRow[] }) {
  const [skuFilter, setSkuFilter] = useState("");
  const [parentFilter, setParentFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "effectiveDate", desc: true }
  ]);

  const filteredRows = useMemo(() => {
    const skuNeedle = skuFilter.trim().toLowerCase();
    const parentNeedle = parentFilter.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSku = skuNeedle
        ? row.sellerSku.toLowerCase().includes(skuNeedle)
        : true;
      const matchesParent = parentNeedle
        ? row.parentProduct.toLowerCase().includes(parentNeedle) ||
          row.parentSku.toLowerCase().includes(parentNeedle)
        : true;

      return matchesSku && matchesParent;
    });
  }, [parentFilter, rows, skuFilter]);

  const table = useReactTable({
    data: filteredRows,
    columns: costColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-panel sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <FilterInput
          label="Filter by SKU"
          value={skuFilter}
          onChange={setSkuFilter}
          placeholder="Search SKUs"
        />
        <FilterInput
          label="Filter by parent product"
          value={parentFilter}
          onChange={setParentFilter}
          placeholder="Search parent products"
        />
        <div className="flex items-end">
          <span className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">
            {filteredRows.length} of {rows.length}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="border-b border-slate-200 px-4 py-3 font-semibold"
                    >
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
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-slate-100 last:border-0 hover:bg-slate-50",
                      row.original.isActiveNow && "bg-emerald-50/80 hover:bg-emerald-50"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 align-middle text-slate-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-10 text-center text-slate-500" colSpan={costColumns.length}>
                    No COGS records match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function CogsUploadHistoryTable({ rows }: { rows: CostUploadHistoryRow[] }) {
  return <DataTable columns={uploadColumns} data={rows} emptyLabel="No upload history yet." />;
}

export function CogsIssueTable({ rows }: { rows: CostUploadIssueRow[] }) {
  return <DataTable columns={issueColumns} data={rows} emptyLabel="No row issues found." />;
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
      {value}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
      Active
    </span>
  ) : (
    <span className="text-slate-400">-</span>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-700">
      {label}
      <span className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        <input
          className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm font-normal text-slate-800 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}
