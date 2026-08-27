import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Paperclip } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commitAvailability } from "@/domain/intake/commit";
import { markRead } from "@/domain/intake/inbox";
import { messageDetail, neighbours } from "@/domain/intake/message";
import { ROUTED_TO } from "@/domain/intake/routing";
import { Link } from "@/i18n/navigation";
import { dismissMessage, setClassification } from "../actions";

/** Same colours as the list, so a message does not change identity when opened. */
const TYPE_TONE: Record<string, BadgeTone> = {
  enquiry: "accent",
  tender: "accent",
  candidate: "good",
  supplierQuote: "good",
  payment: "warning",
  needsReview: "serious",
};

/**
 * One message, readable.
 *
 * The design has no frame for this screen - screen 02 was drawn as triage from
 * the row. That assumption held until real mail arrived and 31 of 39 messages
 * came back `needsReview`, a category that means "a person must read this" and
 * had nowhere to read it.
 */
export default async function MessagePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const session = await getSession();

  // Before the query, not after. Fetching a message and then declining to draw
  // it is a rendering decision, not a permission check.
  if (!session?.role || !can(session.role, "inbox.view")) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-7">
        <p className="max-w-[560px] text-tiny leading-relaxed text-secondary">
          {t("inbox.notPermitted")}
        </p>
      </main>
    );
  }

  const message = await messageDetail(id);
  if (!message) notFound();

  // Opening it is what makes it read. Deliberately not revalidating: the count
  // in the sidebar catches up on the next navigation, and a redirect just to
  // refresh a badge is a worse trade than a number that lags by one click.
  await markRead(id);

  const { previous, next } = await neighbours(id);
  const format = await getFormatter({ locale });
  const { available, phase } = commitAvailability(message.classifiedAs);

  const when = format.dateTime(message.receivedAt, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center gap-3 border-b border-line-subtle bg-surface px-7 py-4">
        <Link
          href="/inbox"
          className="flex items-center gap-1.5 text-tiny text-secondary hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("nav.inbox")}
        </Link>

        {/* Triage is a run of thirty-one, not a visit. */}
        <div className="ms-auto flex items-center gap-1.5">
          {previous ? (
            <Link href={`/inbox/${previous}`}>
              <Button variant="secondary" size="small" icon={<ChevronLeft className="size-4" />}>
                {t("message.previous")}
              </Button>
            </Link>
          ) : null}
          {next ? (
            <Link href={`/inbox/${next}`}>
              <Button variant="secondary" size="small" icon={<ChevronRight className="size-4" />}>
                {t("message.next")}
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold leading-snug text-ink">
            {message.subject || t("inbox.noSubject")}
          </h1>

          <p className="mt-1.5 text-tiny text-secondary">
            {message.partyName ?? message.fromName ?? message.fromAddress ?? "-"}
            {message.fromAddress && message.fromAddress !== message.fromName ? (
              <span className="text-muted"> · {message.fromAddress}</span>
            ) : null}
            <span className="text-muted"> · {when}</span>
          </p>

          {/*
            Text, in a pre. The body was written by a stranger - half of what
            reaches this mailbox is unsolicited - and markup from a stranger is
            not rendered inside the Gérant's session. src/domain/intake/body.ts
            says why at length. The original keeps its formatting in Outlook,
            one click away, on the right.
          */}
          <div className="mt-5 rounded-[var(--radius-panel)] border border-line-subtle bg-surface p-5">
            {message.body ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-tiny leading-relaxed text-ink">
                {message.body}
              </pre>
            ) : (
              <p className="text-tiny text-muted">{t("message.noBody")}</p>
            )}
          </div>

          {message.attachments.length > 0 ? (
            <div className="mt-5">
              <h2 className="text-micro uppercase tracking-wide text-muted">
                {t("message.attachments", { n: message.attachments.length })}
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {message.attachments.map((file) => (
                  <li
                    key={file.id}
                    className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line-subtle bg-surface px-3 py-2"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 truncate text-tiny text-ink">{file.filename}</span>
                    {file.looksLike && file.looksLike !== "unknown" ? (
                      <Badge tone="neutral">{t(`inbox.attachment.${file.looksLike}`)}</Badge>
                    ) : null}
                    {/*
                      The row exists; the bytes do not. Only the name and size
                      were captured - fetching the content waits on real storage
                      (screens 60 and 66). Saying so beats a link that 404s.
                    */}
                    <span className="ms-auto shrink-0 text-micro text-muted">
                      {file.storagePath ? t("message.stored") : t("message.inOutlookOnly")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-panel)] border border-line-subtle bg-surface p-4">
            <h2 className="text-micro uppercase tracking-wide text-muted">
              {t("message.whatItIs")}
            </h2>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge tone={TYPE_TONE[message.classifiedAs ?? "needsReview"] ?? "neutral"}>
                {t(`inbox.type.${message.classifiedAs ?? "needsReview"}`)}
              </Badge>
              {message.confidence !== null ? (
                <span className="text-micro text-muted">
                  {t("message.confidence", { pc: Math.round(message.confidence * 100) })}
                </span>
              ) : null}
            </div>

            {message.downgraded ? (
              <p className="mt-2 text-micro leading-relaxed text-muted">
                {t("message.downgraded")}
              </p>
            ) : null}

            {/* A person overruling the router. What they say is a fact. */}
            <form action={setClassification.bind(null, locale, id)} className="mt-3.5">
              <label htmlFor="to" className="block text-micro uppercase tracking-wide text-muted">
                {t("message.reclassify")}
              </label>
              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  id="to"
                  name="to"
                  defaultValue={message.classifiedAs ?? "needsReview"}
                  className="h-[28px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-micro outline-none focus:border-ink"
                >
                  {ROUTED_TO.map((value) => (
                    <option key={value} value={value}>
                      {t(`inbox.type.${value}`)}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="secondary" size="small">
                  {t("message.apply")}
                </Button>
              </div>
            </form>
          </div>

          {message.deadlineAt ? (
            <div className="rounded-[var(--radius-panel)] border border-line-subtle bg-surface p-4">
              <h2 className="text-micro uppercase tracking-wide text-muted">
                {t("message.deadline")}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={message.urgent ? "critical" : "warning"}>
                  {t("inbox.deadlineIn", { hours: Math.max(0, message.hoursLeft ?? 0) })}
                </Badge>
                {/* LAW 2 - read from the email, true only once somebody says so. */}
                {message.deadlineConfirmed ? null : (
                  <span className="text-micro text-muted">{t("inbox.unconfirmed")}</span>
                )}
              </div>
            </div>
          ) : null}

          <div className="rounded-[var(--radius-panel)] border border-line-subtle bg-surface p-4">
            <h2 className="text-micro uppercase tracking-wide text-muted">
              {t("message.whatNext")}
            </h2>

            <div className="mt-2.5 flex flex-col items-start gap-2">
              <Button
                variant="primary"
                size="small"
                disabledReason={
                  available
                    ? undefined
                    : phase === null
                      ? t("inbox.nothingToCreate")
                      : t("rules.comingInPhase", { phase })
                }
              >
                {t(`inbox.action.${message.classifiedAs ?? "needsReview"}`)}
              </Button>

              <form action={dismissMessage.bind(null, locale, id)}>
                <Button type="submit" variant="ghost" size="small">
                  {t("inbox.dismiss")}
                </Button>
              </form>
            </div>

            {message.webLink ? (
              <a
                href={message.webLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center gap-1.5 text-micro text-secondary underline underline-offset-2 hover:text-ink"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("message.openInOutlook")}
              </a>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
