export const AUTH_COOKIE_NAME = "marketplace_pnl_session";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export type AuthConfigStatus =
  | { configured: true; email: string; password: string; secret: string }
  | { configured: false; missing: string[] };

export function getAuthConfig(): AuthConfigStatus {
  const email = process.env.APP_LOGIN_EMAIL?.trim() ?? "";
  const password = process.env.APP_LOGIN_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  const missing: string[] = [];

  if (!email) {
    missing.push("APP_LOGIN_EMAIL");
  }

  if (!password) {
    missing.push("APP_LOGIN_PASSWORD");
  }

  if (!secret) {
    missing.push("AUTH_SECRET");
  }

  if (missing.length) {
    return { configured: false, missing };
  }

  return { configured: true, email, password, secret };
}

export async function createAuthCookieValue(email: string, secret: string) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = { email, expiresAt };
  const signature = await signPayload(payload, secret);

  return encodeBase64Url(JSON.stringify({ ...payload, signature }));
}

export async function isValidAuthCookie(value: string | undefined, secret: string) {
  if (!value) {
    return false;
  }

  try {
    const session = JSON.parse(decodeBase64Url(value)) as {
      email?: unknown;
      expiresAt?: unknown;
      signature?: unknown;
    };

    if (
      typeof session.email !== "string" ||
      typeof session.expiresAt !== "number" ||
      typeof session.signature !== "string" ||
      session.expiresAt <= Date.now()
    ) {
      return false;
    }

    const expected = await signPayload(
      { email: session.email, expiresAt: session.expiresAt },
      secret
    );

    return timingSafeEqual(session.signature, expected);
  } catch {
    return false;
  }
}

export function getAuthCookieMaxAgeSeconds() {
  return Math.floor(SESSION_TTL_MS / 1000);
}

async function signPayload(payload: { email: string; expiresAt: number }, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${payload.email}|${payload.expiresAt}`)
  );

  return encodeBase64Url(String.fromCharCode(...new Uint8Array(signature)));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

function encodeBase64Url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );

  return atob(padded);
}
