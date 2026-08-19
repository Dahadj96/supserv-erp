import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "SUPSERV",
  description: "SARL SUPSERV — Adrar",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} dir="ltr" className={geist.variable}>
      <body className="bg-plane text-ink antialiased">
        <NextIntlClientProvider>
          {/* NuqsAdapter is what lets the filter live in the address — screen 79. */}
          <NuqsAdapter>
            {/* The shell, written once. Figma: Sidebar + Topbar on page v5. */}
            <div className="flex h-screen">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <Topbar />
                {children}
              </div>
            </div>
          </NuqsAdapter>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
