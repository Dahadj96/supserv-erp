import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Paperclip } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { companyNameFromEmail, resolveSender } from "@/capture/quick";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileViewer } from "@/components/ui/file-viewer";
import { fileId } from "@/domain/files";
import { previewMode } from "@/domain/files/serving";
import { commitAvailability } from "@/domain/intake/commit";
import { markRead } from "@/domain/intake/inbox";
import { messageDetail, neighbours } from "@/domain/intake/message";
import { ROUTED_TO } from "@/domain/intake/routing";
import { searchParties } from "@/domain/search";
import { Link } from "@/i18n/navigation";
import {
  createEnquiryFrom,
  dismissMessage,
  setClassification,
  startEnquiryWithCompany,
} from "../actions";

/** Same colours as the list, so a message does not change identity when opened. */
/** The one input style this screen uses, so the three fields cannot drift. */
const FIELD =
  "h-[28px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-micro outline-none focus:border-ink";

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
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; file?: string }>;
}) {
  const { locale, id } = await params;
  const { error, file: openFile } = await searchParams;
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
  const { available, blocker } = commitAvailability(message.classifiedAs);

  /**
   * The two kinds that become a deal, and therefore need a client first.
   * Held as the narrowed value rather than a boolean so the compiler still
   * knows which one it is when the action is bound.
   */
  const dealKind =
    message.classifiedAs === "enquiry" || message.classifiedAs === "tender"
      ? message.classifiedAs
      : null;

  /*
    AN ENQUIRY FROM SOMEBODY WE HAVE NEVER RECORDED.

    This was the dead end. `commitEnquiry` needs a company, said so in a
    tooltip, and pointed at a step — "link them to a company first" — that only
    existed once the company was already there. With no companies in the system
    at all, the first RFQ could not be opened by any route.

    So the screen asks the question instead of refusing: a name, prefilled from
    the sender's domain, and — when anything already on file resembles it — the
    look-alikes first, because screen 84 exists to clean up the duplicates this
    is the easiest place in the ERP to create.
  */
  const needsCompany = dealKind !== null && available && message.partyId === null;

  /*
    ASKED AGAIN, NOW.

    `identifySender` runs ONCE, when the mail is fetched, and writes
    `intake_message.party_id`. Nothing ever re-runs it. So somebody who read
    "the sender is not linked to a company", went and created that company, and
    came back, was told the same thing — and would have been told it for ever,
    because the answer was decided before the company existed.

    This is the same matcher, asked at the moment somebody is looking at the
    screen: the person's own address, then the company's, then the domain.
  */
  const nowResolves = needsCompany ? await resolveSender(message.fromAddress) : null;

  // And by name, for a company recorded without an email address on it — the
  // matcher above has nothing to match in that case, and the name usually does.
  const suggestedName = needsCompany ? (companyNameFromEmail(message.fromAddress) ?? "") : "";
  const byName = suggestedName ? await searchParties(suggestedName, 4) : [];
  const lookAlikes = byName.filter((hit) => hit.id !== nowResolves?.id);

  /*
    WHICH ATTACHMENT IS OPEN.

    In the URL, not in component state, for three reasons: this screen is a
    server component and stays one; a message with fifteen attachments must
    render one viewer and not fifteen; and the address of a particular page of
    a particular dossier is then something a person can send to somebody else.

    Only a file whose bytes are actually here can be selected, and only one the
    route agrees to serve inline — `previewMode` reads the same `RENDERABLE` set
    the route does, so the screen can never offer a preview that would arrive as
    a download.
  */
  const openAttachment =
    message.attachments.find((a) => a.id === openFile && a.storagePath !== null) ?? null;
  const openMode = openAttachment ? previewMode(openAttachment.contentType) : null;

  /*
    AN ARCHIVE, AND WHAT CAME OUT OF IT.

    A `dossier.zip` keeps its own row and its own bytes — it is what was
    actually sent, and a tender dossier is evidence. The files inside it are
    rows of their own (task 1.4), each carrying its path inside the archive as
    its name, and they are listed UNDER the archive rather than mixed in with
    what the message carried: otherwise "seven attachments" means one zip and
    six things that were in it, and the count stops meaning anything.
  */
  const insideArchive = new Map<string, typeof message.attachments>();
  for (const file of message.attachments) {
    if (!file.parentAttachmentId) continue;
    const group = insideArchive.get(file.parentAttachmentId);
    if (group) group.push(file);
    else insideArchive.set(file.parentAttachmentId, [file]);
  }

  const arrived = message.attachments.filter((file) => !file.parentAttachmentId);
  const listed = arrived.flatMap((file) => [
    { file, inside: false },
    ...(insideArchive.get(file.id) ?? []).map((child) => ({ file: child, inside: true })),
  ]);

  /** `/api/files/attachment:<uuid>` — the permission and the headers live there. */
  const bytesHref = (attachmentId: string) =>
    `/api/files/${encodeURIComponent(fileId("attachment", attachmentId))}`;

  const when = format.dateTime(message.receivedAt, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-4">
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

      <div className="grid gap-6 px-4 md:px-7 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
                {t("message.attachments", { n: arrived.length })}
              </h2>

              {/*
                A list, and ONE viewer under it.

                This was the whole complaint: an RFQ whose content is entirely
                in the attachments, and no way to read it without Outlook. Tasks
                1.1-1.3 fetch the bytes; this is where they become readable.

                The filename is the link to the file itself. A separate Show
                puts it in the pane below, because fifteen frames on one message
                would be unusable and a dossier is usually read once.
              */}
              <ul className="mt-2 flex flex-col gap-1.5">
                {listed.map(({ file, inside }) => {
                  const stored = file.storagePath !== null;
                  const mode = stored ? previewMode(file.contentType) : null;
                  const open = openAttachment?.id === file.id;
                  const holds = insideArchive.get(file.id)?.length ?? 0;

                  return (
                    <li
                      key={file.id}
                      className={`flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border bg-surface px-3 py-2 ${
                        open ? "border-ink" : "border-line-subtle"
                      } ${inside ? "ms-6" : ""}`}
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted" aria-hidden />

                      {stored ? (
                        <a
                          href={bytesHref(file.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 truncate text-tiny text-ink underline underline-offset-2 decoration-muted hover:decoration-ink"
                        >
                          {file.filename}
                        </a>
                      ) : (
                        <span className="min-w-0 truncate text-tiny text-ink">{file.filename}</span>
                      )}

                      {file.looksLike && file.looksLike !== "unknown" ? (
                        <Badge tone="neutral">{t(`inbox.attachment.${file.looksLike}`)}</Badge>
                      ) : null}

                      {/* The archive says what came out of it; the archive itself
                          is still here, still downloadable, and never deleted. */}
                      {holds > 0 ? (
                        <span className="text-micro text-muted">
                          {t("message.filesInside", { n: holds })}
                        </span>
                      ) : null}

                      <span className="ms-auto flex shrink-0 items-center gap-3">
                        {/* What was READ from this file, when something read it
                            (task 1.8). Screen 39's list is a log, not a route:
                            an extraction nobody can reach from the message it
                            arrived on is one nobody knows happened. */}
                        {file.dossierId ? (
                          <Link
                            href={`/inbox/dossier/${file.dossierId}/review`}
                            className="text-micro text-accent-ink hover:underline"
                          >
                            {t("message.reviewWhatWasRead")}
                          </Link>
                        ) : null}

                        {mode ? (
                          <Link
                            href={open ? `/inbox/${id}` : `/inbox/${id}?file=${file.id}#viewer`}
                            className="text-micro text-accent-ink hover:underline"
                          >
                            {open ? t("message.hideFile") : t("message.showFile")}
                          </Link>
                        ) : stored ? (
                          /* Not a failure. Nothing here can turn a .docx or a
                             .zip into pixels yet - 1.4 and 1.6 do - and an
                             empty frame would be a worse answer than a
                             sentence. The file itself is one click away. */
                          <span className="text-micro text-muted">{t("message.noPreviewYet")}</span>
                        ) : (
                          <span className="text-micro text-muted">{t("message.notCopiedYet")}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              {/*
                The bytes are fetched by a background job, so a row can be here
                before its copy is. Saying "in Outlook only" stopped being true
                the day 1.2 shipped, and a screen that says something untrue
                about where a file is teaches people to stop believing it.
              */}
              {message.attachments.some((file) => file.storagePath === null) ? (
                <p className="mt-2 max-w-[620px] text-micro leading-relaxed text-muted">
                  {t("message.copiesArriveLater")}
                </p>
              ) : null}

              {openAttachment && openMode ? (
                <div id="viewer" className="mt-3">
                  <FileViewer
                    src={bytesHref(openAttachment.id)}
                    filename={openAttachment.filename}
                    mode={openMode}
                  />
                </div>
              ) : null}
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

            {error ? (
              <p className="mt-2 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro leading-relaxed text-critical-ink">
                {t.has(`message.error.${error}`) ? t(`message.error.${error}`) : error}
              </p>
            ) : null}

            <div className="mt-2.5 flex flex-col items-start gap-2">
              {dealKind && available && message.partyId ? (
                <form action={createEnquiryFrom.bind(null, locale, id, dealKind)}>
                  {/* The subject is the enquiry's name, and an email subject is
                      often a poor one. Editable here, before the deal exists,
                      rather than renamed afterwards. */}
                  <input
                    name="subject"
                    defaultValue={message.subject ?? ""}
                    className="mb-2 h-[28px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-micro outline-none focus:border-ink"
                  />
                  <Button type="submit" variant="primary" size="small">
                    {t(`inbox.action.${message.classifiedAs}`)}
                  </Button>
                </form>
              ) : needsCompany && dealKind ? (
                <div className="w-full">
                  <p className="text-micro leading-relaxed text-secondary">
                    {t("message.noCompanyYet", {
                      sender: message.fromAddress ?? message.fromName ?? "",
                    })}
                  </p>

                  {nowResolves ? (
                    <div className="mt-2.5">
                      {/* Found by the matcher, not by spelling. Offered rather
                          than applied: LAW 2, and the domain pass can be wrong
                          when two companies share one. */}
                      <p className="text-micro text-muted">{t("message.thisIsProbably")}</p>
                      <form
                        action={startEnquiryWithCompany.bind(null, locale, id, dealKind)}
                        className="mt-1.5"
                      >
                        <input type="hidden" name="partyId" value={nowResolves.id} />
                        <input type="hidden" name="subject" value={message.subject ?? ""} />
                        <Button type="submit" variant="primary" size="small">
                          {t("message.useCompanyAndOpen", { name: nowResolves.name })}
                        </Button>
                      </form>
                    </div>
                  ) : null}

                  {lookAlikes.length > 0 ? (
                    <div className="mt-2.5">
                      {/* The duplicates this screen would otherwise create are
                          the expensive kind: a facture goes out under one
                          spelling and the relance under the other. */}
                      <p className="text-micro text-muted">{t("message.alreadyOnFile")}</p>
                      <ul className="mt-1.5 flex flex-col items-start gap-1">
                        {lookAlikes.map((hit) => (
                          <li key={hit.id}>
                            <form action={startEnquiryWithCompany.bind(null, locale, id, dealKind)}>
                              <input type="hidden" name="partyId" value={hit.id} />
                              <input type="hidden" name="subject" value={message.subject ?? ""} />
                              <Button type="submit" variant="secondary" size="small">
                                {t("message.useCompany", {
                                  name: hit.legalName,
                                  code: hit.code,
                                })}
                              </Button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <form
                    action={startEnquiryWithCompany.bind(null, locale, id, dealKind)}
                    className="mt-3 flex flex-col gap-2"
                  >
                    <div>
                      <label
                        htmlFor="legalName"
                        className="block text-micro uppercase tracking-wide text-muted"
                      >
                        {lookAlikes.length > 0
                          ? t("message.orNewCompany")
                          : t("message.companyName")}
                      </label>
                      {/* Prefilled from the sender's domain and edited freely.
                          A name somebody reads and submits is a name somebody
                          gave; nothing here is created from a guess alone. */}
                      <input
                        id="legalName"
                        name="legalName"
                        required
                        minLength={2}
                        defaultValue={suggestedName}
                        placeholder={t("message.companyNamePlaceholder")}
                        className={`mt-1 ${FIELD}`}
                      />
                      <p className="mt-1 text-micro leading-relaxed text-muted">
                        {t("message.companyNameHelp")}
                      </p>
                    </div>

                    <div>
                      <label
                        htmlFor="subject"
                        className="block text-micro uppercase tracking-wide text-muted"
                      >
                        {t("message.enquiryName")}
                      </label>
                      <input
                        id="subject"
                        name="subject"
                        required
                        defaultValue={message.subject ?? ""}
                        className={`mt-1 ${FIELD}`}
                      />
                    </div>

                    <Button
                      type="submit"
                      variant={nowResolves ? "secondary" : "primary"}
                      size="small"
                      className="self-start"
                    >
                      {t("message.createCompanyAndOpen")}
                    </Button>
                    <p className="text-micro leading-relaxed text-muted">
                      {t("message.whatThisDoes")}
                    </p>
                  </form>
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="small"
                  disabledReason={blocker ? t(blocker) : t("inbox.nothingToCreate")}
                >
                  {t(`inbox.action.${message.classifiedAs ?? "needsReview"}`)}
                </Button>
              )}

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
