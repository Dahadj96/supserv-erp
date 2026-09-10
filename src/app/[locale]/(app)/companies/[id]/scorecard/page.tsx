import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { supplierScorecard } from "@/domain/scorecard/store";
import type { Outcome } from "@/domain/scorecard/supplier";
import { Link } from "@/i18n/navigation";

/**
 * Screen 23 — the supplier scorecard.
 *
 * Not one new column. Every figure here is arithmetic over rows that already
 * exist, which is the whole argument for a scorecard rather than a `rating`
 * field somebody sets once: a supplier who stopped replying in March shows it
 * here in April, with nobody having gone back to edit anything.
 *
 * The reply rate excludes bounced messages. Screen 67 makes that distinction
 * and this screen keeps it — ten bounces to a dead address would otherwise read
 * as a nine per cent reply rate and condemn a supplier for our own stale
 * contact record.
 */
export const dynamic = "force-dynamic";

const OUTCOME_TONE: Record<Outcome, "good" | "warning" | "critical" | "neutral"> = {
  offerWon: "good",
  usedInOffer: "good",
  offerLost: "warning",
  notBestPrice: "warning",
  weNoBid: "warning",
  waiting: "neutral",
  declined: "neutral",
  noReply: "critical",
  bounced: "critical",
};

export default async function ScorecardPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const view = await supplierScorecard(id);
  if (!view) notFound();

  const format = await getFormatter({ locale });
  const number = (value: number | string) =>
    format.number(Number(value), { maximumFractionDigits: 0 });
  const day = (value: Date | null) =>
    value ? format.dateTime(value, { day: "numeric", month: "short", year: "numeric" }) : "—";

  const { card, position } = view;

  const cards = [
    {
      key: "replyRate",
      value: card.replyRate === null ? "—" : `${card.replyRate}%`,
      note: t("scorecard.ofRequests", { replied: card.replied, asked: card.asked }),
      tone: card.replyRate !== null && card.replyRate >= 50 ? "good" : "warning",
    },
    {
      key: "turnaround",
      value: card.turnaroundDays === null ? "—" : t("scorecard.days", { n: card.turnaroundDays }),
      note: t("scorecard.fromAsked"),
      tone: "neutral",
    },
    {
      key: "winRate",
      value: card.winRate === null ? "—" : `${card.winRate}%`,
      note: t("scorecard.wonWith", { n: card.wonWithTheirPrice }),
      tone: "good",
    },
    {
      key: "position",
      value:
        position.compared === 0
          ? "—"
          : t("scorecard.bestOn", { best: position.best, of: position.compared }),
      note: t("scorecard.vsOthers"),
      tone: "neutral",
    },
    {
      key: "lastAsked",
      value: day(card.lastAskedAt),
      note: card.lastAskedRef ?? "—",
      tone: "neutral",
    },
  ] as const;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{view.name}</h1>
        <p className="mt-1 text-tiny text-muted">
          <Link href={`/companies/${id}`} className="text-accent-ink hover:underline">
            {t("scorecard.backToCompany")}
          </Link>
          {card.bounced > 0 ? ` · ${t("scorecard.bouncedNote", { n: card.bounced })}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 px-4 md:px-7 pt-5">
        {cards.map((one) => (
          <div
            key={one.key}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
          >
            <p className="text-micro text-muted">{t(`scorecard.card.${one.key}`)}</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums text-ink">{one.value}</p>
            <p className="mt-1.5 text-micro text-secondary">{one.note}</p>
          </div>
        ))}
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("scorecard.prices.title")}</h2>
              <span className="ms-auto text-micro text-muted">{t("scorecard.prices.how")}</span>
            </div>

            {view.prices.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("scorecard.prices.none")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">
                      {t("scorecard.column.reference")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("scorecard.column.designation")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("scorecard.column.lastQuoted")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("scorecard.column.unitPrice")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("scorecard.column.previous")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("scorecard.column.change")}
                    </th>
                    <th className="px-5 py-2 text-end font-medium">
                      {t("scorecard.column.times")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.prices.slice(0, 30).map((row) => (
                    <tr
                      key={`${row.reference}-${row.designation}`}
                      className="border-b border-line-subtle last:border-0"
                    >
                      <td className="px-5 py-2.5 font-mono text-micro text-ink">
                        {row.reference ?? "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 text-secondary">
                        {row.designation ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{day(row.lastQuotedAt)}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-ink">
                        {number(row.unitPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-muted">
                        {row.previous === null ? "—" : number(row.previous)}
                      </td>
                      <td className="px-3 py-2.5">
                        {row.changePct === null ? (
                          <span className="text-micro text-muted">—</span>
                        ) : (
                          <Badge
                            tone={
                              row.changePct > 0 ? "warning" : row.changePct < 0 ? "good" : "neutral"
                            }
                          >
                            {row.changePct > 0 ? "+" : ""}
                            {row.changePct}%
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-end tabular-nums text-secondary">
                        {row.timesQuoted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("scorecard.requests.title")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("scorecard.requests.count", { n: view.requests.length })}
              </span>
            </div>

            {view.requests.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("scorecard.requests.none")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">
                      {t("scorecard.column.deal")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("scorecard.column.items")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("scorecard.column.asked")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("scorecard.column.replied")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("scorecard.column.turnaround")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium">
                      {t("scorecard.column.outcome")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.requests.slice(0, 12).map((row) => (
                    <tr key={row.responseId} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-2.5 text-ink">{row.dealRef ?? row.requestRef}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-secondary">
                        {row.lines}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{day(row.askedAt)}</td>
                      <td className="px-3 py-2.5 text-secondary">{day(row.repliedAt)}</td>
                      <td className="px-3 py-2.5 text-secondary">
                        {row.turnaroundDays === null
                          ? "—"
                          : t("scorecard.days", { n: row.turnaroundDays })}
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={OUTCOME_TONE[row.outcome]}>
                          {t(`scorecard.outcome.${row.outcome}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("scorecard.peers.title")}</h2>
              <span className="ms-auto text-micro text-muted">{t("scorecard.peers.how")}</span>
            </div>
            <ul className="mt-3 flex flex-col gap-2.5">
              {view.peers.map((peer) => (
                <li key={peer.partyId}>
                  <div className="flex items-baseline gap-3">
                    <span
                      className={`text-tiny ${peer.partyId === id ? "font-medium text-ink" : "text-secondary"}`}
                    >
                      {peer.name}
                    </span>
                    <span className="ms-auto text-micro tabular-nums text-muted">
                      {peer.replyRate === null
                        ? t("scorecard.neverAsked")
                        : t("scorecard.replyPct", { pct: peer.replyRate })}
                    </span>
                  </div>
                  <span
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line"
                    aria-hidden
                  >
                    <span
                      className={`block h-full rounded-full ${
                        (peer.replyRate ?? 0) >= 50
                          ? "bg-good"
                          : (peer.replyRate ?? 0) >= 25
                            ? "bg-warning"
                            : "bg-critical"
                      }`}
                      style={{ width: `${peer.replyRate ?? 0}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("scorecard.nothingStored")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("scorecard.nothingStoredWhy")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
