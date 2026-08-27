import { eq, sql } from "drizzle-orm";
import { ArrowDownLeft, ArrowUpRight, Cog, PenLine } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { party } from "@/db/schema/party";
import { factsFor } from "@/domain/deal/deal";
import { badgeMessageKey, stageOf } from "@/domain/deal/stage";
import { byDay, countSides, type EventSide, lastMove } from "@/domain/timeline/events";
import { timelineFor } from "@/domain/timeline/gather";
import { Link } from "@/i18n/navigation";
import { addNoteAction } from "./actions";

/**
 * Screen 56 — the deal timeline. "Everything about it is on this page."
 *
 * There is no event table. Almost every row is read from a record that already
 * exists — a message, a quote, a document, an audit entry — and writing a
 * second copy of each would give two versions of every fact with no way to tell
 * which one happened on the day they disagree.
 *
 * The exception is a note or a logged call. Nothing in the system saw those.
 */
export const dynamic = "force-dynamic";

const SIDE_ICON = {
  in: ArrowDownLeft,
  out: ArrowUpRight,
  noted: PenLine,
  system: Cog,
} as const;

const SIDE_TONE: Record<EventSide, BadgeTone> = {
  in: "accent",
  out: "good",
  noted: "neutral",
  system: "neutral",
};

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ noted?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { noted, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [row] = await db
    .select({
      id: deal.id,
      ref: deal.ref,
      subject: deal.subject,
      clientReference: deal.clientReference,
      deadlineAt: deal.deadlineAt,
      submissionMethod: deal.submissionMethod,
      currency: deal.currency,
      decision: deal.decision,
      lostAt: deal.lostAt,
      lineCount: sql<number>`(
        select count(*) from deal_line dl where dl.deal_id = ${deal.id}
      )::int`,
      clientName: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(deal)
    .leftJoin(party, eq(party.id, deal.partyId))
    .where(eq(deal.id, id))
    .limit(1);
  if (!row) notFound();

  const events = await timelineFor(id);
  const days = byDay(events);
  const counts = countSides(events);
  const now = new Date();
  const move = lastMove(events, now);

  // `factsFor` counts across many deals at once, and the three fields it does
  // not count live on the deal row itself. Assembled here rather than adding a
  // single-deal variant that would drift from the list's version.
  const counted = (await factsFor([id])).get(id);
  const stage = stageOf({
    suppliersAsked: counted?.suppliersAsked ?? 0,
    offersIssued: counted?.offersIssued ?? 0,
    ordersReceived: counted?.ordersReceived ?? 0,
    invoicesIssued: counted?.invoicesIssued ?? 0,
    // The column is text; `stageOf` only cares whether a decision was recorded
    // at all, so an unrecognised value is still a decision and is passed as one
    // rather than being narrowed away into null.
    decision: row.decision === "no_bid" ? "no_bid" : row.decision ? "pursue" : null,
    lostAt: row.lostAt,
    lineCount: row.lineCount,
  });

  const stamp = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayLabel = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {row.ref} — {row.subject}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {[row.clientName, row.clientReference].filter(Boolean).join(" · ")} ·{" "}
            {t("timeline.everythingHere")}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/deals/${id}`}
            className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-tiny text-secondary hover:bg-plane"
          >
            {t("timeline.backToDeal")}
          </Link>
        </div>
      </div>

      {noted ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          {t("timeline.noted")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`timeline.error.${error}`) ? t(`timeline.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("timeline.everythingThatHappened")}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {t("timeline.nEvents", { n: counts.total })} · {t("timeline.newestFirst")}
              </span>
            </div>

            {days.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("timeline.nothingYet")}</p>
            ) : (
              <div className="flex flex-col">
                {days.map((day) => (
                  <div key={day.date.toISOString()}>
                    <p className="border-b border-line-subtle bg-plane px-5 py-1.5 text-micro capitalize text-muted">
                      {dayLabel.format(day.date)}
                    </p>
                    <ul className="flex flex-col">
                      {day.events.map((event) => {
                        const Icon = SIDE_ICON[event.side];
                        return (
                          <li
                            key={event.id}
                            className="flex gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
                          >
                            <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2">
                                <span className="text-tiny font-medium text-ink">
                                  {t.has(`timeline.what.${event.what}`)
                                    ? t(`timeline.what.${event.what}`)
                                    : event.what}
                                </span>
                                <Badge tone={SIDE_TONE[event.side]}>
                                  {t(`timeline.side.${event.side}`)}
                                </Badge>
                              </p>
                              <p className="mt-0.5 truncate text-tiny text-secondary">
                                {event.title}
                              </p>
                              {event.body ? (
                                // Verbatim. A summary of what a client wrote is
                                // somebody's reading of it, not what they said.
                                <p className="mt-1 line-clamp-3 text-micro leading-relaxed text-muted">
                                  {event.body}
                                </p>
                              ) : null}
                              <p className="mt-1 flex flex-wrap items-center gap-2 text-micro text-muted">
                                <span>{event.actor ?? t("timeline.system")}</span>
                                <span>·</span>
                                <span className="tabular-nums">{stamp.format(event.at)}</span>
                                {event.chips.map((chip) => (
                                  <span
                                    key={chip}
                                    className="rounded-[var(--radius-pill)] bg-chip px-1.5 py-0.5 font-mono"
                                  >
                                    {chip}
                                  </span>
                                ))}
                              </p>
                            </div>
                            {event.href ? (
                              <Link
                                href={event.href}
                                className="shrink-0 self-center text-micro text-accent-ink hover:underline"
                              >
                                {t("timeline.open")}
                              </Link>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("timeline.writeItDown")}</h2>
              <span className="ms-auto text-micro text-muted">{t("timeline.onlyRecord")}</span>
            </div>

            <form
              action={addNoteAction.bind(null, locale, id)}
              className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-4"
            >
              <label>
                <span className="text-micro text-secondary">{t("timeline.kind")}</span>
                <select name="kind" defaultValue="note" className={`${INPUT} mt-1`}>
                  {(["note", "call", "meeting", "visit"] as const).map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`timeline.what.${kind}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-micro text-secondary">{t("timeline.happenedOn")}</span>
                {/* Defaults to today and is editable: a call made in the car and
                    written up that evening happened in the car. */}
                <input
                  type="date"
                  name="happenedOn"
                  defaultValue={today}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("timeline.remindMe")}</span>
                <input type="date" name="dueAt" className={`${INPUT} mt-1`} />
              </label>
              <div className="flex items-end">
                <p className="text-micro leading-snug text-muted">{t("timeline.dueGoesToToday")}</p>
              </div>

              <label className="sm:col-span-4">
                <span className="text-micro text-secondary">{t("timeline.whatWasSaid")}</span>
                <textarea name="body" rows={3} className={`${INPUT} mt-1 h-auto py-2`} />
              </label>

              <div className="sm:col-span-4 flex flex-wrap items-center gap-3">
                <p className="text-micro text-muted">{t("timeline.verbatim")}</p>
                <div className="ms-auto flex items-center gap-2">
                  <Button variant="secondary" disabledReason={t("timeline.replyLater")}>
                    {t("timeline.reply")}
                  </Button>
                  <Button variant="secondary" disabledReason={t("timeline.filesLater")}>
                    {t("timeline.attach")}
                  </Button>
                  <Button type="submit" variant="primary">
                    {t("timeline.save")}
                  </Button>
                </div>
              </div>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("timeline.thisDeal")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("timeline.client")}>
                <span className="text-ink">{row.clientName ?? "—"}</span>
              </Row>
              <Row label={t("timeline.reference")}>
                {/* Verbatim, as the client wrote it. */}
                <span className="font-mono text-micro text-ink">{row.clientReference ?? "—"}</span>
              </Row>
              <Row label={t("timeline.stage")}>
                {/*
                  Derived from the facts, never stored. `badgeMessageKey` knows
                  which prefix each value lives under - the six stages are named
                  where screen 05 named them, the three outcomes are not - and
                  one stage should not have two names. The `t.has` guard this
                  replaced was correct here and absent everywhere else, which is
                  how three screens shipped a 500.
                */}
                <Badge tone="accent">{t(badgeMessageKey(stage))}</Badge>
              </Row>
              <Row label={t("timeline.deadline")}>
                {row.deadlineAt ? (
                  <Badge tone={row.deadlineAt < now ? "neutral" : "critical"}>
                    {dayLabel.format(row.deadlineAt)}
                  </Badge>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Row>
              <Row label={t("timeline.submission")}>
                <span className="text-ink">{row.submissionMethod}</span>
              </Row>
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("timeline.whoMovedLast")}</h2>
            {move ? (
              <>
                <p className="mt-2 text-tiny leading-relaxed text-ink">
                  {t(`timeline.lastMove.${move.side}`, { n: move.days })}
                </p>
                {/*
                  The single most useful thing a timeline can say at a glance,
                  and the reason every row carries a side. Notes and system
                  events are skipped — a folder being created is not somebody's
                  move, and neither is writing a note to yourself.
                */}
                <p className="mt-2 text-micro leading-relaxed text-muted">
                  {t("timeline.whoMovedLastNote")}
                </p>
              </>
            ) : (
              <p className="mt-2 text-tiny text-muted">{t("timeline.nobodyHasMoved")}</p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("timeline.whereItComesFrom")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(["in", "out", "noted", "system"] as const).map((side) => (
                <div key={side} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`timeline.side.${side}`)}</dt>
                  <dd className="ms-auto tabular-nums text-ink">{counts[side]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("timeline.noEventTable")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="min-w-0 text-secondary">{label}</dt>
      <dd className="ms-auto shrink-0">{children}</dd>
    </div>
  );
}
