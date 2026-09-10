import { Paperclip } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commitAvailability } from "@/domain/intake/commit";
import { DEADLINE_WARNING_HOURS, type InboxRow } from "@/domain/intake/inbox";
import { Link } from "@/i18n/navigation";
import { createCandidateFrom, dismissMessage } from "./actions";

/** Screen 02 draws each type in its own colour. Needs review is the loud one. */
const TYPE_TONE: Record<string, BadgeTone> = {
  enquiry: "accent",
  tender: "accent",
  candidate: "good",
  supplierQuote: "good",
  payment: "warning",
  needsReview: "serious",
};

export async function InboxRowView({
  locale,
  row,
  formatDate,
}: {
  locale: string;
  row: InboxRow;
  formatDate: (d: Date) => string;
}) {
  const t = await getTranslations();
  const { available, blocker } = commitAvailability(row.classifiedAs);
  const isDeal = row.classifiedAs === "enquiry" || row.classifiedAs === "tender";
  const urgent = row.hoursLeft !== null && row.hoursLeft <= DEADLINE_WARNING_HOURS;

  return (
    <tr className={`border-b border-line-subtle last:border-0 ${row.read ? "" : "bg-plane"}`}>
      <td className="px-4 py-2.5">
        <span className="block truncate text-tiny text-ink">
          {row.partyName ?? row.fromName ?? row.fromAddress ?? "—"}
        </span>
      </td>

      {/*
        The subject is the way in. It was plain text until 27 August, which
        meant a row could be classified and dismissed but never READ - and 31
        of the first 39 real messages were `needsReview`, a verdict that asks a
        person to read something.
      */}
      <td className="max-w-[380px] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Link
            href={`/inbox/${row.id}`}
            className={`min-w-0 truncate text-tiny hover:underline ${
              row.read ? "text-secondary" : "font-medium text-ink"
            }`}
          >
            {row.subject || t("inbox.noSubject")}
          </Link>

          {/*
            Half of what matters in this mailbox is not in the body. A row for a
            consultation whose entire content is a cahier des charges read, from
            here, exactly like a courtesy note — there was no sign at all that
            anything came with it.
          */}
          {row.attachments > 0 ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-micro text-muted"
              title={t("inbox.hasAttachments", { n: row.attachments })}
            >
              <Paperclip className="size-3" aria-hidden />
              {row.attachments}
              <span className="sr-only">{t("inbox.hasAttachments", { n: row.attachments })}</span>
            </span>
          ) : null}
        </div>
      </td>

      <td className="px-4 py-2.5">
        {row.classifiedAs ? (
          <Badge tone={TYPE_TONE[row.classifiedAs] ?? "neutral"}>
            {t(`inbox.type.${row.classifiedAs}`)}
          </Badge>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      <td className="px-4 py-2.5">
        {row.deadlineAt ? (
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={urgent ? "critical" : "warning"}>
              {t("inbox.deadlineIn", { hours: Math.max(0, row.hoursLeft ?? 0) })}
            </Badge>
            {/* LAW 2 — read from a document, not confirmed by anybody yet. */}
            {row.deadlineConfirmed ? null : (
              <span className="text-micro text-muted" title={t("inbox.deadlineUnconfirmedHelp")}>
                {t("inbox.unconfirmed")}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      <td className="px-4 py-2.5 text-secondary">{formatDate(row.receivedAt)}</td>

      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-2">
          {row.classifiedAs === "candidate" && available ? (
            <form
              action={createCandidateFrom.bind(null, locale, row.id)}
              className="flex items-center gap-1.5"
            >
              <input
                name="trade"
                required
                placeholder={t("inbox.tradePlaceholder")}
                className="h-[28px] w-[150px] rounded-[var(--radius-control)] border border-line bg-surface px-2 text-micro outline-none focus:border-ink"
              />
              <Button type="submit" variant="primary" size="small">
                {t("inbox.action.candidate")}
              </Button>
            </form>
          ) : isDeal && available ? (
            /*
              Deliberately a link to the message, not a one-click create.
              Opening a deal commits a reference number, an owner and a
              deadline; doing that from a list, having read only the subject
              line, is how a spam RFQ becomes ENQ-2026-0142. The button on the
              message itself creates it, once somebody has read the thing.
            */
            <Link href={`/inbox/${row.id}`}>
              <Button variant="primary" size="small">
                {t(`inbox.action.${row.classifiedAs}`)}
              </Button>
            </Link>
          ) : blocker ? (
            /*
              T5 — the commit really is blocked (there is no picker yet to say
              WHICH invoice this advice pays, or which sourcing request this
              quote answers), so the commit button stays refused and says why.
              What was wrong was that the refusal was the ONLY control on the
              row: the message itself can still be read, reclassified and
              dismissed, and none of that was reachable from here. So the row
              now carries a way in as well as a reason it cannot commit.
            */
            <span className="flex items-center gap-1.5">
              <Button variant="primary" size="small" disabledReason={t(blocker)}>
                {t(`inbox.action.${row.classifiedAs ?? "needsReview"}`)}
              </Button>
              <Link href={`/inbox/${row.id}`}>
                <Button variant="secondary" size="small">
                  {t("inbox.readIt")}
                </Button>
              </Link>
            </span>
          ) : (
            /*
              T5 — `needsReview` is not blocked (COMMIT_BLOCKER.needsReview is
              null: the answer is to reclassify, not to commit), and the screen
              that reclassifies is the message itself. This used to render a
              greyed "Classify" saying "Say what this is first", beside rows
              where classifying plainly worked — which is exactly the shape of
              not knowing how to use your own software. It is a link now.
            */
            <Link href={`/inbox/${row.id}`}>
              <Button variant="secondary" size="small">
                {t(`inbox.action.${row.classifiedAs ?? "needsReview"}`)}
              </Button>
            </Link>
          )}

          <form action={dismissMessage.bind(null, locale, row.id)}>
            <Button type="submit" variant="ghost" size="small">
              {t("inbox.dismiss")}
            </Button>
          </form>
        </div>
      </td>
    </tr>
  );
}
