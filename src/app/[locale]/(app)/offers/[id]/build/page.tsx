import { Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  describeDocumentDiscard,
  discardDocumentFromListAction,
} from "@/app/[locale]/(app)/documents/[id]/delete-actions";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowDelete } from "@/components/ui/row-delete";
import { priceHistory } from "@/domain/deal/price-history";
import { formatMoney } from "@/domain/money";
import { marginPct } from "@/domain/offer/margin";
import { getOffer } from "@/domain/offer/store";
import { canSubmit, countChecks } from "@/domain/offer/submit";
import { Link } from "@/i18n/navigation";
import { applyMarginAction, markSubmittedAction, setLineAction } from "./actions";

/**
 * Screen 12 — the offer builder.
 *
 * A NOTE ON WHO SEES COST. The frame's banner says "Cost and margin columns are
 * visible because you are signed in as Gérant. The Commercial role sees selling
 * price only." `offers.margin.view` is the single implementation of that rule:
 * the Gérant and Compta hold it; Commercial does not. Commercial can still type
 * a selling price, while pricing from a cost-derived margin remains restricted.
 */
export const dynamic = "force-dynamic";

const CHECK_TONE = { pass: "good", warn: "warning", block: "critical", note: "neutral" } as const;

export default async function OfferBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; applied?: string; submitted?: string }>;
}) {
  const { locale, id } = await params;
  const { error, saved, applied, submitted } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session?.role) hardRedirect(`/${locale}/sign-in`);

  const offer = await getOffer(id);
  if (!offer) notFound();

  const seesMargin = can(session.role, "offers.margin.view");
  const issued = Boolean(offer.document.number);

  // "Last time": the newest issued line of ours with the same wording, and
  // the newest supplier price captured for it. One row each, per line — the
  // figure a person compares against before changing the price, and the
  // thing this screen used to leave to memory.
  const lastTime = new Map<string, Awaited<ReturnType<typeof priceHistory>>>();
  for (const line of offer.lines) {
    if (line.lineKind !== "item" || !line.designation) continue;
    lastTime.set(
      line.id,
      await priceHistory(line.designation, {
        partyId: offer.clientId,
        excludeDocumentId: id,
        limit: 1,
      }),
    );
  }
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", { dateStyle: "medium" });
  const counts = countChecks(offer.checks);
  const ready = canSubmit(offer.checks);

  const money = (amount: string) =>
    formatMoney(amount, { locale, currency: offer.document.currency });
  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">
            {offer.document.number ?? t("offer.noNumberYet")} —{" "}
            {issued ? t("offer.issued") : t("offer.draft")}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {offer.clientName}
            {offer.dealRef ? ` · ${t("offer.fromDeal", { ref: offer.dealRef })}` : ""}
            {offer.clientReference ? ` · ${offer.clientReference}` : ""}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {offer.dealId ? (
            <Link href={`/deals/${offer.dealId}`}>
              <Button variant="secondary">{t("prices.backToDeal")}</Button>
            </Link>
          ) : null}
          {/*
            Screen 12 prices the lines; screen 47 edits everything else on them
            and screen 18 is where the offer is read as a PDF and issued. The
            first walk-through of this page found no door to either.
          */}
          {issued ? null : (
            <Link href={`/documents/${id}/edit`}>
              <Button variant="secondary">{t("offer.editLines")}</Button>
            </Link>
          )}
          <Link href={`/documents/${id}`}>
            <Button variant="primary">{t("offer.openDocument")}</Button>
          </Link>
          {/*
            And the way OUT.

            `discardDocument` has existed since Wave 0 and was callable from
            `/documents/[id]` and nowhere else — but an offer is opened here,
            worked on here, and abandoned here. Somebody who built a proforma
            for the wrong client had to know that a third screen existed before
            they could remove it, which is how "I cannot delete an offer" gets
            written down about a system that could delete it all along.

            Only while it is a draft: an issued offer keeps its number for ever.
          */}
          {issued ? null : (
            <RowDelete
              label={offer.document.number ?? offer.dealRef ?? t("offer.noNumberYet")}
              what={t("rowDelete.what.document")}
              describe={describeDocumentDiscard.bind(null, locale, id)}
              action={discardDocumentFromListAction.bind(
                null,
                locale,
                offer.dealId ? `/deals/${offer.dealId}` : "/offers",
                id,
              )}
            />
          )}
        </div>
      </div>

      {/*
        The permission banner. Its wording follows `can()` rather than naming a
        role, so it cannot claim something the permission table contradicts.
      */}
      <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3 md:mx-7">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {seesMargin
            ? t("offer.marginVisible", { role: t(`auth.roles.${session.role}`) })
            : t("offer.marginHidden", { role: t(`auth.roles.${session.role}`) })}
        </p>
      </div>

      {[saved ? "saved" : null, applied ? "applied" : null, submitted ? "submitted" : null]
        .filter(Boolean)
        .map((key) => (
          <p
            key={key}
            className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7"
          >
            {t(`offer.${key}`)}
          </p>
        ))}

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`offer.error.${error}`) ? t(`offer.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 md:grid-cols-3 md:px-7 md:py-6">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("offer.lines")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("deal.nLines", { n: offer.lines.length })}
                {seesMargin ? ` · ${t("offer.costsFromQuotes")}` : ""}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">#</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deal.designation")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deal.qty")}</th>
                    {seesMargin ? (
                      <>
                        <th className="py-2 pe-4 text-end font-medium">{t("offer.cost")}</th>
                        <th className="py-2 pe-4 text-end font-medium">{t("offer.margin")}</th>
                      </>
                    ) : null}
                    <th className="py-2 pe-4 text-end font-medium">{t("offer.unitPrice")}</th>
                    <th className="py-2 pe-5 text-end font-medium">{t("offer.totalExcl")}</th>
                  </tr>
                </thead>
                <tbody>
                  {offer.lines.map((line) => {
                    const pct = marginPct(line.unitCost, line.unitPrice);
                    const total =
                      line.unitPrice !== null
                        ? String(Number(line.unitPrice) * Number(line.qty ?? 0))
                        : null;
                    return (
                      <tr key={line.id} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-muted">{line.position}</td>
                        <td className="max-w-[260px] py-2.5 pe-4">
                          <span className="block truncate text-ink">{line.designation}</span>
                          {line.reference ? (
                            <span className="block font-mono text-micro text-muted">
                              {line.reference}
                            </span>
                          ) : null}
                          {(() => {
                            const h = lastTime.get(line.id);
                            const sold = h?.sold[0];
                            const bought = h?.bought[0];
                            if (!sold && !bought) return null;
                            return (
                              <span className="mt-0.5 block text-micro leading-relaxed text-muted">
                                {sold ? (
                                  <Link
                                    href={`/documents/${sold.documentId}`}
                                    className={
                                      sold.sameClient
                                        ? "text-accent-ink hover:underline"
                                        : "hover:underline"
                                    }
                                  >
                                    {t("offer.lastTime.sold", {
                                      price: money(sold.unitPrice),
                                      client: sold.client,
                                      on: sold.issuedOn ? day.format(new Date(sold.issuedOn)) : "—",
                                    })}
                                  </Link>
                                ) : null}
                                {sold && bought && seesMargin ? " · " : null}
                                {bought && seesMargin
                                  ? t("offer.lastTime.bought", {
                                      price: money(bought.price),
                                      supplier: bought.supplier ?? t("offer.lastTime.us"),
                                      on: day.format(bought.capturedAt),
                                    }) + (bought.isVerbal ? ` (${t("offer.lastTime.verbal")})` : "")
                                  : null}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-muted">
                          {Number(line.qty ?? 0)}
                        </td>
                        {seesMargin ? (
                          <>
                            <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                              {line.unitCost ? money(line.unitCost) : "—"}
                              {/* A cost from June is a cost from June: say so
                                  where the figure is, not in a tooltip. */}
                              {line.costSource === "previous_offer" ? (
                                <span className="block text-micro text-warning-ink">
                                  {t("offer.costSource.previous_offer")}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2.5 pe-4 text-end">
                              {pct === null ? (
                                // No cost, so no margin — and no invented one.
                                <span className="text-muted">—</span>
                              ) : (
                                <Badge tone={Number(pct) <= 0 ? "critical" : "neutral"}>
                                  {pct}%
                                </Badge>
                              )}
                            </td>
                          </>
                        ) : null}
                        <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                          {line.unitPrice ? money(line.unitPrice) : "—"}
                        </td>
                        <td className="py-2.5 pe-5 text-end tabular-nums text-ink">
                          {total ? money(total) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {seesMargin && !issued ? (
              <form
                action={applyMarginAction.bind(null, locale, id)}
                className="flex flex-wrap items-end gap-2 border-t border-line-subtle px-5 py-3.5"
              >
                <label>
                  <span className="text-micro text-secondary">{t("offer.applyMargin")}</span>
                  <input
                    name="marginPct"
                    inputMode="decimal"
                    defaultValue="20"
                    className={`${INPUT} mt-1 w-[120px] text-end tabular-nums`}
                  />
                </label>
                <Button type="submit" variant="secondary">
                  {t("offer.applyToAll")}
                </Button>
                <span className="text-micro text-muted">{t("offer.applyHint")}</span>
              </form>
            ) : null}
          </section>

          {!issued ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("offer.setOneLine")}</h2>
              <form
                action={setLineAction.bind(null, locale, id)}
                className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4"
              >
                <label className="sm:col-span-2">
                  <span className="text-micro text-secondary">{t("offer.line")}</span>
                  <select name="lineId" className={`${INPUT} mt-1`}>
                    {offer.lines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.position} — {line.designation}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("offer.unitPrice")}</span>
                  <input
                    name="unitPrice"
                    inputMode="decimal"
                    className={`${INPUT} mt-1 text-end tabular-nums`}
                  />
                </label>
                {seesMargin ? (
                  <label>
                    <span className="text-micro text-secondary">{t("offer.orMarginPct")}</span>
                    <input
                      name="marginPct"
                      inputMode="decimal"
                      className={`${INPUT} mt-1 text-end tabular-nums`}
                    />
                  </label>
                ) : null}
                <div className="sm:col-span-4 flex justify-end">
                  <Button type="submit" variant="secondary">
                    {t("offer.saveLine")}
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("offer.submission")}</h2>
              <span className="ms-auto text-micro text-muted">{t("offer.submissionHint")}</span>
            </div>

            {/*
              Submitting is NOT issuing. Issuing allocates a number under LAW 5;
              submitting records that the envelope was handed over at the bureau
              des achats with a receipt. An offer can be issued and never
              submitted — which is exactly what happens when the deposit window
              is missed.
            */}
            <form
              action={markSubmittedAction.bind(null, locale, id)}
              className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              <label>
                <span className="text-micro text-secondary">{t("offer.submittedAt")}</span>
                <input type="datetime-local" name="when" className={`${INPUT} mt-1`} />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("offer.place")}</span>
                <input
                  name="place"
                  defaultValue={offer.submission.place ?? ""}
                  placeholder="Bureau des achats, In Salah"
                  className={`${INPUT} mt-1`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("offer.proofRef")}</span>
                <input
                  name="proofRef"
                  defaultValue={offer.submission.proofRef ?? ""}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <div className="sm:col-span-3 flex items-center gap-3">
                {offer.submission.submittedAt ? (
                  <p className="text-micro text-muted">
                    {t("offer.submittedOn", {
                      when: when.format(new Date(offer.submission.submittedAt)),
                    })}
                  </p>
                ) : null}
                <div className="ms-auto">
                  <Button type="submit" variant="primary">
                    {t("offer.markSubmitted")}
                  </Button>
                </div>
              </div>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("offer.totals")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {seesMargin ? (
                <div className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t("offer.totalCost")}</dt>
                  <dd className="ms-auto tabular-nums text-ink">
                    {money(offer.summary.totalCost)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("offer.totalExcl")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{money(offer.summary.totalExcl)}</dd>
              </div>
              {seesMargin ? (
                <div className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t("offer.margin")}</dt>
                  <dd className="ms-auto">
                    <Badge tone={Number(offer.summary.margin) <= 0 ? "critical" : "good"}>
                      {money(offer.summary.margin)}
                      {offer.summary.marginPct ? ` · ${offer.summary.marginPct}%` : ""}
                    </Badge>
                  </dd>
                </div>
              ) : null}
            </dl>

            {seesMargin && offer.summary.linesWithoutCost > 0 ? (
              // The number that keeps the percentage honest. Without it, a
              // margin computed over four lines of six looks like the margin on
              // the offer.
              <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro leading-relaxed text-warning-ink">
                {t("offer.someLinesUncosted", { n: offer.summary.linesWithoutCost })}
              </p>
            ) : null}

            {seesMargin && offer.summary.linesAtOrBelowCost > 0 ? (
              <p className="mt-2 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro leading-relaxed text-critical-ink">
                {t("offer.linesAtOrBelowCost", { n: offer.summary.linesAtOrBelowCost })}
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("offer.numbering")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("offer.thisNumber")}</dt>
                <dd className="ms-auto text-ink">
                  {offer.document.number ?? t("offer.noNumberYet")}
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("offer.reserved")}</dt>
                <dd className="ms-auto">
                  {/*
                    LAW 5 on screen. A number is allocated at issue and never
                    reserved on a draft, because a reserved number that is never
                    used is a gap nobody can explain to an inspector.
                  */}
                  <Badge tone={issued ? "good" : "neutral"}>
                    {issued ? t("offer.allocated") : t("offer.notReserved")}
                  </Badge>
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("offer.beforeYouSubmit")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("offer.nChecks", { n: offer.checks.length })}
              </span>
            </div>

            <ul className="mt-3 flex flex-col gap-2">
              {offer.checks.map((check) => (
                <li key={check.key}>
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 text-tiny text-ink">
                      {t(`offer.check.${check.key}`)}
                    </p>
                    <Badge tone={CHECK_TONE[check.state]}>{t(`offer.state.${check.state}`)}</Badge>
                  </div>
                  {check.detail && t.has(`offer.checkDetail.${check.key}`) ? (
                    <p className="mt-0.5 text-micro leading-relaxed text-muted">
                      {t(`offer.checkDetail.${check.key}`, check.detail)}
                    </p>
                  ) : null}
                  {check.fixHref ? (
                    <Link
                      href={check.fixHref}
                      className="mt-1 inline-block text-micro text-accent-ink hover:underline"
                    >
                      {t("offer.fixIt")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>

            <p className="mt-3 text-micro leading-relaxed text-muted">
              {ready
                ? t("offer.nothingBlocking")
                : t("offer.blockersRemain", { n: counts.blockers })}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
