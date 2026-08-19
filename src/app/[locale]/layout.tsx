import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
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

/**
 * Only the document and the providers live here. The application shell —
 * sidebar and topbar — is in `(app)/layout.tsx`, so sign-in renders without it.
 */
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
          <NuqsAdapter>{children}</NuqsAdapter>
          {/* Screen 36 — toasts. */}
          <Toaster position="bottom-center" toastOptions={{ className: "text-tiny" }} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
