import { AlertCircle } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  bufferHours,
  compare,
  conflictsOf,
  RESPONSE_STATUSES,
  replyRate,
  totalFor,
  worthChasing,
} from "@/domain/deal/sourcing";
import { requestFor } from "@/domain/deal/sourcing-store";
import { formatMoney } from "@/domain/money";
import { Link } from "@/i18n/navigation";
import { answerAction, chaseAction, markSentAction, orderAction } from "./actions";

/**
 * Screen 67 — the sourcing request.
 *
 * The conflicts card is the reason this screen is worth more than a list of
 * prices. Nobody reads a supplier's reply next to a forty-page cahier des
 * charges and notices that the offer validity is sixty days short. The system
 * has both numbers.
 *
 * Every conflict offers "ask the supplier" or "accept the risk" and NOTHING is
 * blocked. LAW 6: whether a 34-day lead time is worth the penalty clause is the
 * Gérant's decision, not the software's.
 */
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  asked: "neutral",
  quoted: "good",
  declined: "warning",
  no_reply: "warning",
  bounced: "critical",
} as const;

export default async function SourcingRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; sent?: string; chased?: string; recorded?: string }>;
}) {
  const { locale, id } = await params;
  const { error, sent, chased, recorded } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const found = await requestFor(id);
  if (!found) notFound();

  const lines = found.lines.map((l) => ({ lineId: l.id, qty: l.qty }));
  const rate = replyRate(found.answers);
  const chaseable = worthChasing(found.answers);
  const comparison = compare(found.answers, lines);
  const conflicts = conflictsOf({
    requires: found.requires,
    answers: found.answers,
    lineIds: lines.map((l) => l.lineId),
    quotedOn: found.quotedOn,
    total: (a) => totalFor(a, lines) ?? "0",
  });
  const buffer = bufferHours(found.request.replyBy, found.requires.deadlineAt);

  const money = (amount: string) => formatMoney(amount, { locale, currency: found.currency });
  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {found.request.ref} — {found.request.subject}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {t("sourcing.forDeal", { ref: found.dealRef, client: found.clientName })} ·{" "}
            {t("sourcing.askedReplied", { asked: rate.asked, replied: rate.quoted })}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {!found.request.sentAt ? (
            <form action={markSentAction.bind(null, locale, id)}>
              <Button type="submit" variant="primary">
                {t("sourcing.markSent")}
              </Button>
            </form>
          ) : chaseable.length > 0 ? (
            <form action={chaseAction.bind(null, locale, id)}>
              {chaseable.map((a) => (
                <input key={a.responseId} type="hidden" name="responseId" value={a.responseId} />
              ))}
              <Button type="submit" variant="secondary">
                {t("sourcing.chaseN", { n: chaseable.length })}
              </Button>
            </form>
          ) : null}
          <Link href={`/deals/${found.dealId}`}>
            <Button variant="secondary">{t("prices.backToEnquiry")}</Button>
          </Link>
        </div>
      </div>

      {[sent ? "sent" : null, recorded ? "recorded" : null, chased ? "chased" : null]
        .filter(Boolean)
        .map((key) => (
          <p
            key={key}
            className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7"
          >
            {key === "chased" ? t("sourcing.chasedN", { n: Number(chased) }) : t(`sourcing.${key}`)}
          </p>
        ))}

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`sourcing.error.${error}`) ? t(`sourcing.error.${error}`) : error}
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">
            {t("sourcing.conflictBanner", { n: conflicts.length })}
          </p>
        </div>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 md:grid-cols-3 md:px-7 md:py-6">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("sourcing.responses")}</h2>
              {found.request.replyBy ? (
                <span className="ms-auto text-micro text-muted">
                  {t("sourcing.replyByWas", { when: when.format(found.request.replyBy) })}
                </span>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">{t("sourcing.supplier")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("sourcing.status")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("sourcing.validity")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("sourcing.leadTime")}</th>
                    <th className="py-2 pe-5 text-end font-medium">{t("sourcing.total")}</th>
                    <th className="py-2 pe-5" />
                  </tr>
                </thead>
                <tbody>
                  {found.answers.map((answer) => {
                    const total = totalFor(answer, lines);
                    return (
                      <tr key={answer.responseId} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-ink">{answer.supplierName}</td>
                        <td className="py-2.5 pe-4">
                          <Badge tone={STATUS_TONE[answer.status]}>
                            {t(`sourcing.statusName.${answer.status}`)}
                          </Badge>
                        </td>
                        <td className="py-2.5 pe-4 text-muted">
                          {answer.validityDays !== null
                            ? t("sourcing.nDays", { n: answer.validityDays })
                            : "—"}
                        </td>
                        <td className="py-2.5 pe-4 text-muted">
                          {answer.leadTimeDays !== null
                            ? t("sourcing.nDays", { n: answer.leadTimeDays })
                            : "—"}
                        </td>
                        <td className="py-2.5 pe-5 text-end tabular-nums text-ink">
                          {/*
                            Null when they did not price every line. Adding up
                            what they DID price produces a number that looks
                            like a total and is not one — which is how somebody
                            orders four fifths of a job.
                          */}
                          {total ? money(total) : t("sourcing.partial")}
                        </td>
                        <td className="py-2.5 pe-5 text-end">
                          {/*
                            The step that was missing: from their answer to a
                            purchase order at THEIR prices, as a draft to be read
                            and issued on screen 18. Only a quoted answer on a
                            sent request can be ordered from.
                          */}
                          {answer.status === "quoted" && found.request.sentAt ? (
                            <form action={orderAction.bind(null, locale, id, answer.responseId)}>
                              <Button type="submit" variant="secondary">
                                {t("sourcing.orderFromThem")}
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {conflicts.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-tiny font-semibold text-ink">{t("sourcing.conflictsFound")}</h2>
                <span className="ms-auto text-micro text-muted">
                  {t("sourcing.checkedAgainst")}
                </span>
              </div>

              <ul className="mt-3 flex flex-col gap-3">
                {conflicts.map((conflict) => (
                  <li
                    key={`${conflict.responseId}-${conflict.kind}`}
                    className={`rounded-[var(--radius-control)] border p-4 ${
                      conflict.severity === "critical"
                        ? "border-critical bg-critical-bg"
                        : "border-line bg-warning-bg"
                    }`}
                  >
                    <p
                      className={`text-tiny font-medium ${
                        conflict.severity === "critical" ? "text-critical-ink" : "text-warning-ink"
                      }`}
                    >
                      {t(`sourcing.conflict.${conflict.kind}.title`)}
                    </p>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-micro text-secondary">{t("sourcing.clientRequires")}</p>
                        <p className="text-tiny text-ink">
                          {t(`sourcing.conflict.${conflict.kind}.client`, {
                            value: conflict.clientSide,
                          })}
                        </p>
                      </div>
                      <div>
                        <p className="text-micro text-secondary">{t("sourcing.supplierOffers")}</p>
                        <p className="text-tiny text-ink">
                          {t(`sourcing.conflict.${conflict.kind}.supplier`, {
                            value: conflict.supplierSide,
                            supplier: conflict.supplierName,
                          })}
                        </p>
                      </div>
                    </div>

                    <p className="mt-2 text-micro leading-relaxed text-secondary">
                      {t(`sourcing.conflict.${conflict.kind}.consequence`, {
                        supplier: conflict.supplierName,
                        client: found.clientName,
                        ...conflict.detail,
                      })}
                    </p>

                    {/*
                      Neither of these blocks anything. The bid goes out either
                      way — LAW 6. What changes is whether the Gérant knew.
                    */}
                    <p className="mt-2 text-micro text-muted">{t("sourcing.neitherStopsYou")}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("sourcing.comparison")}</h2>
              <span className="ms-auto text-micro text-muted">{t("sourcing.bestPerLine")}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">{t("prices.item")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("enquiry.qty")}</th>
                    {found.answers
                      .filter((a) => a.status === "quoted")
                      .map((a) => (
                        <th key={a.responseId} className="py-2 pe-4 text-end font-medium">
                          {a.supplierName}
                        </th>
                      ))}
                    <th className="py-2 pe-5 text-start font-medium">{t("sourcing.chosen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {found.lines.map((line) => {
                    const winner = comparison.best.get(line.id);
                    return (
                      <tr key={line.id} className="border-t border-line-subtle">
                        <td className="max-w-[240px] truncate py-2.5 ps-5 text-ink">
                          {line.designation}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-muted">
                          {Number(line.qty)}
                        </td>
                        {found.answers
                          .filter((a) => a.status === "quoted")
                          .map((a) => {
                            const price = a.prices.get(line.id);
                            const best = winner?.responseId === a.responseId;
                            return (
                              <td
                                key={a.responseId}
                                className={`py-2.5 pe-4 text-end tabular-nums ${
                                  best ? "font-semibold text-ink" : "text-secondary"
                                }`}
                              >
                                {price ? money(price) : "—"}
                              </td>
                            );
                          })}
                        <td className="py-2.5 pe-5">
                          {winner ? (
                            <Badge tone="good">{winner.supplierName}</Badge>
                          ) : (
                            <Badge tone="critical">{t("sourcing.nobody")}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("sourcing.recordAnswer")}</h2>
            <form action={answerAction.bind(null, locale, id)} className="mt-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label>
                  <span className="text-micro text-secondary">{t("sourcing.supplier")}</span>
                  <select name="responseId" className={`${INPUT} mt-1`}>
                    {found.answers.map((a) => (
                      <option key={a.responseId} value={a.responseId}>
                        {a.supplierName}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="text-micro text-secondary">{t("sourcing.status")}</span>
                  <select name="status" defaultValue="quoted" className={`${INPUT} mt-1`}>
                    {RESPONSE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`sourcing.statusName.${status}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="text-micro text-secondary">{t("sourcing.validityDays")}</span>
                  <input name="validityDays" inputMode="numeric" className={`${INPUT} mt-1`} />
                </label>

                <label>
                  <span className="text-micro text-secondary">{t("sourcing.leadTimeDays")}</span>
                  <input name="leadTimeDays" inputMode="numeric" className={`${INPUT} mt-1`} />
                </label>

                <label>
                  <span className="text-micro text-secondary">{t("enquiry.currency")}</span>
                  <input
                    name="currency"
                    defaultValue={found.currency}
                    className={`${INPUT} mt-1`}
                  />
                </label>

                <label>
                  <span className="text-micro text-secondary">{t("prices.vat")}</span>
                  <select name="vat" defaultValue="excl" className={`${INPUT} mt-1`}>
                    <option value="excl">{t("prices.excl")}</option>
                    <option value="incl">{t("prices.incl")}</option>
                  </select>
                </label>
              </div>

              <p className="mt-4 text-micro uppercase tracking-wide text-muted">
                {t("sourcing.theirPrices")}
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {found.lines.map((line) => (
                  <label key={line.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-tiny text-secondary">
                      {line.position} — {line.designation}
                    </span>
                    <input
                      name={`price:${line.id}`}
                      inputMode="decimal"
                      placeholder={t("sourcing.noPrice")}
                      className={`${INPUT} w-[160px] text-end tabular-nums`}
                    />
                  </label>
                ))}
              </div>

              <label className="mt-3 block">
                <span className="text-micro text-secondary">{t("sourcing.note")}</span>
                <input name="note" className={`${INPUT} mt-1`} />
              </label>

              <div className="mt-4 flex justify-end">
                <Button type="submit" variant="primary">
                  {t("sourcing.saveAnswer")}
                </Button>
              </div>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("sourcing.thisRequest")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(
                [
                  ["number", found.request.ref],
                  ["for", found.dealRef],
                  ["client", found.clientName],
                  [
                    "items",
                    found.excludedCount > 0
                      ? t("sourcing.ofWithExcluded", {
                          n: found.lines.length,
                          total: found.lines.length + found.excludedCount,
                          excluded: found.excludedCount,
                        })
                      : String(found.lines.length),
                  ],
                  [
                    "sent",
                    found.request.sentAt ? when.format(found.request.sentAt) : t("sourcing.notYet"),
                  ],
                  ["replyBy", found.request.replyBy ? when.format(found.request.replyBy) : "—"],
                  [
                    "clientDeadline",
                    found.requires.deadlineAt ? day.format(found.requires.deadlineAt) : "—",
                  ],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="shrink-0 text-secondary">{t(`sourcing.field.${key}`)}</dt>
                  <dd className="ms-auto min-w-0 truncate text-end text-ink">{value}</dd>
                </div>
              ))}

              {buffer !== null ? (
                <div className="flex items-baseline gap-3">
                  <dt className="shrink-0 text-secondary">{t("sourcing.field.buffer")}</dt>
                  <dd className="ms-auto">
                    {/*
                      Nobody works this out in their head at four o'clock on a
                      Thursday. Negative means the request cannot help even if
                      everybody answers on time.
                    */}
                    <Badge tone={buffer < 24 ? "critical" : buffer < 72 ? "warning" : "good"}>
                      {buffer < 0
                        ? t("sourcing.bufferNegative")
                        : t("sourcing.bufferHours", { n: buffer })}
                    </Badge>
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("sourcing.replyRate")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(["asked", "quoted", "declined", "no_reply", "bounced"] as const).map((key) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`sourcing.statusName.${key}`)}</dt>
                  <dd className="ms-auto tabular-nums text-ink">{rate[key]}</dd>
                </div>
              ))}
            </dl>
            {rate.bounced > 0 ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro leading-relaxed text-critical-ink">
                {/*
                  The distinction that matters most on this card. Chasing a
                  broken address forever is how a supplier quietly drops out of
                  every comparison for a year.
                */}
                {t("sourcing.bouncedNote", {
                  supplier: found.answers.find((a) => a.status === "bounced")?.supplierName ?? "",
                })}
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("sourcing.whatNext")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("sourcing.splitAcross")}</dt>
                <dd className="ms-auto">
                  <Badge tone="neutral">
                    {t("sourcing.nSuppliers", { n: comparison.splitSuppliers })}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("sourcing.bestCombined")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{money(comparison.splitTotal)}</dd>
              </div>
              {comparison.singleBest ? (
                <div className="flex items-baseline gap-3">
                  <dt className="min-w-0 truncate text-secondary">
                    {t("sourcing.singleSupplier", { supplier: comparison.singleBest.supplierName })}
                  </dt>
                  <dd className="ms-auto tabular-nums text-ink">
                    {money(comparison.singleBest.total)}
                  </dd>
                </div>
              ) : null}
              {comparison.saving ? (
                <div className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t("sourcing.savingBySplitting")}</dt>
                  <dd className="ms-auto">
                    <Badge tone={Number(comparison.saving) > 0 ? "good" : "neutral"}>
                      {money(comparison.saving)}
                    </Badge>
                  </dd>
                </div>
              ) : null}
            </dl>

            {comparison.splitSuppliers > 1 ? (
              // The arithmetic is only half the decision, and the frame says so
              // in as many words. Two suppliers is two deliveries, two sets of
              // paperwork, and two chances of one being late against a penalty.
              <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro leading-relaxed text-warning-ink">
                {t("sourcing.butAdds", { n: comparison.splitSuppliers - 1 })}
              </p>
            ) : null}

            {comparison.unpricedLines.length > 0 ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro leading-relaxed text-critical-ink">
                {t("sourcing.nobodyPriced", { n: comparison.unpricedLines.length })}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
