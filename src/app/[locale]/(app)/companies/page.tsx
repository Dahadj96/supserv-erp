import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { suggestDuplicateParties } from "@/domain/merge";
import { Link } from "@/i18n/navigation";
import { CompaniesList, type CompanyRow } from "./companies-list";

/**
 * Screen 21 — Companies. The first screen backed by the real database.
 *
 * `liveParty` is the whole contract on the read side: binned, archived and
 * merged-away companies leave the list but keep resolving everywhere they are
 * referenced — the binned ones come back intact from the 30-day bin (screen 83),
 * and the merged ones land on their survivor (screen 84).
 */
export const dynamic = "force-dynamic";

export default async function CompaniesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const rows: CompanyRow[] = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      wilaya: party.wilaya,
      nif: party.nif,
      docLocale: party.docLocale,
    })
    .from(party)
    .where(liveParty)
    .orderBy(asc(party.legalName))
    .limit(100);

  // Screen 84 — "every list since has had two rows for one client". The list is
  // where a duplicate is felt, so it is where the offer to fix it belongs.
  const duplicates = await suggestDuplicateParties(50);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.companies")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("common.showing", { shown: rows.length, total: rows.length })}
          </p>
        </div>
        <div className="ms-auto">
          <Link href="/companies/new">
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
              {t("company.newTitle")}
            </Button>
          </Link>
        </div>
      </div>

      {duplicates.length > 0 ? (
        <div className="mx-7 mt-5 flex items-center gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-2.5">
          <p className="text-tiny text-warning-ink">
            {t("merge.banner", { count: duplicates.length })}
          </p>
          <div className="ms-auto">
            <Link href="/companies/duplicates">
              <Button variant="secondary" size="small">
                {t("merge.showAll")}
              </Button>
            </Link>
          </div>
        </div>
      ) : null}

      <CompaniesList rows={rows} total={rows.length} />
    </main>
  );
}
