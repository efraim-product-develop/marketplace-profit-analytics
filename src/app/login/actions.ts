"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  AUTH_COOKIE_NAME,
  createAuthCookieValue,
  getAuthConfig,
  getAuthCookieMaxAgeSeconds
} from "@/lib/auth-cookie";

export type LoginState = {
  error?: string;
};

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const authConfig = getAuthConfig();

  if (!authConfig.configured) {
    return {
      error: `Login is not configured yet. Missing: ${authConfig.missing.join(", ")}.`
    };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = normalizeNextPath(String(formData.get("next") ?? "/pnl/parent"));

  if (email !== authConfig.email || password !== authConfig.password) {
    return { error: "That email or password is not correct." };
  }

  const cookieValue = await createAuthCookieValue(email, authConfig.secret);

  cookies().set({
    name: AUTH_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAuthCookieMaxAgeSeconds()
  });

  redirect(nextPath);
}

function normalizeNextPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/pnl/parent";
  }

  if (value.startsWith("/login") || value.startsWith("/logout")) {
    return "/pnl/parent";
  }

  return value;
}
