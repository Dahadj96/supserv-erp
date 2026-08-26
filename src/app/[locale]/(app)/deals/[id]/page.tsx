import { and, eq, isNull } from "drizzle-orm";
import { AlertCircle } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party, partyRole } from "@/db/schema/party";
import { getDeal, NO_BID_REASONS } from "@/domain/deal/deal";
import { requestsForDeal } from "@/domain/deal/sourcing-store";
import { DEADLINE_WARNING_HOURS } from "@/domain/deal/stage";
import { formatMoney } from "@/domain/money";
import { offersForDeal } from "@/domain/offer/store";
import { Link } from "@/i18n/navigation";
import { decideAction, lostAction, reopenAction } from "./actions";
import { askSuppliersAction } from "./ask-actions";
import { buildOfferAction } from "./build-actions";

/**
 * Screen 06 — the enquiry.
 *
 * The banner at the top is the reason this screen is worth building before the
 * offer builder. TouatGaz does not accept submission by email; an offer sent
 * that way is not late, it is discarded. The system knew that from the moment
 * the consultation was read, and a system that knows and does not say so is
 * worse than no system at all.
 */
export const dynamic = "force-dynamic";

const TONE: Record<string, "good" | "warning" | "critical" | "neutral" | "accent"> = {
  new: "accent",
  qualifying: "neutral",
  sourcing: "warning",
  offerOut: "accent",
  ordered: "good",
  invoiced: "good",
  won: "good",
  lost: "critical",
  noBid: "neutral",
};

