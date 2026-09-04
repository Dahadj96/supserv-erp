import { getTranslations, setRequestLocale } from "next-intl/server";
import { notADuplicate } from "@/app/[locale]/(app)/companies/merge-actions";
import { Button } from "@/components/ui/button";
import { suggestDuplicateParties } from "@/domain/merge";
import { Link } from "@/i18n/navigation";

/**
 * Screen 84 — "Show all 6". The suggestion list behind the merge screen.
 *
 * Nothing here is a finding. Every row is a proposal with the reason it was
 * proposed printed next to it, and a person decides.
 */
export const dynamic = "force-dynamic";

/** The suggester speaks SQL, the messages speak camelCase. One place to bridge. */
const SIGNAL_KEY = {
  rc: "rc",
  nif: "nif",
  email_domain: "emailDomain",
  similar_name: "similarName",
} as const;

export default async function DuplicatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const pairs = await suggestDuplicateParties(50);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("merge.duplicatesTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("merge.duplicatesSubtitle")}</p>
      </div>

      <div className="max-w-[1000px] px-4 md:px-7 py-6">
        {pairs.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
            <h2 className="text-lead font-semibold text-ink">{t("merge.noneTitle")}</h2>
            <p className="mx-auto mt-1.5 max-w-[440px] text-tiny leading-relaxed text-secondary">
              {t("merge.noneBody")}
            </p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {pairs.map((pair) => (
              <li
                key={`${pair.aId}-${pair.bId}`}
                className="flex items-center gap-4 border-b border-line-subtle px-4 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-tiny text-ink">
                    {pair.aName}
                    <span className="ms-2 text-micro text-muted">{pair.aCode}</span>
                  </p>
                  <p className="truncate text-tiny text-ink">
                    {pair.bName}
                    <span className="ms-2 text-micro text-muted">{pair.bCode}</span>
                  </p>
                </div>

                <span className="shrink-0 rounded-[var(--radius-pill)] bg-chip px-2 py-0.5 text-micro text-secondary">
                  {t(`merge.signal.${SIGNAL_KEY[pair.signal]}`)}
                </span>

                <div className="flex shrink-0 items-center gap-2">
                  <form action={notADuplicate.bind(null, locale, pair.aId, pair.bId)}>
                    <Button type="submit" variant="ghost" size="small">
                      {t("merge.notADuplicate")}
                    </Button>
                  </form>
                  <Link href={`/companies/merge?kept=${pair.aId}&retired=${pair.bId}`}>
                    <Button variant="secondary" size="small">
                      {t("merge.review")}
                    </Button>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
