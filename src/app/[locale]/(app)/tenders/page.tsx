import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { badgeMessageKey } from "@/domain/deal/stage";
import { listTenders, tenderCounts } from "@/domain/tender/store";
import { Link } from "@/i18n/navigation";
import { type TenderListRow, TendersList } from "./tenders-list";

/**
 * Screen 07 — Tenders.
 *
 * The deal list, filtered to the ones answering a formal procedure, with the
 * two columns an enquiry does not have: the bid bond and how complete the
 * folder is.
 *
 * The Dossier bar is computed on every draw from the pieces and the company's
 * papers — there is no stored percentage, for the same reason there is no
 * stored stage. A folder that was 100 % in July is not 100 % in September when
 * the CASNOS attestation has expired in between, and a stored number would
 * still say it was.
 */
export const dynamic = "force-dynamic";

type Facet = "all" | "open" | "submitted" | "awarded" | "lost";

const FACETS: Facet[] = ["all", "open", "submitted", "awarded", "lost"];

export default async function TendersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const query = await searchParams;
  const show = (FACETS as string[]).includes(query.show ?? "") ? (query.show as Facet) : "all";

  const now = new Date();
  const [all, counts] = await Promise.all([listTenders(now), tenderCounts(now)]);
  const format = await getFormatter({ locale });

  const rows = all.filter((row) => {
    if (show === "submitted") return row.submittedAt !== null;
    if (show === "awarded") return row.badge === "won";
    if (show === "lost") return row.badge === "lost";
    if (show === "open")
      return row.submittedAt === null && row.badge !== "lost" && row.badge !== "noBid";
    return true;
  });

  const shortDay = (at: Date) => format.dateTime(at, { day: "numeric", month: "short" });

  /**
   * Task 3.6. The table is `DataTable` now, so the row that crosses to it is
   * flat and already decided — every date formatted, every badge a tone and a
   * label. The formatter and `deadlineDisplay`'s arithmetic stay here, where
   * the locale and the deal's own facts already are; a client component
   * recomputing "closing soon" would be a second opinion about the one figure
   * this screen exists to be trusted about.
   */
  const listRows: TenderListRow[] = rows.map((row) => ({
    id: row.dealId,
    reference: row.clientReference ?? row.ref,
    authority: row.authority,
    object: row.object,
    procedure: row.procedure,
    procedureLabel: t(`tenders.procedure.${row.procedure}`),
    procedureFormal: row.procedure === "aonr" || row.procedure === "aoo",
    submission: t(`deal.method.${row.submissionMethod}`),
    caution: row.cautionAmount
      ? format.number(Number(row.cautionAmount), { maximumFractionDigits: 0 })
      : "—",
    percent: row.percent,
    blocking: row.blocking,
    closes: row.submittedAt
      ? {
          kind: "submitted",
          label: t("tenders.submittedOn", { on: shortDay(row.submittedAt) }),
          urgent: false,
        }
      : row.deadline.kind === "closed"
        ? { kind: "closed", label: t(badgeMessageKey(row.badge)), urgent: false }
        : row.deadline.kind === "none"
          ? { kind: "none", label: t("tenders.noDeadline"), urgent: false }
          : {
              kind: "at",
              label: shortDay(row.deadline.at as Date),
              // Inside 48 hours, or already past. Both are red: a deadline that
              // has gone is not less urgent than one that is going.
              urgent: (row.deadline.hoursLeft ?? 0) < 48,
            },
  }));

  const empty = (
    /*
      Task 3.2's block, rendered here and handed to the table. `DataTable`
      draws it in place of the rows, so the screen has one empty state rather
      than one above the table and one inside it.
    */
    <StateBlock
      title={t("tenders.noneTitle")}
      body={t("tenders.none")}
      action={
        <Link href="/deals">
          <Button variant="primary">{t("common.openADeal")}</Button>
        </Link>
      }
    />
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/*
        P1. `tenders.summary` was already the live line this pattern asks for —
        open, closing within 48 hours, folders incomplete — so it moves across
        unchanged. What the screen did not have was an action: the same one its
        own empty state offers, because a tender is opened from the deal it
        belongs to and there is no other way to start one.
      */}
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("nav.tenders") }]}
        title={t("nav.tenders")}
        state={t("tenders.summary", {
          open: counts.open,
          closing: counts.closingSoon,
          incomplete: counts.incomplete,
        })}
        actions={
          <Link href="/deals">
            <Button variant="primary">{t("common.openADeal")}</Button>
          </Link>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-4 md:px-7 py-2.5">
        {FACETS.map((facet) => (
          <Link
            key={facet}
            href={facet === "all" ? "/tenders" : `/tenders?show=${facet}`}
            aria-current={show === facet ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              show === facet
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`tenders.facet.${facet}`)}
            <span className={show === facet ? "text-surface/70" : "text-muted"}>
              {counts[facet]}
            </span>
          </Link>
        ))}
      </div>

      {/*
        Task 3.6, the first of the four the audit named. The raw <table> that
        was here had no filters, no saved views, no column menu, no sort and
        no way to export what is on screen — every one of which `DataTable`
        has had since screen 79 was built, on four screens out of fifty-seven.
        CLAUDE.md: reuse, never rebuild. The facet chips above stay where they
        are; they are counted server-side and they live in the URL, and a
        filter panel answering the same question a second way would be two
        controls arguing over one list.
      */}
      <TendersList rows={listRows} total={all.length} emptyState={empty} />
    </main>
  );
}
