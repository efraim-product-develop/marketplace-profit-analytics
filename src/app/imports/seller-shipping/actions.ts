"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";
import { upsertSellerFulfilledShippingCost } from "@/server/pnl/seller-fulfilled-shipping";

export async function saveSellerFulfilledShippingCost(formData: FormData) {
  const organizationId = await getCurrentOrganizationId();
  const marketplace = getCurrentMarketplace();
  const month = String(formData.get("month") ?? "").trim();
  const amount = parseAmount(formData.get("amount"));
  const notes = String(formData.get("notes") ?? "").trim();

  if (!month || amount === null || amount < 0) {
    return;
  }

  await upsertSellerFulfilledShippingCost({
    organizationId,
    marketplace,
    month,
    amount,
    notes
  });

  revalidatePath("/imports/seller-shipping");
  revalidatePath("/pnl/parent");
  revalidatePath("/pnl/sku");
}

function parseAmount(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}
