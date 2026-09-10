import { FileWarning, Search } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { catalogue } from "@/domain/item-technical";
import { Link } from "@/i18n/navigation";

/**
 * V0 — the catalogue, and the door to screen 77.
 *
 * `/items/[id]/technical` shipped complete: an upload form wired to
 * `addItemMedia`, five media kinds, provenance on every row. Nothing in the
 * application linked to it. No nav row, no list, no link from a deal line — so
 * the owner tested the ERP, found no way to attach a datasheet to an item, and
 * wrote down that the capability did not exist.
 *
 * This screen is not new capability. It is the door on the room.
 *
 * "Missing a datasheet" is computed here and not stored, and a GENERIC item
 * (câble HP, boulonnerie, main-d'œuvre) is never counted as missing one: no
 * manufacturer publishes a datasheet for a metre of cable, so nagging for it
 * for ever would train somebody to ignore the column.
 */
export const dynamic = "force-dynamic";

export default async function ItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; deal?: string }>;
}) {
  const { locale } = await params;
  const { q, deal } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const rows = await catalogue({ search: q });
  const missing = rows.filter((r) => !r.hasDatasheet && !r.isGeneric).length;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("items.title") }]}
        title={t("items.title")}
        state={
          q
            ? t("items.stateSearch", { n: rows.length, q })
            : t("items.state", { n: rows.length, missing })
        }
        actions={null}
        noActionReason={t("items.noActionReason")}
      />

      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-7">
        <form className="mb-4 flex items-center gap-2" action={`/${locale}/items`}>
          {/* The deal is carried through the search so a person who arrived
              from a deal line does not lose it by looking for the item. */}
          {deal ? <input type="hidden" name="deal" value={deal} /> : null}
          <div className="relative flex-1 max-w-[420px]">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder={t("items.searchPlaceholder")}
              className="h-[34px] w-full rounded-[var(--radius-control)] border border-line bg-surface ps-8 pe-2 text-tiny outline-none focus:border-ink"
            />
          </div>
        </form>

        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-8 text-center text-tiny text-muted">
            {q ? t("items.emptySearch", { q }) : t("items.empty")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <table className="w-full text-tiny">
              <thead className="border-b border-line-subtle text-micro text-secondary">
                <tr>
                  <th className="w-[130px] px-4 py-2.5 text-start font-medium">
                    {t("items.column.code")}
                  </th>
                  <th className="px-4 py-2.5 text-start font-medium">
                    {t("items.column.designation")}
                  </th>
                  <th className="w-[190px] px-4 py-2.5 text-start font-medium">
                    {t("items.column.brand")}
                  </th>
                  <th className="w-[220px] px-4 py-2.5 text-start font-medium">
                    {t("items.column.technical")}
                  </th>
                  <th className="w-[110px] px-4 py-2.5 text-end font-medium">
                    {t("items.column.usedOn")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line-subtle last:border-0">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/items/${row.id}/technical${deal ? `?deal=${deal}` : ""}`}
                        className="font-mono text-micro text-ink hover:underline"
                      >
                        {row.code}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/items/${row.id}/technical${deal ? `?deal=${deal}` : ""}`}
                        className="text-ink hover:underline"
                      >
                        {row.designation}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">
                      {[row.brand, row.model].filter(Boolean).join(" · ") || (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.hasDatasheet ? (
                        <Badge tone="good">{t("items.held", { n: row.mediaCount })}</Badge>
                      ) : row.isGeneric ? (
                        <span className="text-micro text-muted" title={t("items.genericHelp")}>
                          {t("items.generic")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone="warning">{t("items.noDatasheet")}</Badge>
                          {row.mediaCount > 0 ? (
                            <span className="text-micro text-muted">
                              {t("items.othersHeld", { n: row.mediaCount })}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums text-secondary">
                      {row.usedOnCount || <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {missing > 0 ? (
          <p className="mt-4 flex items-start gap-2 text-micro leading-relaxed text-muted">
            <FileWarning className="mt-px size-4 shrink-0 text-warning" aria-hidden />
            {t("items.missingHelp", { n: missing })}
          </p>
        ) : null}
      </div>
    </main>
  );
}
