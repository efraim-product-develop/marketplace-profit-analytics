import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, getAuthConfig, isValidAuthCookie } from "@/lib/auth-cookie";

const PUBLIC_PATH_PREFIXES = ["/login", "/logout", "/_next", "/favicon.ico"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }

  const authConfig = getAuthConfig();
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);

  if (!authConfig.configured && !isProduction) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);

  if (!authConfig.configured) {
    return NextResponse.redirect(loginUrl);
  }

  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (await isValidAuthCookie(cookieValue, authConfig.secret)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"]
};
