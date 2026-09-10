import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatMoney } from "@/domain/money";
import { balanceOf } from "@/domain/money/ageing";
import { owings } from "@/domain/money/store";
import { gather } from "@/domain/today/gather";
import type { ItemKind } from "@/domain/today/list";
import { MOVABILITY, startOfDay, week, weekNumbers } from "@/domain/today/week";
import { Link } from "@/i18n/navigation";

/**
 * Screen 63 — Week ahead.
 *
 * "Everything on this page also appears on Today when its day comes. This view
 * exists so you can see a crowded Thursday on Monday, not so you have a second
 * list to manage."
 *
 * That is a constraint, not a caption: this page calls the same `gather()`
 * screen 55 does and only lays the result out across seven days. A separate
 * feed would drift the first week somebody added an item kind to one and not
 * the other, and two pages would disagree about Thursday with neither
 * obviously wrong.
 */
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

const KIND_TONE: Record<ItemKind, BadgeTone> = {
  tenderDeadline: "critical",
  complianceExpiry: "critical",
  unpaidChase: "warning",
  uninvoiced: "warning",
  unsignedDelivery: "accent",
  awaitingReply: "accent",
  missingIdentifier: "neutral",
  approval: "neutral",
  note: "neutral",
};

const MOVE_TONE = {
  fixed: "critical",
  byAgreement: "warning",
  automatic: "good",
  yours: "good",
} as const;

export default async function WeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const now = new Date();
  const start = from ? startOfDay(new Date(`${from}T00:00:00Z`)) : startOfDay(now);

  const items = await gather(now);
  const view = week(items, start, now);

  const ledger = await owings();
  const dueThisWeek = ledger
    .filter((row) => {
      if (!row.dueOn) return false;
      const at = startOfDay(row.dueOn).getTime();
      return at >= view.from.getTime() && at <= view.to.getTime() + DAY - 1;
    })
    .map((row) => balanceOf(row));
  const numbers = weekNumbers({ items: view.days.flatMap((d) => d.items), dueThisWeek });

  const money = (amount: string) => formatMoney(amount, { locale, currency: "DZD" });
  const weekday = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    weekday: "short",
    day: "numeric",
  });
  const range = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "numeric",
    month: "long",
  });

  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const prev = iso(new Date(view.from.getTime() - 7 * DAY));
  const next = iso(new Date(view.from.getTime() + 7 * DAY));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">{t("week.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {range.format(view.from)} – {range.format(view.to)} ·{" "}
            {t("week.summary", {
              deadlines: numbers.deadlines,
              deliveries: numbers.deliveries,
              chases: numbers.chases,
            })}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link
            href={`/week?from=${prev}`}
            className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-tiny text-secondary hover:bg-plane"
          >
            {t("week.previous")}
          </Link>
          <Link
            href="/week"
            className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-tiny text-secondary hover:bg-plane"
          >
            {t("week.thisWeek")}
          </Link>
          <Link
            href={`/week?from=${next}`}
            className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-tiny text-secondary hover:bg-plane"
          >
            {t("week.next")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-4 py-5 md:grid-cols-7 md:px-7">
        {view.days.map((day) => (
          <div
            key={day.date.toISOString()}
            className={`min-h-[180px] rounded-[var(--radius-card)] border p-3 ${
              day.isToday ? "border-ink bg-ink text-on-ink" : "border-line bg-surface"
            }`}
          >
            <p
              className={`text-tiny font-semibold capitalize ${day.isToday ? "text-on-ink" : "text-ink"}`}
            >
              {weekday.format(day.date)}
            </p>
            <p className={`text-micro ${day.isToday ? "text-on-ink opacity-70" : "text-muted"}`}>
              {day.isToday
                ? t("week.today")
                : day.items.length === 0
                  ? t("week.nothing")
                  : t("week.nItems", { n: day.items.length })}
            </p>

            <ul className="mt-2.5 flex flex-col gap-1.5">
              {day.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="block rounded-[var(--radius-control)] border border-line-subtle bg-surface px-2 py-1.5 text-micro leading-snug text-ink hover:bg-plane"
                  >
                    <span className="line-clamp-2">{item.title}</span>
                    <span className="mt-1 block">
                      <Badge tone={KIND_TONE[item.kind]}>{t(`week.kind.${item.kind}`)}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("week.fixedOrMoves")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(
                ["tenderDeadline", "complianceExpiry", "unsignedDelivery", "unpaidChase"] as const
              ).map((kind) => (
                <div key={kind} className="flex items-baseline gap-3">
                  <dt className="min-w-0 text-secondary">{t(`week.kind.${kind}`)}</dt>
                  <dd className="ms-auto shrink-0">
                    <Badge tone={MOVE_TONE[MOVABILITY[kind]]}>
                      {t(`week.move.${MOVABILITY[kind]}`)}
                    </Badge>
                  </dd>
                </div>
              ))}
            </dl>
            {/*
              A property of the KIND, not of one item. A client's deadline is
              fixed because a client set it, and no amount of wishing about one
              particular tender changes that.
            */}
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("week.movabilityNote")}</p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("week.quietDays")}</h2>
              <span className="ms-auto text-micro text-muted">{t("week.useThem")}</span>
            </div>
            {view.quiet.length === 0 ? (
              <p className="mt-3 text-tiny text-muted">{t("week.noQuietDays")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-tiny">
                {view.quiet.map((day) => (
                  <li key={day.date.toISOString()} className="flex items-baseline gap-3">
                    <span className="capitalize text-secondary">{weekday.format(day.date)}</span>
                    <span className="ms-auto">
                      <Badge tone="good">{t("week.nothingScheduled")}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {view.busiest ? (
              <p className="mt-3 text-micro leading-relaxed text-secondary">
                {t("week.busiestDay", {
                  n: view.busiestShare,
                  total: view.total,
                  day: weekday.format(view.busiest.date),
                })}
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("week.inNumbers")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("week.moneyDueIn")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{money(numbers.dueIn)}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("week.deadlines")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{numbers.deadlines}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("week.deliveriesToProve")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{numbers.deliveries}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("week.chasesDue")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{numbers.chases}</dd>
              </div>
            </dl>
            {/*
              The frame prints "Money at risk if missed" beside the deadlines.
              An enquiry has no value until somebody has priced it, and most of
              these have not been — a figure meaning "the ones we happen to have
              priced" looks complete and is not.
            */}
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("week.noRiskFigure")}</p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("week.nothingHidden")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {t("week.nothingHiddenBody")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
