"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseAdvertisingWorkbook } from "@/server/advertising/parser";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganization } from "@/server/organizations/current";

export async function uploadAdvertisingCosts(formData: FormData) {
  const marketplace = getCurrentMarketplace();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect("/advertising/upload?error=missing-file");
  }

  const parsed = parseAdvertisingWorkbook(Buffer.from(await file.arrayBuffer()));

  if (!parsed.rows.length) {
    redirect("/advertising/upload?error=no-valid-rows");
  }

  try {
    const organization = await getCurrentOrganization();
    await prisma.advertisingCost.createMany({
      data: parsed.rows.map((row) => ({
        organizationId: organization.id,
        marketplace,
        source: "seller_center_sem",
        sellerSku: row.sellerSku,
        parentSku: row.parentSku,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        costDate: row.costDate,
        amount: row.amount,
        currency: row.currency,
        metadata: {
          sourceRow: row.sourceRow,
          parserErrors: parsed.errors.length
        }
      }))
    });
  } catch (error) {
    console.error(error);
    redirect("/advertising/upload?error=database");
  }

  revalidatePath("/pnl/sku");
  revalidatePath("/pnl/parent");
  redirect("/pnl/sku");
}
