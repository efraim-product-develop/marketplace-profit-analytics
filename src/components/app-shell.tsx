"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import {
  Boxes,
  FileSpreadsheet,
  LogOut,
  type LucideIcon,
  Plug,
  Settings,
  Store,
  UploadCloud
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ACTIVE_MARKETPLACE_COOKIE, type MarketplaceOption } from "@/lib/marketplace-context";

const navigation: Array<{
  href: Route;
  label: string;
  icon: LucideIcon;
  activePrefixes?: string[];
}> = [
  { href: "/connections", label: "Connections", icon: Plug },
  {
    href: "/imports",
    label: "Manual imports",
    icon: UploadCloud,
    activePrefixes: ["/imports", "/cogs/upload", "/ad-spend/upload", "/advertising/upload"]
  },
  { href: "/cogs/audit", label: "COGS Audit", icon: FileSpreadsheet },
  { href: "/pnl/parent", label: "Parent P&L", icon: Boxes },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({
  children,
  marketplaces,
  selectedMarketplace
}: {
  children: React.ReactNode;
  marketplaces: MarketplaceOption[];
  selectedMarketplace: string;
}) {
  const pathname = usePathname();

  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-mist text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-slate-200 bg-white lg:block">
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ocean">
              Marketplace
            </div>
            <div className="mt-1 text-xl font-semibold tracking-normal">Profit Analytics</div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-4">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isNavigationItemActive(pathname, item);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink",
                    active && "bg-ocean text-white hover:bg-ocean hover:text-white"
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-slate-200 p-4">
            <Link
              href="/logout"
              prefetch={false}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink"
            >
              <LogOut aria-hidden className="h-4 w-4" />
              Sign out
            </Link>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-semibold">Profit Analytics</div>
            <MarketplaceSelector
              marketplaces={marketplaces}
              selectedMarketplace={selectedMarketplace}
            />
            <Link
              href="/logout"
              prefetch={false}
              aria-label="Sign out"
              title="Sign out"
              className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-600"
            >
              <LogOut aria-hidden className="h-4 w-4" />
            </Link>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isNavigationItemActive(pathname, item);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600",
                    active && "border-ocean bg-ocean text-white"
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4" />
                </Link>
              );
            })}
          </nav>
        </header>
        <header className="sticky top-0 z-10 hidden border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur lg:flex lg:justify-end lg:gap-3">
          <MarketplaceSelector
            marketplaces={marketplaces}
            selectedMarketplace={selectedMarketplace}
          />
          <Link
            href="/logout"
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-ink"
          >
            <LogOut aria-hidden className="h-4 w-4" />
            Sign out
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function isNavigationItemActive(pathname: string, item: (typeof navigation)[number]) {
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }

  return item.activePrefixes?.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function MarketplaceSelector({
  marketplaces,
  selectedMarketplace
}: {
  marketplaces: MarketplaceOption[];
  selectedMarketplace: string;
}) {
  const router = useRouter();

  function handleChange(value: string) {
    document.cookie = `${ACTIVE_MARKETPLACE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
      <Store aria-hidden className="h-4 w-4 text-ocean" />
      <span className="sr-only">Marketplace</span>
      <select
        aria-label="Active marketplace"
        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-ocean focus:ring-2 focus:ring-ocean/20"
        value={selectedMarketplace}
        onChange={(event) => handleChange(event.target.value)}
      >
        {marketplaces.map((marketplace) => (
          <option key={marketplace.marketplace} value={marketplace.marketplace}>
            {marketplace.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
