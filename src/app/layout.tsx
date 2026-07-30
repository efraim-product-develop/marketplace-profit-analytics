import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { getCurrentMarketplace, getMarketplaceOptions } from "@/server/marketplaces/current";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Marketplace Profit Analytics",
  description: "Local marketplace P&L analytics built for SaaS expansion."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const marketplaceOptions = getMarketplaceOptions();
  const selectedMarketplace = getCurrentMarketplace();

  return (
    <html lang="en">
      <body className={inter.className}>
        <AppShell marketplaces={marketplaceOptions} selectedMarketplace={selectedMarketplace}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
