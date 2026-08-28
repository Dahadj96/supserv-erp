import { AlertTriangle, Ban, Circle, Clock, Wallet } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isNotifyFacet, NOTIFY_FACETS, type NotifyGroup } from "@/domain/notify/feed";
import { mutedKinds, notifications } from "@/domain/notify/store";
import { ITEM_KINDS, type ItemKind } from "@/domain/today/list";
import { Link } from "@/i18n/navigation";
import { markAllReadAction, markReadAction, toggleKindAction } from "./actions";

/**
 * Screen 33 — Notifications.
 *
 * Nothing on this page is stored except which of them you have read. Every
 * item is the same computed fact Today reads; see src/domain/notify/feed.ts
 * for why, and for the two chips the frame draws that are deliberately absent.
 */
export const dynamic = "force-dynamic";

const GROUP_ICON: Record<NotifyGroup, typeof Clock> = {
  blocking: AlertTriangle,
  money: Wallet,
  work: Circle,
};

const KIND_ICON: Partial<Record<ItemKind, typeof Clock>> = {
  tenderDeadline: Clock,
  complianceExpiry: AlertTriangle,
  missingIdentifier: Ban,
  unpaidChase: Wallet,
};

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ facet?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const t = await getTranslations();
  const query = await searchParams;
  const facet = isNotifyFacet(query.facet) ? query.facet : "all";

  const [view, muted] = await Promise.all([
    notifications(session.userId, facet),
    mutedKinds(session.userId),
  ]);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.notifications")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("notify.subtitle", { unread: view.unread })}
          </p>
        </div>
        <div className="ms-auto">
          <form action={markAllReadAction.bind(null, locale)}>
            <Button
              type="submit"
              variant="primary"
              disabledReason={view.unread === 0 ? t("notify.nothingUnread") : undefined}
            >
              {t("notify.markAllRead")}
            </Button>
          </form>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-7 py-2.5">
        {NOTIFY_FACETS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/notifications" : `/notifications?facet=${key}`}
            aria-current={facet === key ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              facet === key
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`notify.facet.${key}`)}
            <span className={facet === key ? "text-surface/70" : "text-muted"}>
              {view.facetCounts[key]}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          {view.groups.length === 0 ? (
            <p className="text-tiny text-muted">{t("notify.none")}</p>
          ) : (
            view.groups.map((group) => {
              const GroupIcon = GROUP_ICON[group.group];
              return (
                <section
                  key={group.group}
                  className="overflow-hidden rounded-[var(--radius-panel)] border border-line-subtle bg-surface"
                >
                  <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-2.5">
                    <GroupIcon className="size-3.5 text-muted" aria-hidden />
                    <h2 className="text-tiny font-semibold text-ink">
                      {t(`notify.group.${group.group}`)}
                    </h2>
                    <span className="ms-auto text-micro text-muted">
                      {t("notify.itemCount", { n: group.items.length })}
                    </span>
                  </div>

                  <ul>
                    {group.items.map((notification) => {
                      const KindIcon = KIND_ICON[notification.kind] ?? Circle;
                      return (
                        <li
                          key={notification.id}
                          className={`flex items-start gap-3 border-b border-line-subtle px-4 py-3 last:border-0 ${
                            notification.read ? "" : "bg-plane"
                          }`}
                        >
                          {/* Unread is a dot, not a colour on the text: the
                              text's colour already means urgency. */}
                          <span
                            aria-hidden
                            className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                              notification.read ? "bg-transparent" : "bg-critical"
                            }`}
                          />
                          <KindIcon
                            className={`mt-0.5 size-4 shrink-0 ${
                              notification.urgent ? "text-critical-ink" : "text-muted"
                            }`}
                            aria-hidden
                          />

                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-tiny ${
                                notification.read ? "text-secondary" : "font-medium text-ink"
                              }`}
                            >
                              {notification.title}
                            </p>
                            <p className="mt-0.5 text-micro text-muted">{notification.detail}</p>
                            {notification.waitingOnThem ? (
                              <span className="mt-1.5 inline-block">
                                {/* Today hides these. This page must not. */}
                                <Badge tone="neutral">{t("notify.waitingOnThem")}</Badge>
                              </span>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            {notification.read ? null : (
                              <form action={markReadAction.bind(null, locale, notification.id)}>
                                <Button type="submit" variant="ghost" size="small">
                                  {t("notify.markRead")}
                                </Button>
                              </form>
                            )}
                            <Link href={notification.href}>
                              <Button variant="secondary" size="small">
                                {t("notify.open")}
                              </Button>
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-panel)] border border-line-subtle bg-surface p-4">
            <h2 className="text-micro uppercase tracking-wide text-muted">
              {t("notify.preferences")}
            </h2>
            <p className="mt-1.5 text-micro leading-relaxed text-muted">
              {t("notify.preferencesHelp")}
            </p>

            <ul className="mt-3 flex flex-col gap-1.5">
              {ITEM_KINDS.map((kind) => (
                <li key={kind}>
                  <form action={toggleKindAction.bind(null, locale, kind)}>
                    <label className="flex cursor-pointer items-center gap-2 text-tiny text-ink">
                      <input
                        type="checkbox"
                        name="on"
                        defaultChecked={!muted.has(kind)}
                        className="size-3.5 accent-[var(--ink)]"
                      />
                      <span className="min-w-0 flex-1 truncate">{t(`notify.kind.${kind}`)}</span>
                      <Button type="submit" variant="ghost" size="small">
                        {t("notify.apply")}
                      </Button>
                    </label>
                  </form>
                </li>
              ))}
            </ul>
          </div>

          {/*
            The frame's "Where they go" card: in-app always on, email digest
            daily at 07:30, email for blocking only, quiet hours. Three of the
            four are about sending email, and the ERP cannot send - it holds
            Mail.Read on one mailbox. Same answer as screen 57's composer.
          */}
          <div className="rounded-[var(--radius-panel)] border border-dashed border-line p-4">
            <h2 className="text-micro uppercase tracking-wide text-muted">
              {t("notify.whereTheyGo")}
            </h2>
            <p className="mt-2 text-tiny leading-relaxed text-secondary">{t("notify.inAppOnly")}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
