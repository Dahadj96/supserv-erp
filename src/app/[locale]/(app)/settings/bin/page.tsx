import { getTranslations, setRequestLocale } from "next-intl/server";
import { restoreCompany } from "@/app/[locale]/(app)/companies/delete-actions";
import { restorePersonAction } from "@/app/[locale]/(app)/contacts/delete-actions";
import { restoreDealAction } from "@/app/[locale]/(app)/deals/[id]/delete-actions";
import { restoreNoteAction } from "@/app/[locale]/(app)/deals/[id]/timeline/delete-actions";
import { restoreDocumentAction } from "@/app/[locale]/(app)/documents/[id]/delete-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type BinKind, listBin } from "@/domain/deletion";
import { Link } from "@/i18n/navigation";

/**
 * Screen 83 — the bin. Restorable for 30 days, then the record is gone but its
 * audit trail is not.
 *
 * It holds five kinds now: a company, a deal, a draft document, a person and a
 * note. Each one restores through the action that owns it — each was written
 * separately and each knows where to land afterwards — so this screen
 * dispatches on the row's kind rather than sending everything to
 * `restoreCompany` and hoping.
 */
export const dynamic = "force-dynamic";

/**
 * One restore per kind, named in one place. A `bind` chain of five ternaries is
 * how the fourth kind gets quietly appended to the wrong action.
 */
const RESTORE: Record<BinKind, (locale: string, id: string) => () => Promise<void>> = {
  company: (locale, id) => restoreCompany.bind(null, locale, id),
  deal: (locale, id) => restoreDealAction.bind(null, locale, id),
  document: (locale, id) => restoreDocumentAction.bind(null, locale, id),
  person: (locale, id) => restorePersonAction.bind(null, locale, id),
  note: (locale, id) => restoreNoteAction.bind(null, locale, id),
};

export default async function BinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const rows = await listBin();
  const fmt = (d: Date) => d.toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB");

  /**
   * What this row is, said in a word. Written out rather than built from a
   * template literal so `tests/unit/messages.test.ts` can see the keys, and
   * left on the neutral tone: `good`, `warning` and `critical` mean a state in
   * this design system, and "this is a document" is not a state.
   */
  const KIND_LABEL: Record<BinKind, string> = {
    company: t("bin.kind.company"),
    deal: t("bin.kind.deal"),
    document: t("bin.kind.document"),
    person: t("bin.kind.person"),
    note: t("bin.kind.note"),
  };

  const shown = rows.map((row) => ({
    ...row,

    kindLabel: KIND_LABEL[row.kind],

    // A company, a deal, a name and a note all arrive as text a person typed.
    // A document arrives as its kind, which is a key with a name in each
    // language.
    label:
      row.kind === "document"
        ? t.has(`documents.kind.${row.what}`)
          ? t(`documents.kind.${row.what}`)
          : row.what
        : row.what,

    /**
     * A row is a link only where the page it points at still renders. A binned
     * company's does — screen 83's "never a blank 404" notice lives there — and
     * so does a binned draft's, which offers Restore in place. `getDeal`
     * filters `deleted_at`, so a binned deal has no page at all: linking it
     * would be a 404, which is the one thing this screen exists to prevent.
     * Neither does a binned person — screens 76 and 51 are lists, and a person
     * has never had a page of their own — and a note has never had one either.
     */
    href:
      row.kind === "company"
        ? `/companies/${row.id}`
        : row.kind === "document"
          ? `/documents/${row.id}`
          : null,

    restore: RESTORE[row.kind](locale, row.id),
  }));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("bin.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("bin.subtitle")}</p>
      </div>

      <div className="max-w-[1000px] px-4 md:px-7 py-6">
        {shown.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
            <h2 className="text-lead font-semibold text-ink">{t("bin.emptyTitle")}</h2>
            <p className="mx-auto mt-1.5 max-w-[420px] text-tiny leading-relaxed text-secondary">
              {t("bin.emptyBody")}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-tiny">
            <thead>
              <tr className="border-b border-line-subtle text-micro text-muted">
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.what")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.when")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.reason")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.goneIn")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={`${row.kind}:${row.id}`}
                  className="border-b border-line-subtle last:border-0"
                >
                  <td className="px-4 py-2.5 text-ink">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge>{row.kindLabel}</Badge>
                      {row.href ? (
                        <Link className="text-ink hover:underline" href={row.href}>
                          {row.label}
                        </Link>
                      ) : (
                        <span>{row.label}</span>
                      )}
                      <span className="text-micro text-muted">
                        {row.kind === "document" ? t("bin.noNumber") : row.code}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{fmt(row.deletedAt)}</td>
                  <td className="px-4 py-2.5 text-secondary">{row.reason || "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={row.daysLeft <= 5 ? "critical" : "neutral"} fill="solid">
                      {t("bin.days", { count: row.daysLeft })}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <form action={row.restore}>
                      <Button type="submit" variant="secondary" size="small">
                        {t("bin.restore")}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-4 max-w-[720px] text-micro leading-relaxed text-muted">
          {t("bin.afterThirtyDays")}
        </p>
      </div>
    </main>
  );
}
