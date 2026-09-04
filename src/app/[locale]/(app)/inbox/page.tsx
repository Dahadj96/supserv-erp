import { CircleAlert, CircleHelp } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import {
  expiringSoon,
  INBOX_FACETS,
  inboxCounts,
  isInboxFacet,
  listInbox,
  needsAHuman,
} from "@/domain/intake/inbox";
import { Link } from "@/i18n/navigation";
import { createContactFrom, dismissMessage, setClassification, syncMailbox } from "./actions";
import { InboxRowView } from "./inbox-row";

/**
 * Screen 02 — the Inbox.
 *
 * docs/PLAN.md's phase 2 test is "none of the twelve expire unread", so the
 * deadline column sorts first and the banner names the two that are closest
 * rather than counting them. A number tells you there is a problem; a name
 * tells you which one.
 */
export const dynamic = "force-dynamic";

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ facet?: string; unread?: string; error?: string; synced?: string }>;
}) {
  const { locale } = await params;
  const { facet: raw, unread, error, synced } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();
  const format = await getFormatter();

  // Checked before anything is read, not after. The queries below fetch every
  // message in the mailbox; running them and then hiding the result is not a
  // permission check, it is a rendering decision.
  const session = await getSession();
  if (!session?.role || !can(session.role, "inbox.view")) {
    return (
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.inbox")}</h1>
        </div>
        <div className="mx-4 md:mx-7 mt-5 flex max-w-[720px] items-start gap-3 rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3">
          <CircleHelp className="mt-px size-4 shrink-0 text-muted" aria-hidden />
          {/* Says which role would have it, because "no" without "who" sends
              somebody to ask the Gérant a question he cannot answer either. */}
          <p className="text-tiny leading-relaxed text-secondary">{t("inbox.notPermitted")}</p>
        </div>
      </main>
    );
  }

  const facet = isInboxFacet(raw) ? raw : "all";
  const unreadOnly = unread === "1";

  const [rows, counts, expiring, unsure] = await Promise.all([
    listInbox(facet, { unreadOnly }),
    inboxCounts(),
    expiringSoon(),
    needsAHuman(),
  ]);

  const formatDate = (d: Date) =>
    format.dateTime(d, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const href = (next: { facet?: string; unread?: boolean }) => {
    const f = next.facet ?? facet;
    const u = next.unread ?? unreadOnly;
    const parts = [f === "all" ? null : `facet=${f}`, u ? "unread=1" : null].filter(Boolean);
    return `/inbox${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.inbox")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("inbox.subtitle", { unread: counts.unread, expiring: counts.expiringSoon })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/settings/channels">
            <Button variant="secondary">{t("inbox.triageRules")}</Button>
          </Link>
          <form action={syncMailbox.bind(null, locale)}>
            <Button type="submit" variant="primary">
              {t("inbox.syncNow")}
            </Button>
          </form>
        </div>
      </div>

      {error ? (
        <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[860px] text-tiny leading-relaxed text-critical-ink">
            {t(`inbox.error.${error}`)}{" "}
            <Link href="/settings/channels" className="underline underline-offset-2">
              {t("inbox.seeChannels")}
            </Link>
          </p>
        </div>
      ) : null}

      {synced ? (
        <p className="mx-4 md:mx-7 mt-5 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("inbox.synced", { count: Number(synced) })}
        </p>
      ) : null}

      {expiring.length > 0 ? (
        <div className="mx-4 md:mx-7 mt-5 flex items-center gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">
            {t("inbox.expiringBanner", { count: counts.expiringSoon })}{" "}
            {expiring
              .map((e) =>
                t("inbox.expiringItem", {
                  what: e.partyName ?? e.subject ?? "—",
                  hours: Math.max(0, e.hoursLeft),
                }),
              )
              .join(" · ")}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 md:px-7 pt-5">
        {INBOX_FACETS.map((key) => {
          const active = key === facet;
          return (
            <Link
              key={key}
              href={href({ facet: key })}
              aria-current={active ? "true" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1 text-tiny transition-colors ${
                active
                  ? "bg-ink font-medium text-on-ink"
                  : "border border-line bg-surface text-secondary hover:bg-sunken"
              }`}
            >
              {t(`inbox.facet.${key}`)}
              <span className={active ? "text-on-ink/70" : "text-muted"}>{counts[key]}</span>
            </Link>
          );
        })}
        <div className="ms-auto">
          <Link
            href={href({ unread: !unreadOnly })}
            className={`rounded-[var(--radius-control)] border px-3 py-1 text-tiny transition-colors ${
              unreadOnly
                ? "border-ink bg-ink text-on-ink"
                : "border-line bg-surface text-secondary hover:bg-sunken"
            }`}
          >
            {t("inbox.unreadOnly")}
          </Link>
        </div>
      </div>

      <div className="px-4 md:px-7 py-6">
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
            <h2 className="text-lead font-semibold text-ink">{t("inbox.emptyTitle")}</h2>
            <p className="mx-auto mt-1.5 max-w-[480px] text-tiny leading-relaxed text-secondary">
              {t("inbox.emptyBody")}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-tiny">
            <thead>
              <tr className="border-b border-line-subtle text-micro text-muted">
                <th className="px-4 py-2.5 text-start font-medium">{t("inbox.from")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inbox.subject")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inbox.typeColumn")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inbox.deadline")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("inbox.received")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <InboxRowView key={row.id} locale={locale} row={row} formatDate={formatDate} />
              ))}
            </tbody>
          </table>
        )}

        {unsure.length > 0 ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="mb-2 flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("inbox.needsAHuman")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("inbox.nItems", { n: unsure.length })}
              </span>
            </div>
            <ul>
              {unsure.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-b border-line-subtle py-2.5 last:border-0"
                >
                  <CircleHelp className="size-4 shrink-0 text-serious" aria-hidden />
                  <p className="min-w-0 text-tiny text-secondary">
                    <span className="text-ink">{item.fromAddress ?? item.fromName}</span>
                    {item.subject ? ` — “${item.subject}”` : ""}
                    {" · "}
                    {item.downgraded && item.classifiedAs
                      ? t("inbox.notSureEnough", {
                          what: t(`inbox.type.${item.classifiedAs}`),
                          percent: Math.round((item.confidence ?? 0) * 100),
                        })
                      : t("inbox.noRuleMatched")}
                  </p>

                  <div className="ms-auto flex shrink-0 items-center gap-2">
                    {/* A person is certain by definition — accepting the guess
                        is a classification, not a confidence adjustment. */}
                    {item.downgraded && item.classifiedAs ? (
                      <form action={setClassification.bind(null, locale, item.id)}>
                        <input type="hidden" name="to" value={item.classifiedAs} />
                        <Button type="submit" variant="secondary" size="small">
                          {t("inbox.confirmAs", { what: t(`inbox.type.${item.classifiedAs}`) })}
                        </Button>
                      </form>
                    ) : null}

                    {item.partyId ? (
                      <form
                        action={createContactFrom.bind(null, locale, item.id)}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          name="job"
                          placeholder={t("inbox.jobPlaceholder")}
                          className="h-[28px] w-[130px] rounded-[var(--radius-control)] border border-line bg-surface px-2 text-micro outline-none focus:border-ink"
                        />
                        <Button type="submit" variant="secondary" size="small">
                          {t("inbox.addContactUnder", { company: item.partyName ?? "" })}
                        </Button>
                      </form>
                    ) : null}

                    <form action={dismissMessage.bind(null, locale, item.id)}>
                      <Button type="submit" variant="ghost" size="small">
                        {t("inbox.itIsNoise")}
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
