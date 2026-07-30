"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { getSkuPnlSourceLabel } from "@/server/pnl/sku-page";
import type { ProfitRow } from "@/server/pnl/types";

function getColumns(currentQueryString: string): ColumnDef<ProfitRow>[] {
  return [
  {
    accessorKey: "sellerSku",
    header: "Seller SKU",
    cell: ({ row }) => row.original.sellerSku ?? "Unassigned"
  },
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
    accessorKey: "brand",
    header: "Brand",
    cell: ({ row }) => row.original.brand ?? "-"
  },
  {
    accessorKey: "department",
    header: "Department",
    cell: ({ row }) => row.original.department ?? "-"
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
    cell: ({ row }) =>
      row.original.sellerSku ? (
        <a
          className="text-sm font-semibold text-ocean transition hover:text-ocean/80"
          href={buildOrderHref(currentQueryString, row.original.sellerSku)}
        >
          View
        </a>
      ) : (
        "-"
      )
  }
  ];
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

export function SkuPnlTable({
  rows,
  currentQueryString
}: {
  rows: ProfitRow[];
  currentQueryString: string;
}) {
  const columns = getColumns(currentQueryString);
  return <DataTable columns={columns} data={rows} />;
}

function SourceBadge({ source }: { source: ProfitRow["salesSource"] }) {
  return (
    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
      {getSkuPnlSourceLabel(source)}
    </span>
  );
}

function buildOrderHref(currentQueryString: string, sellerSku: string) {
  const params = new URLSearchParams(currentQueryString);
  params.set("sku", sellerSku);
  return `/pnl/sku?${params.toString()}`;
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
