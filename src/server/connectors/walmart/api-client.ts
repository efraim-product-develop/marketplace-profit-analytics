const DEFAULT_BASE_URL = "https://marketplace.walmartapis.com";
const DEFAULT_MARKET = "us";
const DEFAULT_SERVICE_NAME = "Walmart Marketplace";

export type WalmartApiCredentialStatus = {
  clientId: boolean;
  clientSecret: boolean;
  market: string;
  consumerChannelType: boolean;
  baseUrl: string;
  sellerId: string | null;
  missing: string[];
};

export type WalmartTokenResult = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
};

export class WalmartApiError extends Error {
  readonly status?: number;
  readonly responseBody?: string;
  readonly retryAfterMs?: number;
  readonly endpoint?: string;

  constructor(
    message: string,
    status?: number,
    responseBody?: string,
    options: { retryAfterMs?: number; endpoint?: string } = {}
  ) {
    super(message);
    this.name = "WalmartApiError";
    this.status = status;
    this.responseBody = responseBody;
    this.retryAfterMs = options.retryAfterMs;
    this.endpoint = options.endpoint;
  }
}

export function getWalmartApiCredentialStatus(): WalmartApiCredentialStatus {
  const missing = [];

  if (!process.env.WALMART_MARKETPLACE_CLIENT_ID) {
    missing.push("WALMART_MARKETPLACE_CLIENT_ID");
  }

  if (!process.env.WALMART_MARKETPLACE_CLIENT_SECRET) {
    missing.push("WALMART_MARKETPLACE_CLIENT_SECRET");
  }

  return {
    clientId: Boolean(process.env.WALMART_MARKETPLACE_CLIENT_ID),
    clientSecret: Boolean(process.env.WALMART_MARKETPLACE_CLIENT_SECRET),
    market: getWalmartMarket(),
    consumerChannelType: Boolean(process.env.WALMART_CONSUMER_CHANNEL_TYPE),
    baseUrl: getWalmartApiBaseUrl(),
    sellerId: process.env.WALMART_SELLER_ID ?? null,
    missing
  };
}

export async function requestWalmartAccessToken(): Promise<WalmartTokenResult> {
  const clientId = process.env.WALMART_MARKETPLACE_CLIENT_ID;
  const clientSecret = process.env.WALMART_MARKETPLACE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new WalmartApiError(
      `Missing Walmart API credentials: ${getWalmartApiCredentialStatus().missing.join(", ")}`
    );
  }

  const url = new URL("/v3/token", getWalmartApiBaseUrl());
  const authorization = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${authorization}`,
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
    "WM_MARKET": getWalmartMarket(),
    "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
    "WM_SVC.NAME": process.env.WALMART_SERVICE_NAME ?? DEFAULT_SERVICE_NAME
  };

  if (process.env.WALMART_CONSUMER_CHANNEL_TYPE) {
    headers["WM_CONSUMER.CHANNEL.TYPE"] = process.env.WALMART_CONSUMER_CHANNEL_TYPE;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    cache: "no-store"
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new WalmartApiError(
      `Walmart token request failed with status ${response.status}.`,
      response.status,
      responseBody
    );
  }

  const parsed = parseJsonObject(responseBody);
  const accessToken = readString(parsed, "access_token");

  if (!accessToken) {
    throw new WalmartApiError("Walmart token response did not include an access token.");
  }

  return {
    accessToken,
    tokenType: readString(parsed, "token_type") ?? "Bearer",
    expiresIn: readNumber(parsed, "expires_in") ?? 900
  };
}

export async function testWalmartApiCredentials() {
  const token = await requestWalmartAccessToken();

  return {
    ok: true,
    tokenType: token.tokenType,
    expiresIn: token.expiresIn,
    market: getWalmartMarket(),
    baseUrl: getWalmartApiBaseUrl()
  };
}

export async function getWalmartAuthorizedHeaders(contentType = "application/json") {
  const token = await requestWalmartAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "WM_SEC.ACCESS_TOKEN": token.accessToken,
    "WM_MARKET": getWalmartMarket(),
    "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
    "WM_SVC.NAME": process.env.WALMART_SERVICE_NAME ?? DEFAULT_SERVICE_NAME
  };

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  if (process.env.WALMART_CONSUMER_CHANNEL_TYPE) {
    headers["WM_CONSUMER.CHANNEL.TYPE"] = process.env.WALMART_CONSUMER_CHANNEL_TYPE;
  }

  return headers;
}

export function getWalmartMarket() {
  return process.env.WALMART_MARKET ?? DEFAULT_MARKET;
}

export function getWalmartApiBaseUrl() {
  return process.env.WALMART_API_BASE_URL ?? DEFAULT_BASE_URL;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "number" ? value : null;
}
