import { getTranslations, setRequestLocale } from "next-intl/server";
import { restoreCompany } from "@/app/[locale]/(app)/companies/delete-actions";
import { restoreDealAction } from "@/app/[locale]/(app)/deals/[id]/delete-actions";
import { restoreDocumentAction } from "@/app/[locale]/(app)/documents/[id]/delete-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listBin } from "@/domain/deletion";
import { Link } from "@/i18n/navigation";

/**
 * Screen 83 — the bin. Restorable for 30 days, then the record is gone but its
 * audit trail is not.
 *
 * It holds three kinds now: a company, an enquiry and a draft document. Each
 * one restores through the action that owns it — the three were written
 * separately and each knows where to land afterwards — so this screen
 * dispatches on the row's kind rather than sending everything to
 * `restoreCompany` and hoping.
 */
export const dynamic = "force-dynamic";

export default async function BinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const rows = await listBin();
  const fmt = (d: Date) => d.toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB");

  const shown = rows.map((row) => ({
    ...row,

    /**
     * What this row is, said in a word. Written out rather than built from a
     * template literal so `tests/unit/messages.test.ts` can see the keys, and
     * left on the neutral tone: `good`, `warning` and `critical` mean a state
     * in this design system, and "this is a document" is not a state.
     */
    kindLabel:
      row.kind === "company"
        ? t("bin.kind.company")
        : row.kind === "deal"
          ? t("bin.kind.deal")
          : t("bin.kind.document"),

    // A company and an enquiry arrive as text a person typed. A document
    // arrives as its kind, which is a key with a name in each language.
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
     * filters `deleted_at`, so a binned enquiry has no page at all: linking it
     * would be a 404, which is the one thing this screen exists to prevent.
     */
    href:
      row.kind === "company"
        ? `/companies/${row.id}`
        : row.kind === "document"
          ? `/documents/${row.id}`
          : null,

    restore:
      row.kind === "company"
        ? restoreCompany.bind(null, locale, row.id)
        : row.kind === "deal"
          ? restoreDealAction.bind(null, locale, row.id)
          : restoreDocumentAction.bind(null, locale, row.id),
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
