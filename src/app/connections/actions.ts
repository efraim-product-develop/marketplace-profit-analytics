"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";

export async function saveConnection(formData: FormData) {
  const organizationId = await getCurrentOrganizationId();
  const marketplace = getCurrentMarketplace();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const externalAccountId = String(formData.get("externalAccountId") ?? "").trim();
  const status = String(formData.get("status") ?? "DRAFT");
  const syncMode = String(formData.get("syncMode") ?? "manual").trim() || "manual";

  if (!displayName) {
    return;
  }

  await prisma.marketplaceConnection.upsert({
    where: {
      organizationId_marketplace_displayName: {
        organizationId,
        marketplace,
        displayName
      }
    },
    update: {
      externalAccountId: externalAccountId || null,
      status: status === "CONNECTED" ? "CONNECTED" : status === "DISABLED" ? "DISABLED" : "DRAFT",
      syncMode
    },
    create: {
      organizationId,
      marketplace,
      displayName,
      externalAccountId: externalAccountId || null,
      status: status === "CONNECTED" ? "CONNECTED" : status === "DISABLED" ? "DISABLED" : "DRAFT",
      syncMode
    }
  });

  revalidatePath("/connections");
}