export default async function EnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const found = await getDeal(id);
  if (!found) notFound();

  const { deal: row, clientName, lines, facts, badge, open, deadline } = found;

  const [suppliers, requests, offers] = await Promise.all([
    db
      .selectDistinct({ id: party.id, legalName: party.legalName, tradeName: party.tradeName })
      .from(party)
      .innerJoin(partyRole, eq(partyRole.partyId, party.id))
      .where(and(eq(partyRole.role, "supplier"), isNull(party.deletedAt)))
      .orderBy(party.legalName),
    requestsForDeal(id),
    offersForDeal(id),
  ]);

  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", { dateStyle: "medium" });

  const urgent =
    deadline.kind === "at" &&
    deadline.hoursLeft !== null &&
    deadline.hoursLeft < DEADLINE_WARNING_HOURS;
  const overdue = deadline.kind === "at" && (deadline.hoursLeft ?? 0) < 0;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {row.ref} — {row.subject}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-muted">
            <span>{clientName}</span>
            {row.clientReference ? <span>· {row.clientReference}</span> : null}
            <span>
              · {t("enquiry.received")} {when.format(row.receivedAt)}
            </span>
            <Badge tone={TONE[badge] ?? "neutral"}>{t(`deals.filters.${badge}`)}</Badge>
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href={`/deals/${id}/prices`}>
            <Button variant="secondary">{t("prices.gathered")}</Button>
          </Link>
        </div>
      </div>

      {/*
        The banner. Only shown while the enquiry is still live — telling somebody
        how to submit an offer for a consultation they walked away from in June
        is the sort of noise that teaches people to scroll past red.
      */}
      {open && row.submissionMethod === "deposit_sealed" ? (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">
            {t("enquiry.sealedBanner", { client: clientName })}
          </p>
        </div>
      ) : null}

      {open && row.submissionMethod === "portal" ? (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-warning-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-warning-ink">
            {t("enquiry.portalBanner", { client: clientName })}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`enquiry.error.${error}`) ? t(`enquiry.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 md:grid-cols-3 md:px-7 md:py-6">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("enquiry.requestedItems")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("enquiry.nLines", { n: lines.length })} · {t("enquiry.noClientCodes")}
              </span>
            </div>

            {lines.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("enquiry.noLines")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">#</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("enquiry.lineRef")}</th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("enquiry.designation")}
                      </th>
                      <th className="py-2 pe-4 text-end font-medium">{t("enquiry.qty")}</th>
                      <th className="py-2 pe-5 text-start font-medium">{t("enquiry.unit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-muted">{line.position}</td>
                        <td className="py-2.5 pe-4 font-mono text-micro text-secondary">
                          {line.reference ?? "—"}
                        </td>
                        <td className="py-2.5 pe-4 text-ink">{line.designation}</td>
                        <td className="py-2.5 pe-4 text-end tabular-nums">{Number(line.qty)}</td>
                        <td className="py-2.5 pe-5 text-muted">{line.unit ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("enquiry.decision")}</h2>
              <span className="ms-auto text-micro text-muted">{t("enquiry.decisionWhy")}</span>
            </div>

            {open ? (
              <form action={decideAction.bind(null, locale, id)} className="mt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["pursue", "no_bid"] as const).map((choice) => (
                    <label
                      key={choice}
                      className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-plane px-4 py-3 has-[:checked]:border-ink has-[:checked]:bg-surface"
                    >
                      <input
                        type="radio"
                        name="decision"
                        value={choice}
                        defaultChecked={row.decision === choice}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-tiny font-medium text-ink">
                          {t(choice === "pursue" ? "enquiry.pursue" : "enquiry.noBid")}
                        </span>
                        <span className="block text-micro text-muted">
                          {t(choice === "pursue" ? "enquiry.pursueHint" : "enquiry.noBidHint")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label>
                    <span className="text-micro text-secondary">{t("enquiry.reasonLabel")}</span>
                    {/*
                      A closed list, not a text box. "Recorded so we can learn
                      from it" is only true if the reasons can be counted, and
                      free text cannot be counted. The note field below takes
                      the words.
                    */}
                    <select name="reason" defaultValue="" className={`${INPUT} mt-1`}>
                      <option value="">{t("enquiry.chooseReason")}</option>
                      {NO_BID_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {t(`enquiry.reasons.${reason}`)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">
                      {t("enquiry.expectedValue", { currency: row.currency })}
                    </span>
                    <input
                      name="expectedValue"
                      inputMode="decimal"
                      defaultValue={row.expectedValue ?? ""}
                      className={`${INPUT} mt-1 text-end tabular-nums`}
                    />
                  </label>
                </div>

                <label className="mt-3 block">
                  <span className="text-micro text-secondary">{t("enquiry.noteLabel")}</span>
                  <input name="note" className={`${INPUT} mt-1`} />
                </label>

                <div className="mt-4 flex items-center gap-3">
                  {row.decidedAt ? (
                    <p className="text-micro text-muted">
                      {t("enquiry.decidedOn", { when: day.format(row.decidedAt) })}
                    </p>
                  ) : null}
                  <div className="ms-auto">
                    <Button type="submit" variant="primary">
                      {t("enquiry.save")}
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Badge tone={TONE[badge] ?? "neutral"}>{t(`deals.filters.${badge}`)}</Badge>
                <p className="text-tiny text-secondary">
                  {row.lostReason ?? row.decisionReason ?? "—"}
                </p>
                {row.lostAt ? (
                  <form action={reopenAction.bind(null, locale, id)} className="ms-auto">
                    <Button type="submit" variant="secondary">
                      {t("enquiry.reopen")}
                    </Button>
                  </form>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("enquiry.instructions")}</h2>
              <span className="ms-auto text-micro text-muted">{t("enquiry.verbatim")}</span>
            </div>
            {row.clientInstructions ? (
              // Verbatim, and rendered as text rather than markdown or HTML.
              // The sentence about the sealed double envelope is the one that
              // loses the bid, and it must survive exactly as it was written.
              <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-plane p-4 text-tiny leading-relaxed text-secondary">
                {row.clientInstructions}
              </p>
            ) : (
              <p className="mt-3 text-tiny text-muted">{t("enquiry.noInstructions")}</p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("enquiry.details")}</h2>
            <dl className="mt-3 flex flex-col gap-2.5 text-tiny">
              {(
                [
                  ["client", clientName],
                  ["reference", row.clientReference ?? "—"],
                  ["received", when.format(row.receivedAt)],
                  [
                    "clientDeadline",
                    deadline.kind === "closed"
                      ? t("deals.closed")
                      : deadline.at
                        ? day.format(deadline.at)
                        : "—",
                  ],
                  ["submissionMethod", t(`enquiry.method.${row.submissionMethod}`)],
                  ["currency", row.currency],
                  ["source", row.source],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="shrink-0 text-secondary">
                    {t(key === "client" ? "deals.client" : `enquiry.${key}`)}
                  </dt>
                  <dd
                    className={`ms-auto min-w-0 truncate text-end ${
                      key === "clientDeadline" && urgent
                        ? "font-medium text-critical-ink"
                        : "text-ink"
                    }`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {overdue ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
                {t("enquiry.deadlinePassed")}
              </p>
            ) : deadline.kind === "at" && deadline.hoursLeft !== null && urgent ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
                {t("enquiry.hoursLeft", { n: deadline.hoursLeft })}
              </p>
            ) : null}
          </section>

          {open ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("enquiry.markLost")}</h2>
              {/*
                The only fact on this screen no document will ever contain. It
                arrives by telephone, so it is typed in — and it is reversible,
                because telephones mishear.
              */}
              <form action={lostAction.bind(null, locale, id)} className="mt-3">
                <label className="block">
                  <span className="text-micro text-secondary">{t("enquiry.lostReason")}</span>
                  <input name="reason" className={`${INPUT} mt-1`} />
                </label>
                <div className="mt-3 flex justify-end">
                  <Button type="submit" variant="secondary">
                    {t("enquiry.lost")}
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          {open && lines.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("ask.title")}</h2>
              <p className="mt-1.5 text-micro leading-relaxed text-muted">{t("ask.hint")}</p>

              {suppliers.length === 0 ? (
                <p className="mt-3 text-tiny text-muted">{t("ask.noSuppliers")}</p>
              ) : (
                <form action={askSuppliersAction.bind(null, locale, id)} className="mt-3">
                  <input type="hidden" name="subject" value={row.subject} />
                  <div className="flex max-h-[220px] flex-col gap-1.5 overflow-auto">
                    {suppliers.map((supplier) => (
                      <label key={supplier.id} className="flex items-center gap-2 text-tiny">
                        <input type="checkbox" name="supplierId" value={supplier.id} />
                        <span className="min-w-0 truncate text-ink">
                          {supplier.tradeName?.trim() || supplier.legalName}
                        </span>
                      </label>
                    ))}
                  </div>

                  <label className="mt-3 block">
                    <span className="text-micro text-secondary">{t("ask.replyBy")}</span>
                    <input type="datetime-local" name="replyBy" className={`${INPUT} mt-1`} />
                  </label>

                  <div className="mt-3 flex justify-end">
                    <Button type="submit" variant="secondary">
                      {t("ask.create")}
                    </Button>
                  </div>
                </form>
              )}

              {requests.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-1.5 border-t border-line-subtle pt-3">
                  {requests.map((request) => (
                    <li key={request.id} className="flex items-baseline gap-2 text-tiny">
                      <Link className="text-ink hover:underline" href={`/sourcing/${request.id}`}>
                        {request.ref}
                      </Link>
                      <span className="ms-auto text-micro text-muted">
                        {request.sentAt
                          ? t("ask.askedReplied", { asked: request.asked, replied: request.quoted })
                          : t("ask.draft")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {open && lines.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("offer.build.title")}</h2>
              <p className="mt-1.5 text-micro leading-relaxed text-muted">
                {t("offer.build.hint")}
              </p>

              <form
                action={buildOfferAction.bind(null, locale, id)}
                className="mt-3 flex items-end gap-2"
              >
                <label className="flex-1">
                  <span className="text-micro text-secondary">{t("offer.build.marginLabel")}</span>
                  <input
                    name="marginPct"
                    inputMode="decimal"
                    defaultValue="20"
                    className={`${INPUT} mt-1 text-end tabular-nums`}
                  />
                </label>
                <Button type="submit" variant="primary">
                  {t("offer.build.go")}
                </Button>
              </form>

              {offers.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-1.5 border-t border-line-subtle pt-3">
                  {offers.map((offer) => (
                    <li key={offer.id} className="flex items-baseline gap-2 text-tiny">
                      <Link className="text-ink hover:underline" href={`/offers/${offer.id}/build`}>
                        {offer.number ?? t("offer.noNumberYet")}
                      </Link>
                      <span className="ms-auto">
                        <Badge tone={offer.number ? "good" : "neutral"}>
                          {offer.number ? t("offer.issued") : t("offer.draft")}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deals.stageDerivedLabel")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("deals.stageIsDerived")}
            </p>
            <dl className="mt-3 flex flex-col gap-1.5 text-micro">
              {(
                [
                  ["lines", facts.lineCount],
                  ["suppliersAsked", facts.suppliersAsked],
                  ["offersIssued", facts.offersIssued],
                  ["ordersReceived", facts.ordersReceived],
                  ["invoicesIssued", facts.invoicesIssued],
                ] as const
              ).map(([key, n]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`facts.${key}`)}</dt>
                  <dd className="ms-auto tabular-nums text-ink">{n}</dd>
                </div>
              ))}
            </dl>
          </section>

          {row.expectedValue ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("deals.value")}</h2>
              <p className="mt-1 text-lead font-semibold tabular-nums text-ink">
                {formatMoney(row.expectedValue, { locale, currency: row.currency })}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
