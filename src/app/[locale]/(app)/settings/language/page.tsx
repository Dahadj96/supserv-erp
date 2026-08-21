import { desc, eq } from "drizzle-orm";
import { Check, Info, Minus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { userPreference } from "@/db/schema/interface";
import { party } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { interfaceCoverage, LANGUAGE_RULES } from "@/domain/localisation";
import { Link } from "@/i18n/navigation";

/**
 * Screen 53 — Language and localisation.
 *
 * "Two settings that never touch each other: the language you work in, and the
 * language a document goes out in." That is LAW 4, and this screen is the only
 * place both halves are visible at once — which is the point of it.
 *
 * Nothing is edited here. The interface language belongs to a person and is
 * changed on their own profile; the document language belongs to a counterparty
 * and is changed on their record. A third place to set either would be a third
 * answer to "which language is this in".
 */
export const dynamic = "force-dynamic";

const SAMPLE = 1384858;

export default async function LanguagePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const people = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      uiLocale: userPreference.uiLocale,
    })
    .from(user)
    .leftJoin(userPreference, eq(userPreference.userId, user.id))
    .orderBy(user.name);

  const counterparties = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      docLocale: party.docLocale,
      emailLocale: party.emailLocale,
    })
    .from(party)
    .where(liveParty)
    .orderBy(desc(party.createdAt))
    .limit(12);

  const coverage = interfaceCoverage();

  const sampleFor = (loc: string) =>
    `${new Intl.DateTimeFormat(loc === "fr" ? "fr-DZ" : "en-GB", {
      dateStyle: "medium",
    }).format(new Date())} · ${new Intl.NumberFormat(loc === "fr" ? "fr-DZ" : "en-GB", {
      minimumFractionDigits: 2,
    }).format(SAMPLE)}`;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("language.title")}</h1>
          <p className="mt-1 max-w-[820px] text-tiny text-muted">{t("language.subtitle")}</p>
        </div>
        <div className="ms-auto">
          <Link href="/settings/profile">
            <Button variant="secondary">{t("language.changeMine")}</Button>
          </Link>
        </div>
      </div>

      <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[900px] text-tiny leading-relaxed text-accent-ink">
          {t("language.banner")}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("language.perPerson")}</h2>
              <span className="ms-auto text-micro text-muted">{t("language.perPersonWhat")}</span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2.5 ps-5 text-start font-medium">{t("language.col.person")}</th>
                  <th className="py-2.5 pe-4 text-start font-medium">
                    {t("language.col.interface")}
                  </th>
                  <th className="py-2.5 pe-5 text-start font-medium">{t("language.col.format")}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((row) => (
                  <tr key={row.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 ps-5 text-ink">{row.name || row.email}</td>
                    <td className="py-2.5 pe-4">
                      {row.uiLocale ? (
                        <Badge tone="neutral">{t(`language.name.${row.uiLocale}`)}</Badge>
                      ) : (
                        <Badge tone="warning">{t("language.defaultFrench")}</Badge>
                      )}
                    </td>
                    <td className="py-2.5 pe-5 text-micro text-muted">
                      {sampleFor(row.uiLocale ?? "fr")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("language.perCounterparty")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("language.perCounterpartyWhat")}
              </span>
            </div>
            {counterparties.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("language.noCounterparties")}</p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle text-micro text-muted">
                    <th className="py-2.5 ps-5 text-start font-medium">
                      {t("language.col.counterparty")}
                    </th>
                    <th className="w-[120px] py-2.5 pe-4 text-start font-medium">
                      {t("language.col.documents")}
                    </th>
                    <th className="w-[120px] py-2.5 pe-5 text-start font-medium">
                      {t("language.col.email")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {counterparties.map((row) => (
                    <tr key={row.id} className="border-b border-line-subtle last:border-0">
                      <td className="py-2.5 ps-5">
                        <Link className="text-ink hover:underline" href={`/companies/${row.id}`}>
                          {row.code} — {row.legalName}
                        </Link>
                      </td>
                      <td className="py-2.5 pe-4 text-secondary">
                        {t(`language.name.${row.docLocale}`)}
                      </td>
                      <td className="py-2.5 pe-5 text-secondary">
                        {t(`language.name.${row.emailLocale}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("language.changeOnTheRecord")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <h2 className="border-b border-line-subtle px-5 py-3.5 text-tiny font-semibold text-ink">
              {t("language.rules")}
            </h2>
            <ul>
              {LANGUAGE_RULES.map((rule) => (
                <li
                  key={rule.key}
                  className="flex items-start gap-2.5 border-b border-line-subtle px-5 py-2.5 last:border-0"
                >
                  {rule.enforced ? (
                    <Check className="mt-px size-4 shrink-0 text-good-ink" aria-hidden />
                  ) : (
                    <Minus className="mt-px size-4 shrink-0 text-muted" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="text-tiny text-ink">{t(`language.rule.${rule.key}`)}</p>
                    <p className="mt-0.5 text-micro text-muted">
                      {rule.enforced
                        ? (rule.where ?? t("language.enforced"))
                        : t("language.notEnforced")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("language.whyNotEnforced")}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("language.coverage")}</h2>
            <dl className="mt-3">
              {coverage.map((row) => (
                <div
                  key={row.locale}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`language.name.${row.locale}`)}</dt>
                  <dd className="ms-auto shrink-0">
                    {row.planned ? (
                      <Badge tone="warning">{t("language.planned")}</Badge>
                    ) : (
                      <Badge tone={row.percent === 100 ? "good" : "warning"}>
                        {t("language.percentOfKeys", { percent: row.percent, keys: row.keys })}
                      </Badge>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("language.counted")}</p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("language.neverTranslated")}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {(["legalNames", "identifiers", "references", "original", "numbers"] as const).map(
                (key) => (
                  <li key={key} className="text-micro leading-relaxed text-secondary">
                    {t(`language.never.${key}`)}
                  </li>
                ),
              )}
            </ul>
            <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
              {t("language.neverTranslatedWhy")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("language.arabic")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-muted">{t("language.arabicBody")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
