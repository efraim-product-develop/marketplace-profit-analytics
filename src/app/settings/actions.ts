"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";

export async function saveSettings(formData: FormData) {
  const organizationId = await getCurrentOrganizationId();
  const defaultCurrency = String(formData.get("defaultCurrency") ?? "USD").trim().toUpperCase();
  const timeZone = String(formData.get("timeZone") ?? "America/New_York").trim();
  const defaultMarketplace = getCurrentMarketplace();
  const inventoryCostMethod = String(
    formData.get("inventoryCostMethod") ?? "LATEST_EFFECTIVE_DATE"
  );

  await prisma.organizationSettings.upsert({
    where: { organizationId },
    update: {
      defaultCurrency,
      timeZone,
      defaultMarketplace,
      inventoryCostMethod:
        inventoryCostMethod === "WEIGHTED_AVERAGE"
          ? "WEIGHTED_AVERAGE"
          : "LATEST_EFFECTIVE_DATE"
    },
    create: {
      organizationId,
      defaultCurrency,
      timeZone,
      defaultMarketplace,
      inventoryCostMethod:
        inventoryCostMethod === "WEIGHTED_AVERAGE"
          ? "WEIGHTED_AVERAGE"
          : "LATEST_EFFECTIVE_DATE"
    }
  });

  revalidatePath("/settings");
}
