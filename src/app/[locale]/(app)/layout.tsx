import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { getSession } from "@/auth/session";
import { PhoneBar } from "@/components/layout/phone-bar";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { StateBlock } from "@/components/ui/state-block";

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

  // Signed in, but nobody has said what they may do yet. Showing the shell
  // would be a lie — every control in it would be dead. Say so instead, and
  // name the person who can fix it.
  if (!session.role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-plane p-6">
        <div className="w-[520px]">
          <StateBlock
            tone="permission"
            title={t("auth.noRoleTitle")}
            body={t("auth.noRoleBody", { email: session.email })}
          />
        </div>
      </div>
    );
  }

  const roleLabel = t(`auth.roles.${session.role}`);

  return (
    <div className="flex h-screen">
      <Sidebar displayName={session.displayName} roleLabel={roleLabel} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar displayName={session.displayName} role={session.role} locale={locale} />
        {children}
        {/* Screen 86. Below `md` only, and only the four things a phone is for. */}
        <PhoneBar />
      </div>
    </div>
  );
}
