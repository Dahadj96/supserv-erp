import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { setUiLocale } from "@/auth/actions";
import { ROLES } from "@/auth/can";
import { getSession } from "@/auth/session";

/**
 * Screen 81 — My profile and preferences.
 *
 * The audit found the language rule (screen 53) had no home: it was defined and
 * uncontrollable. This page is that home. It writes `user_preference.ui_locale`
 * and nothing else — documents follow `party.doc_locale`, which is a different
 * axis and is never set from here (LAW 4).
 */
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const permissions = ROLES[session.role];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("profile.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("profile.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-5 px-7 py-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("profile.interfaceLanguage")}</h2>
          <p className="mt-1 max-w-[560px] text-micro leading-relaxed text-secondary">
            {t("profile.interfaceLanguageHelp")}
          </p>
          <div className="mt-3 flex gap-2">
            {[
              { code: "fr", label: "Français" },
              { code: "en", label: "English" },
            ].map((option) => (
              <form
                key={option.code}
                action={setUiLocale.bind(null, option.code, "/settings/profile")}
              >
                <button
                  type="submit"
                  className={`flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-tiny ${
                    locale === option.code
                      ? "border-ink bg-ink font-medium text-on-ink"
                      : "border-line bg-surface text-ink hover:bg-sunken"
                  }`}
                >
                  {locale === option.code ? <Check className="size-3.5" aria-hidden /> : null}
                  {option.label}
                </button>
              </form>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("profile.access")}</h2>
          <p className="mt-1 text-micro text-secondary">
            {t(`auth.roles.${session.role}`)} · {permissions.length} {t("auth.permissions")}
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {permissions.map((permission) => (
              <li
                key={permission}
                className="rounded-[var(--radius-pill)] bg-chip px-2 py-0.5 text-micro text-secondary"
              >
                {permission}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("profile.documentLanguage")}</h2>
          <p className="mt-1 max-w-[560px] text-micro leading-relaxed text-secondary">
            {t("profile.documentLanguageHelp")}
          </p>
        </section>
      </div>
    </main>
  );
}
