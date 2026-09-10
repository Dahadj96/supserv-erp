import { getTranslations, setRequestLocale } from "next-intl/server";
import { restoreCompany } from "@/app/[locale]/(app)/companies/delete-actions";
import { restorePersonAction } from "@/app/[locale]/(app)/contacts/delete-actions";
import { restoreDealAction } from "@/app/[locale]/(app)/deals/[id]/delete-actions";
import { restoreNoteAction } from "@/app/[locale]/(app)/deals/[id]/timeline/delete-actions";
import { restoreDocumentAction } from "@/app/[locale]/(app)/documents/[id]/delete-actions";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PurgeRow } from "@/components/ui/purge-row";
import { BIN_DAYS, type BinKind, listBin, purgeBlockedBy } from "@/domain/deletion";
import { Link } from "@/i18n/navigation";
import { purgeAction } from "./purge-actions";

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

export default async function BinPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; by?: string; purged?: string }>;
}) {
  const { locale } = await params;
  const { error, by, purged } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  const mayPurge = session?.role ? can(session.role, "records.purge") : false;

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

  /*
    V3 — whether each row could be destroyed, asked with the same function the
    purge itself calls, so the greyed button and the refusal cannot disagree.
    Only for the Gérant: nobody else may see a control they can never use.

    In parallel and not in a loop — the bin holds what a handful of people
    binned in thirty days, and five short reads per row is still one round trip.
  */
  const blocked = mayPurge
    ? await Promise.all(shown.map((row) => purgeBlockedBy(row.kind, row.id)))
    : shown.map(() => "notInBin" as const);

  /*
    The label the person has to type back, and the one the row already shows.
    A company's code, an enquiry's ref — something you can only produce by
    looking at the row you are standing on.
  */
  const purgeLabel = (row: (typeof shown)[number]) => row.code || row.label;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("bin.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("bin.subtitle")}</p>
      </div>

      <div className="max-w-[1000px] px-4 md:px-7 py-6">
        {purged ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
            {t("bin.purge.done")}
          </p>
        ) : null}
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny leading-relaxed text-critical-ink">
            {error === "stillReferenced"
              ? // Postgres's own answer, with the table it named. Not translated
                // and not meant to be: it is the answer to "why not", and vague
                // would be worse than technical here.
                t("bin.purge.stillReferenced", { table: by ?? "—" })
              : t.has(`bin.purge.error.${error}`)
                ? t(`bin.purge.error.${error}`)
                : error}
          </p>
        ) : null}
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
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.inTheBin")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
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
                  {/*
                    V3 — this column used to count DOWN to a purge that did not
                    exist: "gone in 4 days" beside rows that would still be here
                    in a year. A number that does not come true teaches a person
                    that the numbers in this system are decoration, and once that
                    is learned it applies to the ageing ladder too.

                    So it counts UP, which is a fact, and a row past thirty days
                    says it is ready to be removed for good — which is now a
                    thing somebody can actually do, one row at a time, in the
                    next column.
                  */}
                  <td className="px-4 py-2.5">
                    {row.daysLeft > 0 ? (
                      <span className="text-secondary">
                        {t("bin.days", { count: BIN_DAYS - row.daysLeft })}
                      </span>
                    ) : (
                      <Badge tone="warning">{t("bin.readyToGo")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-end gap-2">
                      <form action={row.restore}>
                        <Button type="submit" variant="secondary" size="small">
                          {t("bin.restore")}
                        </Button>
                      </form>
                      {mayPurge ? (
                        <PurgeRow
                          label={purgeLabel(row)}
                          what={t(`bin.purge.what.${row.kind}`)}
                          action={purgeAction.bind(null, locale, row.kind, row.id, purgeLabel(row))}
                          disabledReason={
                            blocked[index] ? t(`bin.purge.error.${blocked[index]}`) : undefined
                          }
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-4 max-w-[720px] text-micro leading-relaxed text-muted">
          {mayPurge ? t("bin.purge.howItWorks") : t("bin.afterThirtyDays")}
        </p>
      </div>
    </main>
  );
}
