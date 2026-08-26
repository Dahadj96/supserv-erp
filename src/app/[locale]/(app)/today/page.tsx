import { Check, CircleCheck } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { doneToday, gather } from "@/domain/today/gather";
import { type Band, today as buildToday, laterThisWeek } from "@/domain/today/list";
import { Link } from "@/i18n/navigation";

/**
 * Screen 55 — Today.
 *
 * The frame's own explanation, in the corner card, is the whole design:
 *
 *   "Ordered by what it costs you to ignore it, not by when it arrived. A
 *    deadline that expires tomorrow outranks an email from this morning.
 *    Anything waiting on somebody else is kept off this page on purpose."
 *
 * Nothing on this page is stored. There is no task table: every row is derived
 * from a fact another screen already holds, so when the payment lands or the
 * signed copy comes back, the row is simply gone next time — with nothing to
 * tick and nothing to clean up.
 */
export const dynamic = "force-dynamic";

const BAND_TONE: Record<Band, { border: string; bg: string; ink: string; badge: BadgeTone }> = {
  nowOrLost: {
    border: "border-critical",
    bg: "bg-critical-bg",
    ink: "text-critical-ink",
    badge: "critical",
  },
  money: {
    border: "border-warning",
    bg: "bg-warning-bg",
    ink: "text-warning-ink",
    badge: "warning",
  },
  waitingOnYou: {
    border: "border-accent",
    bg: "bg-accent-bg",
    ink: "text-accent-ink",
    badge: "accent",
  },
  quick: { border: "border-line", bg: "bg-plane", ink: "text-secondary", badge: "neutral" },
};

export default async function TodayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const now = new Date();
  const items = await gather(now);
  const day = buildToday(items, now);
  const later = laterThisWeek(items, now);
  const done = await doneToday(now, session.userId);

  const dateLine = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const clock = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayShort = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold capitalize text-ink">{dateLine}</h1>
          <p className="mt-1 text-tiny text-muted">
            {day.clear
              ? t("today.nothingNeedsYou")
              : t("today.headline", { n: day.count, minutes: day.minutes })}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link
            href="/capture"
            className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-tiny text-secondary hover:bg-plane"
          >
            {t("today.quickCapture")}
          </Link>
        </div>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-4 md:col-span-2">
          {day.bands.map((group) => {
            const tone = BAND_TONE[group.band];
            return (
              <section
                key={group.band}
                className={`overflow-hidden rounded-[var(--radius-card)] border ${tone.border} bg-surface`}
              >
                <div className={`flex flex-wrap items-baseline gap-x-3 ${tone.bg} px-5 py-3`}>
                  <h2 className={`text-tiny font-semibold ${tone.ink}`}>
                    {t(`today.band.${group.band}`)}
                  </h2>
                  <span className={`text-micro ${tone.ink} opacity-80`}>
                    {t(`today.bandWhy.${group.band}`)}
                  </span>
                  <span className={`ms-auto text-micro ${tone.ink} opacity-80`}>
                    {t("today.nAndMinutes", { n: group.items.length, minutes: group.minutes })}
                  </span>
                </div>

                <ul className="flex flex-col">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-5 py-3 first:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-tiny font-medium text-ink">{item.title}</p>
                        <p className="mt-0.5 truncate text-micro text-muted">
                          {item.detail}
                          {item.expiresAt
                            ? ` · ${dayShort.format(item.expiresAt)} ${clock.format(item.expiresAt)}`
                            : ""}
                        </p>
                      </div>
                      <Link
                        href={item.href}
                        className="shrink-0 rounded-[var(--radius-control)] bg-ink px-3 py-1.5 text-micro font-medium text-on-ink hover:opacity-90"
                      >
                        {t(`today.do.${item.action}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <section className="rounded-[var(--radius-card)] border border-good bg-good-bg px-5 py-6 text-center">
            <CircleCheck className="mx-auto size-5 text-good-ink" aria-hidden />
            <p className="mt-2 text-tiny font-semibold text-good-ink">
              {day.clear ? t("today.allClear") : t("today.thatIsEverything")}
            </p>
            {/*
              The closing line names what is NOT here and why. A page that
              silently omits work reads as a page that missed it; a page that
              says "12 things are on somebody else's desk" reads as a page that
              has thought about it.
            */}
            <p className="mx-auto mt-2 max-w-[520px] text-micro leading-relaxed text-good-ink opacity-90">
              {day.waitingOnOthers > 0
                ? t("today.waitingElsewhere", { n: day.waitingOnOthers })
                : t("today.nothingWaitingElsewhere")}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("today.doneToday")}</h2>
              <span className="ms-auto text-micro text-muted">{done.length}</span>
            </div>
            {done.length === 0 ? (
              <p className="mt-3 text-tiny text-muted">{t("today.nothingDoneYet")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {done.map((row) => (
                  <li
                    key={`${row.entity}-${row.at.toISOString()}`}
                    className="flex items-baseline gap-2.5 text-tiny"
                  >
                    <Check className="mt-px size-3.5 shrink-0 text-good-ink" aria-hidden />
                    <span className="min-w-0 flex-1 text-secondary">
                      {t.has(`today.did.${row.entity}.${row.action}`)
                        ? t(`today.did.${row.entity}.${row.action}`)
                        : `${row.entity} · ${row.action}`}
                    </span>
                    <span className="shrink-0 tabular-nums text-micro text-muted">
                      {clock.format(row.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {/* From the audit log, not from a checkbox. */}
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("today.doneFromLog")}</p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("today.laterThisWeek")}</h2>
              <span className="ms-auto text-micro text-muted">{t("today.notToday")}</span>
            </div>
            {later.length === 0 ? (
              <p className="mt-3 text-tiny text-muted">{t("today.nothingLater")}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 text-tiny">
                {later.map((row) => (
                  <li key={row.id} className="flex items-baseline gap-3">
                    <Link
                      href={row.href}
                      className="min-w-0 truncate text-secondary hover:underline"
                    >
                      {row.title}
                    </Link>
                    <span className="ms-auto shrink-0">
                      <Badge tone="accent">{dayShort.format(row.when)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("today.howItIsBuilt")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {t("today.howItIsBuiltBody")}
            </p>
            <p className="mt-2 text-micro leading-relaxed text-muted">{t("today.noTaskTable")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
