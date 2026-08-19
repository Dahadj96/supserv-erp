import { asc, isNull } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { CompaniesList, type CompanyRow } from "./companies-list";

/**
 * Screen 21 — Companies. The first screen backed by the real database.
 *
 * `deleted_at is null` is the whole soft-delete contract on the read side: a
 * deleted company leaves the list but keeps resolving everywhere it is
 * referenced, and comes back from the 30-day bin intact (screen 83).
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
    .where(isNull(party.deletedAt))
    .orderBy(asc(party.legalName))
    .limit(100);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.companies")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("common.showing", { shown: rows.length, total: rows.length })}
          </p>
        </div>
      </div>

      <CompaniesList rows={rows} total={rows.length} />
    </main>
  );
}
