"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createImportPreview, commitImportRun } from "@/server/imports/framework";
import type { ImportKind } from "@/server/imports/types";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganization } from "@/server/organizations/current";

export async function previewImport(formData: FormData) {
  const importKind = parseImportKind(formData.get("importKind"));
  const marketplace = getCurrentMarketplace();
  const reportMonth = String(formData.get("reportMonth") ?? "").trim();
  const reportDate = String(formData.get("reportDate") ?? "").trim();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/imports/${importKind}?error=missing-file`);
  }

  const organization = await getCurrentOrganization();
  const importRun = await createImportPreview({
    organizationId: organization.id,
    marketplace,
    importKind,
    originalFileName: file.name,
    buffer: Buffer.from(await file.arrayBuffer()),
    options: {
      ...(reportMonth ? { reportMonth } : {}),
      ...(reportDate ? { reportDate } : {})
    }
  });

  revalidatePath(`/imports/${importKind}`);
  redirect(`/imports/${importKind}/${importRun.id}`);
}

export async function importPreviewedReport(formData: FormData) {
  const importKind = parseImportKind(formData.get("importKind"));
  const importRunId = String(formData.get("importRunId") ?? "").trim();

  if (!importRunId) {
    redirect(`/imports/${importKind}?error=missing-import`);
  }

  const organization = await getCurrentOrganization();

  await commitImportRun({
    organizationId: organization.id,
    importRunId
  });

  revalidatePath(`/imports/${importKind}`);
  revalidatePath(`/imports/${importKind}/${importRunId}`);
  revalidatePath("/pnl/sku");
  revalidatePath("/pnl/parent");
  redirect(`/imports/${importKind}/${importRunId}`);
}

function parseImportKind(value: FormDataEntryValue | null): ImportKind {
  if (value === "sales" || value === "settlements" || value === "advertising" || value === "inventory") {
    return value;
  }

  return "sales";
}
