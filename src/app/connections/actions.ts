"use server";

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentMarketplace } from "@/server/marketplaces/current";
import { getCurrentOrganizationId } from "@/server/organizations/current";
import {
  getWalmartApiCredentialStatus,
  testWalmartApiCredentials,
  WalmartApiError
} from "@/server/connectors/walmart/api-client";

const WALMART_ENV_KEYS = {
  clientId: "WALMART_MARKETPLACE_CLIENT_ID",
  clientSecret: "WALMART_MARKETPLACE_CLIENT_SECRET",
  market: "WALMART_MARKET",
  serviceName: "WALMART_SERVICE_NAME",
  baseUrl: "WALMART_API_BASE_URL",
  consumerChannelType: "WALMART_CONSUMER_CHANNEL_TYPE",
  sellerId: "WALMART_SELLER_ID"
} as const;

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

export async function testApiConnection() {
  const organizationId = await getCurrentOrganizationId();
  const marketplace = getCurrentMarketplace();

  if (marketplace !== "walmart") {
    return;
  }

  const displayName = "Walmart API";
  const credentialStatus = getWalmartApiCredentialStatus();
  const testedAt = new Date();

  if (credentialStatus.missing.length) {
    await upsertApiConnection({
      organizationId,
      marketplace,
      displayName,
      status: "ERROR",
      metadata: {
        apiConnection: {
          ok: false,
          testedAt: testedAt.toISOString(),
          message: `Missing environment variables: ${credentialStatus.missing.join(", ")}`,
          credentialStatus
        }
      }
    });
    revalidatePath("/connections");
    return;
  }

  try {
    const result = await testWalmartApiCredentials();

    await upsertApiConnection({
      organizationId,
      marketplace,
      displayName,
      status: "CONNECTED",
      externalAccountId: credentialStatus.sellerId,
      metadata: {
        apiConnection: {
          ...result,
          testedAt: testedAt.toISOString(),
          credentialStatus: {
            ...credentialStatus,
            clientSecret: true
          }
        }
      }
    });
  } catch (error) {
    await upsertApiConnection({
      organizationId,
      marketplace,
      displayName,
      status: "ERROR",
      externalAccountId: credentialStatus.sellerId,
      metadata: {
        apiConnection: {
          ok: false,
          testedAt: testedAt.toISOString(),
          message:
            error instanceof WalmartApiError
              ? error.message
              : "Walmart API connection test failed.",
          status: error instanceof WalmartApiError ? error.status ?? null : null,
          responseBody: error instanceof WalmartApiError ? error.responseBody ?? null : null,
          credentialStatus
        }
      }
    });
  }

  revalidatePath("/connections");
}

export async function saveWalmartApiCredentials(formData: FormData) {
  const marketplace = getCurrentMarketplace();

  if (marketplace !== "walmart") {
    return;
  }

  const current = readCurrentWalmartEnvValues();
  const nextValues = {
    [WALMART_ENV_KEYS.clientId]:
      readFormText(formData, "clientId") || current[WALMART_ENV_KEYS.clientId],
    [WALMART_ENV_KEYS.clientSecret]:
      readFormText(formData, "clientSecret") || current[WALMART_ENV_KEYS.clientSecret],
    [WALMART_ENV_KEYS.market]:
      readFormText(formData, "market") || current[WALMART_ENV_KEYS.market] || "us",
    [WALMART_ENV_KEYS.serviceName]:
      readFormText(formData, "serviceName") ||
      current[WALMART_ENV_KEYS.serviceName] ||
      "Walmart Marketplace",
    [WALMART_ENV_KEYS.baseUrl]:
      readFormText(formData, "baseUrl") ||
      current[WALMART_ENV_KEYS.baseUrl] ||
      "https://marketplace.walmartapis.com",
    [WALMART_ENV_KEYS.consumerChannelType]:
      readFormText(formData, "consumerChannelType") ||
      current[WALMART_ENV_KEYS.consumerChannelType],
    [WALMART_ENV_KEYS.sellerId]:
      readFormText(formData, "sellerId") || current[WALMART_ENV_KEYS.sellerId]
  };

  process.env.WALMART_MARKETPLACE_CLIENT_ID = nextValues[WALMART_ENV_KEYS.clientId];
  process.env.WALMART_MARKETPLACE_CLIENT_SECRET = nextValues[WALMART_ENV_KEYS.clientSecret];
  process.env.WALMART_MARKET = nextValues[WALMART_ENV_KEYS.market];
  process.env.WALMART_SERVICE_NAME = nextValues[WALMART_ENV_KEYS.serviceName];
  process.env.WALMART_API_BASE_URL = nextValues[WALMART_ENV_KEYS.baseUrl];
  process.env.WALMART_CONSUMER_CHANNEL_TYPE =
    nextValues[WALMART_ENV_KEYS.consumerChannelType];
  process.env.WALMART_SELLER_ID = nextValues[WALMART_ENV_KEYS.sellerId];

  await updateLocalEnvFile(nextValues);
  revalidatePath("/connections");
}

