"use server";

import { revalidatePath } from "next/cache";
import { getMarketplaceConnector } from "@/server/connectors/registry";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganization } from "@/server/organizations/current";
import { commitSalesUpload } from "@/server/sales/upload-commit";
import { parseSalesUploadWorkbook } from "@/server/sales/upload-parser";
import type {
  ParsedSalesUploadRow,
  SalesUploadIssue,
  SalesUploadSummary
} from "@/server/sales/upload-types";

export type SalesUploadPreviewRow = {
  rowNumber: number;
  orderId: string;
  lineId: string;
  orderDate: string;
  sku: string;
  quantity: number;
  grossSales: number;
  fees: number;
  refund: number;
  status: string;
};

export type SalesUploadActionState = {
  status: "idle" | "preview" | "imported" | "error";
  marketplace?: string;
  fileName?: string;
  message?: string;
  summary?: SalesUploadSummary & {
    importedRows?: number;
    updatedRows?: number;
    feeRows?: number;
    refundRows?: number;
  };
  previewRows?: SalesUploadPreviewRow[];
  issues?: Array<{
    row: number;
    code: string;
    message: string;
    severity: "error" | "warning";
  }>;
  payload?: string;
};

type SalesUploadPayload = {
  marketplace: string;
  fileName: string;
  rows: Array<SerializedSalesUploadRow>;
  issues: SalesUploadIssue[];
};

type SerializedSalesUploadRow = Omit<ParsedSalesUploadRow, "orderDate" | "refund"> & {
  orderDate: string;
  refund?: {
    refundAmount: number;
    refundDate: string | null;
    currency: string;
  };
};

export async function previewSalesUpload(
  _previousState: SalesUploadActionState,
  formData: FormData
): Promise<SalesUploadActionState> {
  const marketplace = getCurrentMarketplace();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", marketplace, message: "Choose an Excel or CSV file before uploading." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase();

  if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
    return {
      status: "error",
      marketplace,
      message: "Upload a .xlsx, .xls, or .csv file."
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const connector = getMarketplaceConnector(marketplace);
  const parsed = connector?.parseSalesUploadWorkbook
    ? connector.parseSalesUploadWorkbook(buffer)
    : parseSalesUploadWorkbook(buffer, { marketplace });

  if (!parsed.rows.length && !parsed.issues.length) {
    return {
      status: "error",
      marketplace,
      fileName: file.name,
      message: "The file did not contain any recognizable sales rows."
    };
  }

  if (!parsed.rows.length) {
    return {
      status: "error",
      marketplace,
      fileName: file.name,
      message: "No valid sales rows were found. Check the required fields and row-level errors.",
      summary: parsed.summary,
      issues: serializeIssues(parsed.issues)
    };
  }

  return {
    status: "preview",
    marketplace,
    fileName: file.name,
    message: "Preview the parsed rows, then import when the summary looks right.",
    summary: parsed.summary,
    previewRows: buildPreviewRows(parsed.rows),
    issues: serializeIssues(parsed.issues),
    payload: encodePayload({
      marketplace,
      fileName: file.name,
      rows: parsed.rows.map(serializeRow),
      issues: parsed.issues
    })
  };
}

export async function importSalesUpload(
  _previousState: SalesUploadActionState,
  formData: FormData
): Promise<SalesUploadActionState> {
  const payloadValue = String(formData.get("payload") ?? "");

  if (!payloadValue) {
    return { status: "error", message: "Upload preview expired. Preview the file again." };
  }

  const payload = decodePayload(payloadValue);

  if (!payload || !payload.rows.length) {
    return { status: "error", message: "No valid sales rows were available to import." };
  }

  try {
    const organization = await getCurrentOrganization();
    const rows = payload.rows.map(deserializeRow);
    const result = await commitSalesUpload({
      organizationId: organization.id,
      marketplace: payload.marketplace,
      originalFileName: payload.fileName,
      rows,
      issues: payload.issues
    });
    const summary = summarizeRows(rows);

    revalidatePath("/pnl/sku");
    revalidatePath("/pnl/parent");
    revalidatePath("/sales/upload");

    return {
      status: "imported",
      marketplace: payload.marketplace,
      fileName: payload.fileName,
      message: "Sales upload imported successfully.",
      summary: {
        ...summary,
        totalRowsRead: rows.length + payload.issues.length,
        rejectedRows: payload.issues.length,
        importedRows: result.importedRows,
        updatedRows: result.updatedRows,
        feeRows: result.feeRows,
        refundRows: result.refundRows
      },
      previewRows: buildPreviewRows(rows),
      issues: serializeIssues(payload.issues)
    };
  } catch (error) {
    console.error(error);
    return {
      status: "error",
      marketplace: payload.marketplace,
      fileName: payload.fileName,
      message: "The upload could not be saved. Check the database connection and migrations."
    };
  }
}

function buildPreviewRows(rows: ParsedSalesUploadRow[]): SalesUploadPreviewRow[] {
  return rows.slice(0, 50).map((row) => ({
    rowNumber: row.sourceRow,
    orderId: row.externalOrderId,
    lineId: row.externalOrderLineId ?? "",
    orderDate: row.orderDate.toISOString(),
    sku: row.sku,
    quantity: row.quantity,
    grossSales: row.grossSales,
    fees: row.fees.reduce((sum, fee) => sum + fee.feeAmount, 0),
    refund: row.refund?.refundAmount ?? 0,
    status: row.orderStatus ?? ""
  }));
}

function serializeIssues(issues: SalesUploadIssue[]) {
  return issues.slice(0, 100).map((issue) => ({
    row: issue.row,
    code: issue.code,
    message: issue.message,
    severity: issue.severity
  }));
}

function serializeRow(row: ParsedSalesUploadRow): SerializedSalesUploadRow {
  return {
    ...row,
    orderDate: row.orderDate.toISOString(),
    refund: row.refund
      ? {
          ...row.refund,
          refundDate: row.refund.refundDate?.toISOString() ?? null
        }
      : undefined
  };
}

function deserializeRow(row: SerializedSalesUploadRow): ParsedSalesUploadRow {
  return {
    ...row,
    orderDate: new Date(row.orderDate),
    refund: row.refund
      ? {
          ...row.refund,
          refundDate: row.refund.refundDate ? new Date(row.refund.refundDate) : null
        }
      : undefined
  };
}

function encodePayload(payload: SalesUploadPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function decodePayload(value: string): SalesUploadPayload | null {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as SalesUploadPayload;
  } catch {
    return null;
  }
}

function summarizeRows(rows: ParsedSalesUploadRow[]): SalesUploadSummary {
  return {
    totalRowsRead: rows.length,
    validRows: rows.length,
    rejectedRows: 0,
    totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalGrossSales: roundMoney(rows.reduce((sum, row) => sum + row.grossSales, 0)),
    totalShippingRevenue: roundMoney(rows.reduce((sum, row) => sum + row.shippingRevenue, 0)),
    totalTaxCollected: roundMoney(rows.reduce((sum, row) => sum + row.taxCollected, 0)),
    totalDiscountAmount: roundMoney(rows.reduce((sum, row) => sum + row.discountAmount, 0)),
    totalFees: roundMoney(
      rows.reduce(
        (sum, row) => sum + row.fees.reduce((feeSum, fee) => feeSum + fee.feeAmount, 0),
        0
      )
    ),
    totalRefunds: roundMoney(rows.reduce((sum, row) => sum + (row.refund?.refundAmount ?? 0), 0))
  };
}

function roundMoney(value: number) {
  return Math.round(value * 10000) / 10000;
}
