import { eq } from "drizzle-orm";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { COMPANY_ID, companyIdentity } from "@/db/schema/company";
import { profile } from "@/domain/compliance-profile";

/**
 * Screen 69's "Export the one-pager".
 *
 * "Export it, send it to your accountant, and have him confirm or correct the
 * unconfirmed rules. It is one page. That conversation is worth having once,
 * and this is the artefact that makes it a fifteen-minute conversation instead
 * of a research project."
 *
 * A print stylesheet rather than a generated PDF: `src/documents/pdf.ts` draws
 * documents SUPSERV issues to a counterparty, and this is not one of those.
 * Ctrl-P gives him a PDF, and the page stays one file instead of a second
 * renderer nobody remembers exists.
 */
export const dynamic = "force-dynamic";

export default async function OnePagerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [company] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID))
    .limit(1);

  const rules = await profile();
  const unconfirmed = rules.filter((r) => !r.confirmedOn);
  const confirmed = rules.filter((r) => r.confirmedOn);
  const today = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "long",
  }).format(new Date());

  return (
    <main className="mx-auto max-w-[820px] bg-surface px-10 py-10 text-ink print:px-0 print:py-0">
      <header className="border-b border-line pb-4">
        <p className="text-micro uppercase tracking-wide text-muted">
          {company?.legalName ?? t("onePager.yourCompany")}
        </p>
        <h1 className="mt-1 text-[22px] font-semibold">{t("onePager.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("onePager.dated", { date: today })}</p>
      </header>

      <section className="mt-6">
        <p className="text-tiny leading-relaxed">{t("onePager.intro")}</p>
      </section>

      <section className="mt-7">
        <h2 className="text-tiny font-semibold uppercase tracking-wide text-muted">
          {t("onePager.needYou", { count: unconfirmed.length })}
        </h2>
        {unconfirmed.length === 0 ? (
          <p className="mt-2 text-tiny text-secondary">{t("onePager.nothingPending")}</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-4">
            {unconfirmed.map((rule, index) => (
              <li key={rule.code} className="break-inside-avoid">
                <p className="text-tiny font-medium">
                  {index + 1}. {t.has(rule.messageKey) ? t(rule.messageKey) : rule.code}
                </p>
                <p className="mt-1 text-micro text-secondary">
                  {t("onePager.ourUnderstanding", {
                    source: rule.authority ?? t("onePager.noSource"),
                  })}
                </p>
                <p className="mt-1 text-micro text-secondary">
                  {t.has(`onePager.question.${rule.code}`)
                    ? t(`onePager.question.${rule.code}`)
                    : t("onePager.genericQuestion")}
                </p>
                <div className="mt-2 flex gap-6 text-micro text-muted">
                  <span className="border-b border-line pb-3 pe-24">{t("onePager.answer")}</span>
                  <span className="border-b border-line pb-3 pe-16">{t("onePager.signed")}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-tiny font-semibold uppercase tracking-wide text-muted">
          {t("onePager.alreadySettled", { count: confirmed.length })}
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {confirmed.map((rule) => (
            <li key={rule.code} className="text-micro text-secondary">
              <span className="text-ink">
                {t.has(rule.messageKey) ? t(rule.messageKey) : rule.code}
              </span>
              {" — "}
              {t("onePager.settledBy", {
                source: rule.authority ?? "—",
                who: rule.confirmedBy ?? "—",
                on: rule.confirmedOn ?? "—",
              })}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 border-t border-line pt-4">
        <p className="text-micro leading-relaxed text-muted">{t("onePager.footer")}</p>
      </section>

      <p className="mt-6 text-micro text-muted print:hidden">{t("onePager.printHint")}</p>
    </main>
  );
}
