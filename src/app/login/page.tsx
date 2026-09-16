import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in | Marketplace Profit Analytics"
};

export default function LoginPage({
  searchParams
}: {
  searchParams?: { next?: string };
}) {
  const nextPath = sanitizeNextPath(searchParams?.next);

  return (
    <main className="grid min-h-screen place-items-center bg-mist px-4 py-10">
      <section className="w-full max-w-md rounded-md border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ocean">
          Private Tool
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
          Sign in to Profit Analytics
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This keeps your Walmart P&L data private when the app is hosted on the web.
        </p>
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}

function sanitizeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/pnl/parent";
  }

  if (value.startsWith("/login") || value.startsWith("/logout")) {
    return "/pnl/parent";
  }

  return value;
}
