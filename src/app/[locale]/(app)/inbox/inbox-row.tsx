import { getTranslations } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commitAvailability } from "@/domain/intake/commit";
import { DEADLINE_WARNING_HOURS, type InboxRow } from "@/domain/intake/inbox";
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
  const { available, phase } = commitAvailability(row.classifiedAs);
  const urgent = row.hoursLeft !== null && row.hoursLeft <= DEADLINE_WARNING_HOURS;

  return (
    <tr className={`border-b border-line-subtle last:border-0 ${row.read ? "" : "bg-plane"}`}>
      <td className="px-4 py-2.5">
        <span className="block truncate text-tiny text-ink">
          {row.partyName ?? row.fromName ?? row.fromAddress ?? "—"}
        </span>
      </td>

      <td className="max-w-[380px] px-4 py-2.5">
        <span className={`block truncate text-tiny ${row.read ? "text-secondary" : "text-ink"}`}>
          {row.subject || t("inbox.noSubject")}
        </span>
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
          ) : (
            <Button
              variant="primary"
              size="small"
              disabledReason={
                phase === null ? t("inbox.nothingToCreate") : t("rules.comingInPhase", { phase })
              }
            >
              {t(`inbox.action.${row.classifiedAs ?? "needsReview"}`)}
            </Button>
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
