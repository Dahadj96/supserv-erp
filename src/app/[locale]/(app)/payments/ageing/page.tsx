import { AlertCircle } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/domain/money";
import {
  ageingOf,
  ageOf,
  BUCKETS,
  balanceOf,
  daysLate,
  mostNeglected,
} from "@/domain/money/ageing";
import { awaitingApproval, dueNow, readyToSend } from "@/domain/money/relance";
import { owings, policy, relancesFor } from "@/domain/money/store";
import { draftAction, markSentAction, replyAction } from "./actions";

/**
 * Screen 20 — Ageing and relances.
 *
 * Every figure on this page is computed on load. There is no `overdue` column,
 * no `balance` column and no `last_chased_at` column — `docs/PLAN.md` names
 * "overdue was an invoice status" as one of two bugs LAW 1 found in the Figma
 * file, and this is the screen where that decision is paid for and repaid.
 *
 * The cost of the alternative is specific: a stored flag needs a job, the job
 * runs at midnight, and the person looking at this page at nine o'clock is
 * reading yesterday's numbers before telephoning a client about them.
 */
export const dynamic = "force-dynamic";

export default async function AgeingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; drafted?: string; sent?: string; replied?: string }>;
}) {
  const { locale } = await params;
  const { error, drafted, sent, replied } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const today = new Date();
  const ledger = await owings();
  const unpaid = ledger.filter((o) => Number(balanceOf(o)) > 0);
  const ageing = ageingOf(ledger, today);
  const neglected = mostNeglected(ledger, today);

  const steps = await policy();
  const history = await relancesFor(unpaid.map((o) => o.documentId));

  const withDue = unpaid.map((invoice) => ({
    invoice,
    due: dueNow({
      dueOn: invoice.dueOn,
      balance: balanceOf(invoice),
      policy: steps,
      history: history.get(invoice.documentId) ?? [],
      today,
    }),
  }));

  const sendable = readyToSend(
    withDue.map((r) => ({ documentId: r.invoice.documentId, due: r.due })),
  );
  const approvals = awaitingApproval(
    withDue.map((r) => ({ documentId: r.invoice.documentId, due: r.due })),
  );

  const money = (amount: string, currency = "DZD") => formatMoney(amount, { locale, currency });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
  });

  // Oldest money first — the order somebody would work down the page in.
  const ordered = [...withDue].sort(
    (a, b) => ageOf(b.invoice.issuedOn, today) - ageOf(a.invoice.issuedOn, today),
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">{t("ageing.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("ageing.subtitle", {
              total: money(ageing.total),
              pct: ageing.buckets.over90.pct,
            })}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {/*
            Greyed with its reason. Nothing in this system writes to a client on
            its own; when sending exists it will be a person pressing this after
            reading what is about to go out.
          */}
          <Button variant="primary" disabledReason={t("ageing.sendingIsAPerson")}>
            {t("ageing.sendN", { n: sendable.length })}
          </Button>
        </div>
      </div>

      {neglected ? (
        <div className="mx-4 mt-4 flex flex-wrap items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-tiny leading-relaxed text-critical-ink">
            {neglected.silentDays === null
              ? t("ageing.neverChased", {
                  number: neglected.number ?? "—",
                  age: neglected.ageDays,
                  amount: money(neglected.amount),
                })
              : t("ageing.notChasedFor", {
                  number: neglected.number ?? "—",
                  silent: neglected.silentDays,
                  age: neglected.ageDays,
                })}
            {neglected.isLargest ? ` ${t("ageing.andLargest")}` : ""}
          </p>
        </div>
      ) : null}

      {[drafted ? "drafted" : null, sent ? "sent" : null, replied ? "replied" : null]
        .filter(Boolean)
        .map((key) => (
          <p
            key={key}
            className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7"
          >
            {t(`ageing.${key}`)}
          </p>
        ))}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`ageing.error.${error}`) ? t(`ageing.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-4 py-5 md:grid-cols-5 md:px-7">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <p className="text-micro text-secondary">{t("ageing.totalOutstanding")}</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums text-ink">
            {Number(ageing.total).toLocaleString(locale === "fr" ? "fr-DZ" : "en-GB")}
          </p>
          <p className="mt-1 text-micro text-muted">
            {t("ageing.nInvoices", { n: ageing.invoices })}
          </p>
        </div>
        {BUCKETS.map((bucket) => (
          <div
            key={bucket}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
          >
            <p className="text-micro text-secondary">{t(`ageing.bucket.${bucket}`)}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums text-ink">
              {Number(ageing.buckets[bucket].amount).toLocaleString(
                locale === "fr" ? "fr-DZ" : "en-GB",
              )}
            </p>
            <p className="mt-1">
              <Badge
                tone={
                  bucket === "over90" && Number(ageing.buckets[bucket].amount) > 0
                    ? "critical"
                    : bucket === "d61_90" && Number(ageing.buckets[bucket].amount) > 0
                      ? "warning"
                      : "good"
                }
              >
                {ageing.buckets[bucket].pct}%
              </Badge>
            </p>
          </div>
        ))}
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("ageing.unpaid")}</h2>
              <span className="ms-auto text-micro text-muted">{t("ageing.orderedByAge")}</span>
            </div>

            {ordered.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("ageing.nothingOwed")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">{t("ageing.invoice")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("deals.client")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("ageing.issued")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("ageing.due")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("ageing.age")}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t("ageing.outstanding")}</th>
                      <th className="py-2 pe-5 text-start font-medium">{t("ageing.nextStep")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map(({ invoice, due }) => {
                      const age = ageOf(invoice.issuedOn, today);
                      const late = daysLate(invoice.dueOn, today);
                      return (
                        <tr key={invoice.documentId} className="border-t border-line-subtle">
                          <td className="py-2.5 ps-5 font-mono text-micro text-ink">
                            {invoice.number}
                          </td>
                          <td className="py-2.5 pe-4 text-secondary">{invoice.clientName}</td>
                          <td className="py-2.5 pe-4 text-muted">
                            {invoice.issuedOn ? day.format(invoice.issuedOn) : "—"}
                          </td>
                          <td className="py-2.5 pe-4 text-muted">
                            {invoice.dueOn ? day.format(invoice.dueOn) : "—"}
                          </td>
                          <td className="py-2.5 pe-4">
                            {/*
                              Age is days since ISSUE; the red is for being LATE.
                              An invoice sixty days old on ninety-day terms is
                              old and not late, and this does not scold it.
                            */}
                            <Badge tone={late > 90 ? "critical" : late > 30 ? "warning" : "good"}>
                              {t("ageing.nDays", { n: age })}
                            </Badge>
                          </td>
                          <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                            {money(balanceOf(invoice), invoice.currency)}
                          </td>
                          <td className="py-2.5 pe-5">
                            {due ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <Badge tone={due.needsApproval ? "critical" : "warning"}>
                                  {t(`ageing.step.${due.step.key}`)}
                                </Badge>
                                {due.drafted ? (
                                  <span className="text-micro text-muted">
                                    {t("ageing.alreadyDrafted")}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="text-micro text-muted">
                                {t("ageing.nothingDue")}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {ordered.some((r) => r.due) ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("ageing.draftOne")}</h2>
              <form
                action={draftAction.bind(null, locale)}
                className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4"
              >
                <label className="sm:col-span-2">
                  <span className="text-micro text-secondary">{t("ageing.invoice")}</span>
                  <select name="documentId" className={`${INPUT} mt-1`}>
                    {ordered
                      .filter((r) => r.due)
                      .map(({ invoice, due }) => (
                        <option key={invoice.documentId} value={invoice.documentId}>
                          {invoice.number} — {invoice.clientName} ·{" "}
                          {t(`ageing.step.${(due as NonNullable<typeof due>).step.key}`)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("ageing.channel")}</span>
                  <select name="channel" defaultValue="email" className={`${INPUT} mt-1`}>
                    {(["email", "phone", "letter"] as const).map((c) => (
                      <option key={c} value={c}>
                        {t(`ageing.channelName.${c}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("ageing.sentTo")}</span>
                  <input name="sentTo" className={`${INPUT} mt-1`} />
                </label>
                <input
                  type="hidden"
                  name="stepKey"
                  value={ordered.find((r) => r.due)?.due?.step.key ?? ""}
                />
                <div className="sm:col-span-4 flex items-center gap-3">
                  <p className="text-micro text-muted">{t("ageing.draftsNothingSent")}</p>
                  <div className="ms-auto">
                    <Button type="submit" variant="secondary">
                      {t("ageing.draftIt")}
                    </Button>
                  </div>
                </div>
              </form>
            </section>
          ) : null}

          {[...history.entries()].some(([, list]) => list.length > 0) ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">{t("ageing.history")}</h2>
              </div>
              <ul className="flex flex-col">
                {ordered.flatMap(({ invoice }) =>
                  (history.get(invoice.documentId) ?? []).map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
                    >
                      <span className="font-mono text-micro text-muted">{invoice.number}</span>
                      <span className="text-tiny text-ink">
                        {t(`ageing.channelName.${row.channel}`)}
                        {row.stepKey ? ` — ${t(`ageing.step.${row.stepKey}`)}` : ""}
                      </span>
                      {row.promisedOn ? (
                        <Badge tone="accent">
                          {t("ageing.promised", { when: day.format(row.promisedOn) })}
                        </Badge>
                      ) : null}
                      <span className="ms-auto flex items-center gap-2">
                        <Badge
                          tone={
                            row.status === "draft"
                              ? "warning"
                              : row.status === "replied"
                                ? "accent"
                                : "good"
                          }
                        >
                          {t(`ageing.status.${row.status}`)}
                        </Badge>
                        {row.status === "draft" ? (
                          <form action={markSentAction.bind(null, locale)}>
                            <input type="hidden" name="relanceId" value={row.id} />
                            <button
                              type="submit"
                              className="text-micro text-accent-ink hover:underline"
                            >
                              {t("ageing.iSentIt")}
                            </button>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  )),
                )}
              </ul>

              <form
                action={replyAction.bind(null, locale)}
                className="grid grid-cols-1 gap-3 border-t border-line-subtle px-5 py-3.5 sm:grid-cols-4"
              >
                <label className="sm:col-span-2">
                  <span className="text-micro text-secondary">{t("ageing.whatTheySaid")}</span>
                  <input name="reply" className={`${INPUT} mt-1`} />
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("ageing.promisedOn")}</span>
                  <input type="date" name="promisedOn" className={`${INPUT} mt-1`} />
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("ageing.againstWhich")}</span>
                  <select name="relanceId" className={`${INPUT} mt-1`}>
                    {ordered.flatMap(({ invoice }) =>
                      (history.get(invoice.documentId) ?? [])
                        .filter((r) => r.status !== "draft")
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {invoice.number} — {t(`ageing.channelName.${r.channel}`)}
                          </option>
                        )),
                    )}
                  </select>
                </label>
                <div className="sm:col-span-4 flex items-center gap-3">
                  {/* A promise is a fact about what was said. It is not money. */}
                  <p className="text-micro text-muted">{t("ageing.promiseIsNotPayment")}</p>
                  <div className="ms-auto">
                    <Button type="submit" variant="secondary">
                      {t("ageing.recordReply")}
                    </Button>
                  </div>
                </div>
              </form>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("ageing.byClient")}</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {ageing.byClient.map((client) => (
                <li key={client.partyId}>
                  <div className="flex items-baseline gap-3">
                    <p className="min-w-0 truncate text-tiny text-ink">{client.clientName}</p>
                    <p className="ms-auto shrink-0 tabular-nums text-tiny text-ink">
                      {money(client.amount)}
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-plane">
                    <div
                      className={`h-1.5 rounded-full ${
                        Number(client.pct) > 40
                          ? "bg-critical"
                          : Number(client.pct) > 15
                            ? "bg-warning"
                            : "bg-good"
                      }`}
                      style={{ width: `${Math.max(2, Number(client.pct))}%` }}
                    />
                  </div>
                </li>
              ))}
              {ageing.byClient.length === 0 ? (
                <li className="text-tiny text-muted">{t("ageing.nothingOwed")}</li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("ageing.policy")}</h2>
              <span className="ms-auto text-micro text-muted">{t("ageing.setInSettings")}</span>
            </div>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {steps.map((step) => (
                <div key={step.key} className="flex items-baseline gap-3">
                  <dt className="min-w-0 truncate text-secondary">
                    {t(`ageing.step.${step.key}`)}
                  </dt>
                  <dd className="ms-auto shrink-0">
                    {step.needsApproval ? (
                      <Badge tone={step.channel === "block" ? "critical" : "warning"}>
                        {t("ageing.duePlusApproval", { n: step.afterDueDays })}
                      </Badge>
                    ) : (
                      <span className="text-muted">
                        {t("ageing.duePlus", { n: step.afterDueDays })}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {approvals.length > 0 ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro leading-relaxed text-warning-ink">
                {t("ageing.awaitingApproval", { n: approvals.length })}
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("ageing.whatThisChanges")}</h2>
            {/*
              The frame's own paragraph, and the reason `relance` is a table
              rather than a `last_chased_at` column.
            */}
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {t("ageing.whatThisChangesBody")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
