import { Plus } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { previewBulkDelete, runBulkDelete } from "@/app/[locale]/(app)/bulk-delete-actions";
import { getSession } from "@/auth/session";
import { BulkResult } from "@/components/data";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listDeals } from "@/domain/deal/deal";
import { badgeMessageKey, DEADLINE_WARNING_HOURS, isStage, STAGES } from "@/domain/deal/stage";
import { formatMoney } from "@/domain/money";
import { Link } from "@/i18n/navigation";
import { describeDealDiscard, discardDealFromListAction } from "./[id]/delete-actions";
import { type DealRow, DealsList } from "./deals-list";

/**
 * Screen 05 — Deals.
 *
 * The stage column is derived on every load. There is no `stage` column to read
 * and no job that keeps one up to date; see `src/domain/deal/stage.ts` for why
 * that is worth the join.
 */
export const dynamic = "force-dynamic";

export default async function DealsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    stage?: string;
    open?: string;
    binned?: string;
    refused?: string;
    more?: string;
  }>;
}) {
  const { locale } = await params;
  const { stage, open, binned, refused, more } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const { rows, total, counts } = await listDeals({
    stage: isStage(stage) ? stage : undefined,
    openOnly: open === "1",
  });

  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
  });

  const listRows: DealRow[] = rows.map((row) => ({
    id: row.id,
    reference: row.ref,
    client: row.clientName,
    subject: row.subject,
    value: row.expectedValue
      ? formatMoney(row.expectedValue, { locale, currency: row.currency })
      : null,
    deadline:
      row.deadline.kind === "closed"
        ? t("deals.closed")
        : row.deadline.at
          ? day.format(row.deadline.at)
          : null,
    // Red inside 48 hours, and only while it is still live.
    deadlineUrgent:
      row.deadline.kind === "at" &&
      row.deadline.hoursLeft !== null &&
      row.deadline.hoursLeft < DEADLINE_WARNING_HOURS,
    stage: t(badgeMessageKey(row.badge)),
    stageKey: row.badge,
    owner: row.ownerId ? row.ownerId.slice(0, 2).toUpperCase() : null,
  }));

  // Each chip carries its own message key rather than having one built from
  // `key`. "All" is not a stage, so its label does not live under
  // `deals.filters` - and building `deals.filters.all` is exactly what made
  // this page a 500 for everybody. STAGES rather than a second hand-written
  // list, so a seventh stage cannot appear in one place and not the other.
  const chips: {
    key: string;
    labelKey: string;
    href: string;
    count: number;
    active: boolean;
  }[] = [
    { key: "all", labelKey: "deals.all", href: "/deals", count: counts.all ?? 0, active: !stage },
    ...STAGES.map((s) => ({
      key: s,
      labelKey: badgeMessageKey(s),
      href: `/deals?stage=${s}`,
      count: counts[s] ?? 0,
      active: stage === s,
    })),
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/*
        P1. The state line keeps its second clause. It reads as a description
        and the pattern says a state line should not be one — but "stage is
        computed from the documents" is LAW 1 stated where the number is, and
        removing it to satisfy the shape of a header would be dropping the one
        sentence that explains why nobody can set a stage by hand.
      */}
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("nav.deals") }]}
        title={t("nav.deals")}
        state={
          <>
            {t("deals.openCount", { n: rows.filter((r) => r.open).length })} ·{" "}
            {t("deals.stageIsDerived")}
          </>
        }
        actions={
          <Link href="/deals/new">
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />}>
              {t("deals.newDeal")}
            </Button>
          </Link>
        }
      />

      <BulkResult binned={binned} refused={refused} more={more} />

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-4 py-2.5 md:px-7">
        <span className="me-1 text-micro uppercase tracking-wide text-muted">
          {t("deals.stageDerivedLabel")}
        </span>
        {chips.map((chip) => (
          <Link
            key={chip.key}
            href={chip.href}
            aria-current={chip.active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              chip.active
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(chip.labelKey)}
            <span className={chip.active ? "text-surface/70" : "text-muted"}>{chip.count}</span>
          </Link>
        ))}
      </div>

      <DealsList
        rows={listRows}
        total={total}
        // V2 — both halves bound to the locale here, so the client component
        // never has to know one. The description is asked when the
        // confirmation opens; the discard is the same domain call the record's
        // own page makes, and refuses on the same rule.
        describeDiscard={describeDealDiscard.bind(null, locale)}
        discard={discardDealFromListAction.bind(null, locale)}
        previewBulk={previewBulkDelete.bind(null, locale, "deal")}
        runBulk={runBulkDelete.bind(null, locale, "deal", "/deals")}
      />
    </main>
  );
}
