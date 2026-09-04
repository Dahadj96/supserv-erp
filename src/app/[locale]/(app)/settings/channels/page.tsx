import { CircleAlert } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { mailboxReachable } from "@/capture/mail/graph";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChannelStatus,
  ensureIntakeConfigured,
  listChannels,
  listRules,
} from "@/domain/intake/channels";
import { SAFETY_RAILS } from "@/domain/intake/rails";

/**
 * Screen 38 — Intake channels.
 *
 * The screen exists for its red banner: "The portal and paper channels have no
 * path into the system. Anything arriving that way exists only in somebody's
 * memory until it is typed in by hand."
 *
 * So the six channels that do not work are listed as prominently as the three
 * that do, with the same columns. A settings page that only showed what was
 * connected would make the gap invisible, which is how the gap survives.
 */
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ChannelStatus, BadgeTone> = {
  live: "good",
  not_connected: "critical",
  not_built: "warning",
  considered: "neutral",
};

const MODE_TONE: Record<string, BadgeTone> = {
  auto: "good",
  suggest: "warning",
  manual: "neutral",
};

export default async function ChannelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const format = await getFormatter();

  await ensureIntakeConfigured();
  const [channels, rules, mailbox] = await Promise.all([
    listChannels(),
    listRules(),
    mailboxReachable(),
  ]);

  const live = channels.filter((c) => c.status === "live").length;
  const losing = channels.filter(
    (c) => c.status === "not_connected" || c.status === "not_built",
  ).length;

  const when = (at: Date | null) =>
    at
      ? format.dateTime(at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "—";

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("intake.channelsTitle")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("intake.channelsSubtitle", {
              total: channels.length,
              live,
              losing,
            })}
          </p>
        </div>
      </div>

      {/* The mailbox is the one live channel that can silently stop working, and
          the reason is always the same: the access policy. Say it here. */}
      {!mailbox.ok ? (
        <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <div>
            <p className="text-tiny font-semibold text-critical-ink">
              {t("intake.mailboxNotReading")}
            </p>
            <p className="mt-1 max-w-[860px] text-micro leading-relaxed text-critical-ink">
              {mailbox.reason}
            </p>
          </div>
        </div>
      ) : null}

      {losing > 0 ? (
        <div className="mx-4 md:mx-7 mt-5 flex items-center gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">{t("intake.losingRecords")}</p>
        </div>
      ) : null}

      <div className="px-4 md:px-7 py-6">
        <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-tiny">
          <thead>
            <tr className="border-b border-line-subtle text-micro text-muted">
              <th className="px-4 py-2.5 text-start font-medium">{t("intake.channel")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("intake.accepts")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("intake.creates")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("intake.autoClassify")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("intake.thirtyDays")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("intake.lastReceived")}</th>
              <th className="px-4 py-2.5 text-start font-medium">{t("intake.status")}</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.key} className="border-b border-line-subtle last:border-0">
                <td className="px-4 py-2.5 text-ink">{t(`intake.channelName.${channel.key}`)}</td>
                <td className="px-4 py-2.5 text-secondary">
                  {t(`intake.channelAccepts.${channel.key}`)}
                </td>
                <td className="px-4 py-2.5 text-secondary">
                  {t(`intake.channelCreates.${channel.key}`)}
                </td>
                <td className="px-4 py-2.5">
                  {channel.autoClassify ? (
                    <Badge tone="good">{t("intake.on")}</Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-end text-ink">{channel.last30Days}</td>
                <td className="px-4 py-2.5 text-secondary">{when(channel.lastReceivedAt)}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS_TONE[channel.status]}>
                    {t(`intake.statusValue.${channel.status}`)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5">
          <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("intake.routingRules")}</h2>
              <span className="ms-auto text-micro text-muted">{t("intake.firstMatchWins")}</span>
            </div>
            <ol>
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-start gap-3 border-b border-line-subtle py-2.5 last:border-0"
                >
                  <span className="w-4 shrink-0 text-micro text-muted">{rule.position}</span>
                  <div className="min-w-0">
                    <p className="text-tiny text-ink">{t(rule.labelKey)}</p>
                    <p className="mt-0.5 text-micro text-muted">→ {t(rule.actionKey)}</p>
                  </div>
                  <span className="ms-auto shrink-0">
                    <Badge tone={MODE_TONE[rule.mode] ?? "neutral"}>
                      {t(`intake.mode.${rule.mode}`)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="small"
                disabledReason={t("rules.comingInPhase", { phase: 7 })}
              >
                {t("intake.addRule")}
              </Button>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("intake.safetyRails")}</h2>
              <span className="ms-auto text-micro text-muted">{t("intake.sameAsAssistant")}</span>
            </div>
            <dl className="mt-3">
              {SAFETY_RAILS.map((rail) => (
                <div
                  key={rail.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`intake.rail.${rail.key}`)}</dt>
                  <dd className="ms-auto shrink-0">
                    <Badge tone="good">{t(`intake.railState.${rail.state}`)}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("intake.railsNote")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
