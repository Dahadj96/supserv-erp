import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { getSession } from "@/auth/session";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Everything behind sign-in. The shell is written ONCE here — Figma page v5 has
 * the same two components, and 79 screens instance them there.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const t = await getTranslations();
  const roleLabel = t(`auth.roles.${session.role}`);

  return (
    <div className="flex h-screen">
      <Sidebar displayName={session.displayName} roleLabel={roleLabel} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar displayName={session.displayName} role={session.role} locale={locale} />
        {children}
      </div>
    </div>
  );
}
