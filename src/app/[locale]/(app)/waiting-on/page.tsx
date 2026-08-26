import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { gatherWaiting } from "@/domain/waiting/gather";
import { neverAsked, QUIET_TOO_LONG, waitingOn } from "@/domain/waiting/list";
import { Link } from "@/i18n/navigation";

/**
 * Screen 58 — Waiting on.
 *
 * "Nothing on this page needs you today. It is here so that when someone goes
 * quiet, you find out before it costs you."
 *
 * The other half of screen 55. Today keeps everything that is somebody else's
 * move off the page on purpose; this is where those things live, sorted by how
 * long the silence has run. Nothing is red for being here — only for having
 * been quiet longer than its own kind of counterparty should be.
 */
export const dynamic = "force-dynamic";

export default async function WaitingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const now = new Date();
  const view = waitingOn(await gatherWaiting(now), now);

  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">{t("waiting.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("waiting.subtitle", { n: view.total, overdue: view.overdue })}
          </p>
        </div>
      </div>

      <div className="mx-4 mt-4 flex flex-wrap items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3 md:mx-7">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="min-w-0 flex-1 text-tiny leading-relaxed text-accent-ink">
          {t("waiting.nothingNeedsYou")}
        </p>
      </div>

      <div className="flex flex-col gap-5 px-4 py-5 pb-8 md:px-7">
        {view.groups.length === 0 ? (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-6">
            <p className="text-tiny text-ink">{t("waiting.nobodyOwesAnything")}</p>
          </section>
        ) : null}

        {view.groups.map((group) => (
          <section
            key={group.group}
            className="rounded-[var(--radius-card)] border border-line bg-surface"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t(`waiting.group.${group.group}`)}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {t(`waiting.groupWhat.${group.group}`)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">{t("waiting.who")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("waiting.what")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("waiting.for")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("waiting.since")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("waiting.quietFor")}</th>
                    <th className="py-2 pe-5 text-end font-medium">{t("waiting.chased")}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.id} className="border-t border-line-subtle">
                      <td className="py-2.5 ps-5 text-ink">{row.who}</td>
                      <td className="max-w-[280px] truncate py-2.5 pe-4 text-secondary">
                        {row.what}
                      </td>
                      <td className="py-2.5 pe-4">
                        {row.forHref && row.forRef ? (
                          <Link
                            href={row.forHref}
                            className="font-mono text-micro text-accent-ink hover:underline"
                          >
                            {row.forRef}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pe-4 text-muted">
                        {row.askedAt ? day.format(row.askedAt) : "—"}
                      </td>
                      <td className="py-2.5 pe-4">
                        {row.broken ? (
                          // A bounced address is not a slow supplier. Chasing it
                          // forever is how one quietly drops off the list.
                          <Badge tone="serious">{t("waiting.broken")}</Badge>
                        ) : neverAsked(row) ? (
                          <span className="text-micro text-muted">{t("waiting.notRequested")}</span>
                        ) : (
                          <Badge tone={row.tooLong ? "critical" : "good"}>
                            {t("waiting.nDays", { n: row.quiet ?? 0 })}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 pe-5 text-end tabular-nums text-secondary">
                        {row.chased > 0 ? t("waiting.nTimes", { n: row.chased }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("waiting.thresholdNote", { n: QUIET_TOO_LONG[group.group] })}
            </p>
          </section>
        ))}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("waiting.whatIsMissing")}</h2>
          {/*
            The frame draws a third group — authorities and banks. A caution de
            soumission and a CASNOS attestation are compliance documents and
            that module is phase 7, so no table knows a bank guarantee was ever
            requested. An empty group would read as "nothing outstanding", which
            is the opposite of what is true.
          */}
          <p className="mt-2 text-micro leading-relaxed text-secondary">
            {t("waiting.authoritiesLater")}
          </p>
        </section>
      </div>
    </main>
  );
}