async function upsertApiConnection({
  organizationId,
  marketplace,
  displayName,
  status,
  externalAccountId,
  metadata
}: {
  organizationId: string;
  marketplace: string;
  displayName: string;
  status: "CONNECTED" | "ERROR";
  externalAccountId?: string | null;
  metadata: Prisma.InputJsonObject;
}) {
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
      status,
      syncMode: "api",
      credentialsRef: "env:WALMART_MARKETPLACE_CLIENT_ID",
      metadata,
      lastSyncedAt: status === "CONNECTED" ? new Date() : undefined
    },
    create: {
      organizationId,
      marketplace,
      displayName,
      externalAccountId: externalAccountId || null,
      status,
      syncMode: "api",
      credentialsRef: "env:WALMART_MARKETPLACE_CLIENT_ID",
      metadata,
      lastSyncedAt: status === "CONNECTED" ? new Date() : undefined
    }
  });
}

function readFormText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function readCurrentWalmartEnvValues() {
  return {
    [WALMART_ENV_KEYS.clientId]: process.env.WALMART_MARKETPLACE_CLIENT_ID ?? "",
    [WALMART_ENV_KEYS.clientSecret]: process.env.WALMART_MARKETPLACE_CLIENT_SECRET ?? "",
    [WALMART_ENV_KEYS.market]: process.env.WALMART_MARKET ?? "",
    [WALMART_ENV_KEYS.serviceName]: process.env.WALMART_SERVICE_NAME ?? "",
    [WALMART_ENV_KEYS.baseUrl]: process.env.WALMART_API_BASE_URL ?? "",
    [WALMART_ENV_KEYS.consumerChannelType]: process.env.WALMART_CONSUMER_CHANNEL_TYPE ?? "",
    [WALMART_ENV_KEYS.sellerId]: process.env.WALMART_SELLER_ID ?? ""
  };
}

async function updateLocalEnvFile(values: Record<string, string>) {
  const envPath = join(process.cwd(), ".env");
  let existing = "";

  try {
    existing = await readFile(envPath, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.split(/\r?\n/);
  const remaining = lines.filter((line) => {
    const key = line.split("=")[0]?.trim();
    return !Object.values(WALMART_ENV_KEYS).includes(key as never);
  });

  const additions = Object.values(WALMART_ENV_KEYS).map(
    (key) => `${key}=${formatEnvValue(values[key] ?? "")}`
  );
  const output = [...trimTrailingBlankLines(remaining), "", ...additions].join("\n") + "\n";

  await writeFile(envPath, output, "utf8");
}

function formatEnvValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function trimTrailingBlankLines(lines: string[]) {
  const next = [...lines];

  while (next.length && next[next.length - 1]?.trim() === "") {
    next.pop();
  }

  return next;
}
