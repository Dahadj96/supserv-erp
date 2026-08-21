import { Building2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { searchParties } from "@/domain/search";
import { Link } from "@/i18n/navigation";

/**
 * Screen 82 — full search results. The audit found a search box in the topbar
 * of all 86 frames with only ⌘K behind it and no results page at all.
 */
export const dynamic = "force-dynamic";

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q = "" } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const term = q.trim();
  const parties = term ? await searchParties(term, 50) : [];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">
          {term ? t("search.resultsFor", { term }) : t("search.title")}
        </h1>
        <p className="mt-1 text-tiny text-muted">
          {term ? t("search.count", { count: parties.length }) : t("search.prompt")}
        </p>
      </div>

      <div className="px-7 py-6">
        {term && parties.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
            <h2 className="text-lead font-semibold text-ink">{t("search.noneTitle")}</h2>
            <p className="mx-auto mt-1.5 max-w-[460px] text-tiny leading-relaxed text-secondary">
              {t("search.noneBody")}
            </p>
          </div>
        ) : null}

        {parties.length > 0 ? (
          <section>
            <h2 className="mb-2 text-micro font-medium tracking-wide text-muted">
              {t("nav.companies")}
            </h2>
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              {parties.map((hit) => (
                <li key={hit.id} className="border-b border-line-subtle last:border-0">
                  <Link
                    href={`/companies/${hit.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-plane"
                  >
                    <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-tiny font-medium text-ink">
                        {hit.legalName}
                      </span>
                      <span className="block truncate text-micro text-muted">
                        {hit.code}
                        {hit.tradeName ? ` · ${hit.tradeName}` : ""}
                        {/* Say WHY this row matched, or "GTG" looks like a bug. */}
                        {hit.matchedOn === "alias" && hit.matchedAlias
                          ? ` · ${t("search.viaAlias", { alias: hit.matchedAlias })}`
                          : ""}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
