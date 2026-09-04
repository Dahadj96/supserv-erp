import { ExternalLink, Paperclip } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isThreadFacet,
  listThreads,
  THREAD_FACETS,
  threadCounts,
  threadOf,
} from "@/domain/conversation/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 57 — Conversations.
 *
 * Two departures from the frame, both because the ERP holds `Mail.Read` and
 * read means read. There is no composer and there are only two states.
 * docs/DECISIONS/2026-08-27-conversations-are-read-only.md.
 */
export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ facet?: string; m?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const session = await getSession();

  // Conversations ARE the mailbox, arranged differently. Same permission.
  if (!session?.role || !can(session.role, "inbox.view")) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-7">
        <p className="max-w-[560px] text-tiny leading-relaxed text-secondary">
          {t("inbox.notPermitted")}
        </p>
      </main>
    );
  }

  const query = await searchParams;
  const facet = isThreadFacet(query.facet) ? query.facet : "all";

  const [threads, counts] = await Promise.all([listThreads(facet), threadCounts()]);
  const selected = query.m ?? threads[0]?.anchorId;
  const open = selected ? await threadOf(selected) : null;

  const format = await getFormatter({ locale });
  const day = (date: Date) =>
    format.dateTime(date, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.conversations")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("conversations.subtitle", { needReply: counts.needsReply })}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-4 md:px-7 py-2.5">
        {THREAD_FACETS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/conversations" : `/conversations?facet=${key}`}
            aria-current={facet === key ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              facet === key
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`conversations.facet.${key}`)}
            <span className={facet === key ? "text-surface/70" : "text-muted"}>{counts[key]}</span>
          </Link>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto border-e border-line-subtle">
          {threads.length === 0 ? (
            <p className="p-7 text-tiny text-muted">{t("conversations.none")}</p>
          ) : (
            <ul>
              {threads.map((thread) => (
                <li key={thread.key}>
                  <Link
                    href={`/conversations?facet=${facet}&m=${thread.anchorId}`}
                    className={`block border-b border-line-subtle px-4 py-3 hover:bg-plane ${
                      open?.key === thread.key ? "bg-plane" : ""
                    }`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-tiny font-medium text-ink">
                        {thread.counterparty || t("conversations.unknownSender")}
                      </span>
                      <span className="shrink-0 text-micro text-muted">{day(thread.lastAt)}</span>
                    </div>

                    <p className="mt-0.5 truncate text-tiny text-secondary">
                      {thread.title || t("inbox.noSubject")}
                    </p>
                    <p className="mt-0.5 truncate text-micro text-muted">{thread.preview}</p>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge tone={thread.state === "needsReply" ? "warning" : "neutral"}>
                        {t(`conversations.state.${thread.state}`)}
                      </Badge>
                      {thread.count > 1 ? (
                        <span className="text-micro text-muted">
                          {t("conversations.messageCount", { n: thread.count })}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-auto">
          {open ? (
            <>
              <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle px-6 py-4">
                <div className="min-w-0">
                  <h2 className="truncate text-tiny font-semibold text-ink">
                    {open.title || t("inbox.noSubject")}
                  </h2>
                  <p className="mt-0.5 text-micro text-muted">
                    {open.counterparty || t("conversations.unknownSender")} ·{" "}
                    {t("conversations.messageCount", { n: open.count })}
                  </p>
                </div>
                <div className="ms-auto flex items-center gap-2">
                  {/* Which language this counterparty is written to in - read
                      from the party, never guessed from the message. */}
                  <Badge tone="neutral">
                    {t(`conversations.locale.${open.emailLocale === "en" ? "en" : "fr"}`)}
                  </Badge>
                  {open.partyId ? (
                    <Link href={`/companies/${open.partyId}`}>
                      <Button variant="secondary" size="small">
                        {t("conversations.openCompany")}
                      </Button>
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-4 px-6 py-5">
                {open.messages.map((message) => (
                  <article
                    key={message.id}
                    className="rounded-[var(--radius-panel)] border border-line-subtle bg-surface"
                  >
                    <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-4 py-2.5">
                      <span className="text-tiny font-medium text-ink">{message.fromName}</span>
                      {/*
                        "Received", with nothing to pair it against. Every
                        message on this screen came IN: the ERP has never sent
                        anything, and sent mail is not captured either.
                      */}
                      <Badge tone="neutral">{t("conversations.received")}</Badge>
                      {message.committed ? (
                        <Badge tone="good">{t("conversations.becameRecord")}</Badge>
                      ) : null}
                      {message.dismissed ? (
                        <Badge tone="neutral">{t("conversations.dismissed")}</Badge>
                      ) : null}
                      <span className="ms-auto text-micro text-muted">
                        {day(message.receivedAt)}
                      </span>
                    </div>

                    <div className="px-4 py-3">
                      {/* Text, never markup. src/domain/intake/body.ts. */}
                      <pre className="whitespace-pre-wrap break-words font-sans text-tiny leading-relaxed text-ink">
                        {message.body || t("message.noBody")}
                      </pre>

                      {message.attachments.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {message.attachments.map((file) => (
                            <span
                              key={file.id}
                              className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-subtle px-2 py-1 text-micro text-secondary"
                            >
                              <Paperclip className="size-3" aria-hidden />
                              {file.filename}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-3 flex items-center gap-3">
                        <Link
                          href={`/inbox/${message.id}`}
                          className="text-micro text-secondary underline underline-offset-2 hover:text-ink"
                        >
                          {t("conversations.openMessage")}
                        </Link>
                        {message.webLink ? (
                          <a
                            href={message.webLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-micro text-secondary underline underline-offset-2 hover:text-ink"
                          >
                            <ExternalLink className="size-3" aria-hidden />
                            {t("message.openInOutlook")}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              {/*
                Where the frame draws a composer. The ERP cannot send: it holds
                Mail.Read on one mailbox, scoped in Exchange, and that is a
                deliberate limit rather than an unfinished feature. A reply box
                that opened Outlook while looking like it sent from here would
                be worse than saying so.
              */}
              <div className="mx-6 mb-6 rounded-[var(--radius-panel)] border border-dashed border-line px-4 py-3.5">
                <p className="text-tiny leading-relaxed text-secondary">
                  {t("conversations.cannotSend")}
                </p>
                {open.messages.at(-1)?.webLink ? (
                  <a
                    href={open.messages.at(-1)?.webLink ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-micro text-secondary underline underline-offset-2 hover:text-ink"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    {t("conversations.replyInOutlook")}
                  </a>
                ) : null}
              </div>
            </>
          ) : (
            <p className="p-7 text-tiny text-muted">{t("conversations.pickOne")}</p>
          )}
        </div>
      </div>
    </main>
  );
}
