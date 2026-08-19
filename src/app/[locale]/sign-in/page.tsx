import { getTranslations, setRequestLocale } from "next-intl/server";
import { signInAsDevUser } from "@/auth/actions";
import { ROLES } from "@/auth/can";
import { DEV_AUTH_ENABLED } from "@/auth/session";
import { Button } from "@/components/ui/button";

/**
 * Screen 01 — Login, standing in for Better Auth + Entra ID.
 *
 * This picks a ROLE, not a person, and it exists only in development. A
 * production build reaches the guard below and says so plainly rather than
 * letting anyone in.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center bg-plane p-6">
      <div className="w-[420px] rounded-[var(--radius-card)] border border-line bg-surface p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-[var(--radius-control)] bg-ink text-on-ink text-small font-semibold">
            S
          </span>
          <div className="leading-tight">
            <p className="text-lead font-semibold text-ink">SUPSERV</p>
            <p className="text-micro text-muted">SARL · Adrar</p>
          </div>
        </div>

        <h1 className="mt-6 text-lead font-semibold text-ink">{t("auth.signIn")}</h1>

        {DEV_AUTH_ENABLED ? (
          <>
            <p className="mt-1.5 text-tiny leading-relaxed text-secondary">{t("auth.devNotice")}</p>
            <div className="mt-5 flex flex-col gap-2">
              {Object.keys(ROLES).map((role) => (
                <form
                  key={role}
                  action={async () => {
                    "use server";
                    await signInAsDevUser(role);
                  }}
                >
                  <Button type="submit" variant="secondary" className="w-full justify-between">
                    <span>{t(`auth.roles.${role}`)}</span>
                    <span className="text-micro text-muted">
                      {ROLES[role as keyof typeof ROLES].length} {t("auth.permissions")}
                    </span>
                  </Button>
                </form>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-tiny leading-relaxed text-critical-ink">
            {t("auth.notConfigured")}
          </p>
        )}
      </div>
    </div>
  );
}
