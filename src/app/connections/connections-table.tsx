"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import type { ConnectionRow } from "@/server/connections/queries";
import { formatDate } from "@/lib/format";

const columns: ColumnDef<ConnectionRow>[] = [
  {
    accessorKey: "displayName",
    header: "Connection"
  },
  {
    accessorKey: "marketplace",
    header: "Marketplace"
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
        {row.original.status}
      </span>
    )
  },
  {
    accessorKey: "externalAccountId",
    header: "External Account",
    cell: ({ row }) => row.original.externalAccountId || "Not set"
  },
  {
    accessorKey: "syncMode",
    header: "Sync Mode"
  },
  {
    accessorKey: "capabilities",
    header: "Capabilities",
    cell: ({ row }) => row.original.capabilities.join(", ")
  },
  {
    accessorKey: "lastSyncedAt",
    header: "Last Sync",
    cell: ({ row }) =>
      row.original.lastSyncedAt ? formatDate(row.original.lastSyncedAt) : "Not synced"
  }
];

export function ConnectionsTable({ rows }: { rows: ConnectionRow[] }) {
  return <DataTable columns={columns} data={rows} />;
}
