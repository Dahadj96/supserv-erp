import { Bot, CircleAlert, ExternalLink, Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { listProposals } from "@/assistant/proposals";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { balanceOf, daysLate } from "@/domain/money/ageing";
import { owings } from "@/domain/money/store";
import { Link } from "@/i18n/navigation";
import { decideAction, proposeRelanceAction } from "./actions";

/**
 * Screen 44 — Assistant proposals.
 *
 * The loop, made visible:
 *
 *   the assistant proposes  →  nothing has changed
 *   a person approves       →  a record exists, still unsent
 *   a person sends          →  screen 20, by hand, as it always was
 *
 * Every proposal shows its WHOLE body, never a summary, and the links proving
 * every number in it. A proposal a person cannot check is one they will either
 * rubber-stamp or ignore, and rubber-stamping is the failure mode that makes an
 * approval loop worse than no assistant at all.
 */
export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ proposed?: string; decided?: string; error?: string; created?: string }>;
}) {
  const { locale } = await params;
  const { proposed, decided, error, created } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const mayDecide = Boolean(session.role && can(session.role, "invoices.issue"));

  const [all, owed] = await Promise.all([listProposals(), owings()]);
  const waiting = all.filter((p) => p.status === "waiting");
  const settled = all.filter((p) => p.status !== "waiting");

  const today = new Date();

  /**
   * Overdue invoices with no proposal waiting on them — the ones the assistant
   * could be asked about. Computed, never a queue: there is no background job
   * making proposals nobody asked for.
   */
  const proposedFor = new Set(waiting.map((p) => p.entityId));
  const couldChase = owed
    .filter((owing) => daysLate(owing.dueOn, today) > 0 && Number(balanceOf(owing)) > 0)
    .filter((owing) => !proposedFor.has(owing.documentId))
    .sort((a, b) => daysLate(b.dueOn, today) - daysLate(a.dueOn, today))
    .slice(0, 10);

  const format = await getFormatter({ locale });
  const stamp = (date: Date) =>
    format.dateTime(date, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-semibold text-ink">{t("proposals.title")}</h1>
          <Link
            href="/settings/assistant"
            className="ms-auto text-tiny text-accent-ink hover:underline"
          >
            {t("proposals.whatItCanDo")}
          </Link>
        </div>
        <p className="mt-1 text-tiny text-muted">
          {t("proposals.subtitle", { waiting: waiting.length })}
        </p>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("proposals.twoGates")}
        </p>
      </div>

      {proposed ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("proposals.written")}
        </p>
      ) : null}
      {decided ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {created ? t("proposals.decidedAndCreated") : t("proposals.decided")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 md:mx-7 mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          {t.has(`proposals.error.${error}`) ? t(`proposals.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <Bot className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("proposals.waiting")}</h2>
            </div>

            {waiting.length === 0 ? (
              <p className="p-5 text-tiny leading-relaxed text-secondary">
                {t("proposals.noneWaiting")}
              </p>
            ) : (
              <ul>
                {waiting.map((proposal) => (
                  <li key={proposal.id} className="border-b border-line-subtle p-5 last:border-0">
                    <div className="flex items-baseline gap-3">
                      <p className="text-tiny text-ink">{proposal.title}</p>
                      <Badge tone="neutral">{t(`assistantSafety.tool.${proposal.tool}`)}</Badge>
                      <span className="ms-auto text-micro text-muted">
                        {stamp(proposal.requestedAt)}
                      </span>
                    </div>

                    <pre className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-plane p-3 font-sans text-micro leading-relaxed text-secondary">
                      {proposal.body}
                    </pre>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span className="text-micro text-muted">{t("proposals.checkIt")}</span>
                      {proposal.citations.map((citation) => (
                        <Link
                          key={citation.href}
                          href={citation.href}
                          className="inline-flex items-center gap-1 text-micro text-accent-ink hover:underline"
                        >
                          <ExternalLink className="size-3" aria-hidden />
                          {citation.label}
                        </Link>
                      ))}
                    </div>

                    {mayDecide ? (
                      <form
                        action={decideAction.bind(null, locale)}
                        className="mt-3 rounded-[var(--radius-control)] bg-plane p-3"
                      >
                        <input type="hidden" name="id" value={proposal.id} />
                        <label className="text-micro text-secondary" htmlFor={`n-${proposal.id}`}>
                          {t("proposals.note")}
                        </label>
                        <input id={`n-${proposal.id}`} name="note" className={`${INPUT} mt-1`} />
                        <div className="mt-2 flex items-center gap-2">
                          <Button
                            type="submit"
                            name="decision"
                            value="approve"
                            variant="primary"
                            size="small"
                          >
                            {t("proposals.approve")}
                          </Button>
                          <Button
                            type="submit"
                            name="decision"
                            value="decline"
                            variant="secondary"
                            size="small"
                          >
                            {t("proposals.decline")}
                          </Button>
                          <span className="ms-2 text-micro text-muted">
                            {t("proposals.approveCreates")}
                          </span>
                        </div>
                      </form>
                    ) : (
                      <p className="mt-3 text-micro text-muted">{t("proposals.cannotDecide")}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {settled.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">{t("proposals.decidedTitle")}</h2>
                <span className="ms-auto text-micro text-muted">{t("proposals.keptWhy")}</span>
              </div>
              <ul>
                {settled.map((proposal) => (
                  <li
                    key={proposal.id}
                    className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <span className="text-tiny text-secondary">{proposal.title}</span>
                    <Badge tone={proposal.status === "approved" ? "good" : "neutral"}>
                      {t(`proposals.status.${proposal.status}`)}
                    </Badge>
                    {proposal.appliedEntityId ? (
                      <span className="text-micro text-muted">
                        {t("proposals.created", { what: proposal.appliedEntity ?? "" })}
                      </span>
                    ) : null}
                    <span className="ms-auto text-micro text-muted">
                      {proposal.decidedAt ? stamp(proposal.decidedAt) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("proposals.couldChase")}</h2>
            </div>
            {couldChase.length === 0 ? (
              <p className="p-5 text-micro leading-relaxed text-muted">
                {t("proposals.nothingToChase")}
              </p>
            ) : (
              <ul>
                {couldChase.map((owing) => (
                  <li
                    key={owing.documentId}
                    className="border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-micro text-ink">{owing.clientName}</span>
                      <span className="ms-auto text-micro tabular-nums text-muted">
                        {daysLate(owing.dueOn, today)} d
                      </span>
                    </div>
                    <form action={proposeRelanceAction.bind(null, locale)} className="mt-1.5">
                      <input type="hidden" name="documentId" value={owing.documentId} />
                      <Button type="submit" variant="secondary" size="small">
                        {t("proposals.askForADraft")}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("proposals.nothingRuns")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
