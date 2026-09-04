import { Building2, Package, User } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { CONTACT_RELATIONSHIP } from "@/domain/contact";
import {
  isSearchScope,
  SEARCH_SCOPES,
  searchItems,
  searchParties,
  searchPeople,
} from "@/domain/search";
import { Link } from "@/i18n/navigation";

/**
 * Screen 82 — full search results. The audit found a search box in the topbar
 * of all 86 frames with only ⌘K behind it and no results page at all.
 *
 * "Search looks in four places: records, documents we generated, files we
 * received, and email bodies." Three of those four need phases 2 and 3. What
 * exists today is records, so records is what this searches — and the scopes
 * that are not built are absent rather than empty, because an empty scope reads
 * as "nothing found" when the truth is "not looked".
 */
export const dynamic = "force-dynamic";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      <h2 className="mb-2 text-micro font-medium tracking-wide text-muted">{title}</h2>
      <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {children}
      </ul>
    </section>
  );
}

function Hit({
  href,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li className="border-b border-line-subtle last:border-0">
      <Link href={href} className="flex items-center gap-3 px-4 py-3 hover:bg-plane">
        <span className="shrink-0 text-muted">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-tiny font-medium text-ink">{title}</span>
          <span className="block truncate text-micro text-muted">{detail}</span>
        </span>
      </Link>
    </li>
  );
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const { locale } = await params;
  const { q = "", scope: rawScope } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const term = q.trim();
  const scope = isSearchScope(rawScope) ? rawScope : "all";

  const [parties, people, items] = term
    ? await Promise.all([
        scope === "all" || scope === "companies" ? searchParties(term, 50) : [],
        scope === "all" || scope === "people" ? searchPeople(term, 50) : [],
        scope === "all" || scope === "items" ? searchItems(term, 50) : [],
      ])
    : [[], [], []];

  const total = parties.length + people.length + items.length;
  const scoped = (next: string) =>
    `/search?q=${encodeURIComponent(term)}${next === "all" ? "" : `&scope=${next}`}`;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">
          {term ? t("search.resultsFor", { term }) : t("search.title")}
        </h1>
        <p className="mt-1 text-tiny text-muted">
          {term ? t("search.count", { count: total }) : t("search.prompt")}
        </p>
      </div>

      {term ? (
        <div className="flex flex-wrap items-center gap-2 px-4 md:px-7 pt-5">
          {SEARCH_SCOPES.map((key) => {
            const active = key === scope;
            return (
              <Link
                key={key}
                href={scoped(key)}
                aria-current={active ? "true" : undefined}
                className={`rounded-[var(--radius-pill)] px-3 py-1 text-tiny transition-colors ${
                  active
                    ? "bg-ink font-medium text-on-ink"
                    : "border border-line bg-surface text-secondary hover:bg-sunken"
                }`}
              >
                {t(`search.scope.${key}`)}
              </Link>
            );
          })}
          <span className="ms-auto text-micro text-muted">{t("search.whereItLooks")}</span>
        </div>
      ) : null}

      <div className="px-4 md:px-7 py-6">
        {term && total === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
            <h2 className="text-lead font-semibold text-ink">{t("search.noneTitle")}</h2>
            <p className="mx-auto mt-1.5 max-w-[460px] text-tiny leading-relaxed text-secondary">
              {t("search.noneBody")}
            </p>
          </div>
        ) : null}

        {parties.length > 0 ? (
          <Group title={t("nav.companies")}>
            {parties.map((hit) => (
              <Hit
                key={hit.id}
                href={`/companies/${hit.id}`}
                icon={<Building2 className="size-4" aria-hidden />}
                title={hit.legalName}
                detail={[
                  hit.code,
                  hit.tradeName,
                  // Say WHY this row matched, or "GTG" looks like a bug.
                  hit.matchedOn === "alias" && hit.matchedAlias
                    ? t("search.viaAlias", { alias: hit.matchedAlias })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Group>
        ) : null}

        {people.length > 0 ? (
          <Group title={t("search.scope.people")}>
            {people.map((hit) => (
              <Hit
                key={hit.id}
                href={
                  hit.companyId
                    ? `/companies/${hit.companyId}`
                    : hit.relationship === CONTACT_RELATIONSHIP
                      ? "/contacts"
                      : "/people"
                }
                icon={<User className="size-4" aria-hidden />}
                title={hit.fullName}
                detail={[
                  hit.trade,
                  hit.companyName,
                  t(
                    hit.relationship === CONTACT_RELATIONSHIP
                      ? "search.isContact"
                      : "search.isPerson",
                  ),
                  hit.matchedOn === "email" ? t("search.viaEmail") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Group>
        ) : null}

        {items.length > 0 ? (
          <Group title={t("search.scope.items")}>
            {items.map((hit) => (
              <Hit
                key={hit.id}
                href={`/search?q=${encodeURIComponent(hit.code)}`}
                icon={<Package className="size-4" aria-hidden />}
                title={hit.designation}
                detail={[
                  hit.code,
                  hit.brand,
                  hit.matchedOn === "alias" && hit.matchedAlias
                    ? t("search.viaAlias", { alias: hit.matchedAlias })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Group>
        ) : null}

        {term ? (
          <p className="mt-6 max-w-[620px] text-micro leading-relaxed text-muted">
            {t("search.notLookedYet")}
          </p>
        ) : null}
      </div>
    </main>
  );
}
