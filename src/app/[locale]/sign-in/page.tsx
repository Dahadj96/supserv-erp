import { getTranslations, setRequestLocale } from "next-intl/server";
import { MicrosoftButton } from "./microsoft-button";

/**
 * Screen 01 — Login. One button, because there is one way in: the Microsoft 365
 * account the person already has. No password lives in this system.
 */
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center bg-plane p-6">
      <div className="w-[400px] rounded-[var(--radius-card)] border border-line bg-surface p-7">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-[var(--radius-control)] bg-ink text-small font-semibold text-on-ink">
            S
          </span>
          <div className="leading-tight">
            <p className="text-lead font-semibold text-ink">SUPSERV</p>
            <p className="text-micro text-muted">SARL · Adrar</p>
          </div>
        </div>

        <h1 className="mt-6 text-lead font-semibold text-ink">{t("auth.signIn")}</h1>
        <p className="mt-1.5 text-tiny leading-relaxed text-secondary">{t("auth.withMicrosoft")}</p>

        {error ? (
          <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
            {t("auth.failed")}
          </p>
        ) : null}

        <div className="mt-5">
          <MicrosoftButton locale={locale} label={t("auth.microsoftButton")} />
        </div>

        <p className="mt-4 text-micro leading-relaxed text-muted">{t("auth.noAccountHelp")}</p>
      </div>
    </div>
  );
}
