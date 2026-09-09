import { Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDeal } from "@/domain/deal/deal";
import { quotesFor } from "@/domain/deal/price-store";
import { bestFor, coverageOf, firmnessOf, PRICE_SOURCES, riskOf } from "@/domain/deal/prices";
import { formatMoney } from "@/domain/money";
import { Link } from "@/i18n/navigation";
import { addPriceAction } from "./actions";

/**
 * Screen 74 — Prices.
 *
 * "Prices come from wherever you found them." Half this company's buying
 * happens over a counter in Adrar, and a system that only accepts prices from
 * emails is a system people keep a notebook beside.
 *
 * Everything on the right-hand side is computed on load — coverage, the verbal
 * count, the lines whose price expires before the client is likely to answer.
 * None of it is stored, and none of it blocks anything: the offer still goes
 * out, and the risk is on the screen BEFORE it does rather than in September.
 */
export const dynamic = "force-dynamic";

const FIRMNESS_TONE = { written: "good", verbal: "warning", internal: "accent" } as const;

export default async function PricesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; line?: string }>;
}) {
  const { locale, id } = await params;
  const { error, saved, line } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const found = await getDeal(id);
  if (!found) notFound();

  const quotes = await quotesFor(id);
  const lineIds = found.lines.map((l) => l.id);
  const coverage = coverageOf(lineIds, quotes);
  const risk = riskOf({ lineIds, quotes, clientDeadline: found.deal.deadlineAt });

  const money = (amount: string, currency: string) => formatMoney(amount, { locale, currency });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
  });

  // The best price per line, so the table can mark it. Same function the offer
  // builder will use — one answer to "which price would we actually quote".
  const bestByLine = new Map<string, string>();
  for (const lineId of lineIds) {
    const best = bestFor(
      quotes.filter((q) => q.dealLineId === lineId),
      risk.decidesOn,
    );
    if (best) bestByLine.set(lineId, best.id);
  }

  const lineLabel = new Map(
    found.lines.map((l) => [l.id, `${l.position} — ${l.designation}`] as const),
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {t("prices.title", { ref: found.deal.ref })}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {t("prices.summary", {
              items: coverage.items,
              priced: coverage.withAnyPrice,
              open: coverage.noPriceYet,
            })}
          </p>
        </div>
        <Link className="ms-auto" href={`/deals/${id}`}>
          <Button variant="secondary">{t("prices.backToDeal")}</Button>
        </Link>
      </div>

      <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3 md:mx-7">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("prices.banner")}
        </p>
      </div>

      {saved ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          {t("prices.saved")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`prices.error.${error}`) ? t(`prices.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 md:grid-cols-3 md:px-7 md:py-6">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("prices.gathered")}</h2>
              <span className="ms-auto text-micro text-muted">{t("prices.bestHighlighted")}</span>
            </div>

            {quotes.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("prices.nonePlease")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">{t("prices.item")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("prices.whereFrom")}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t("prices.price")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("prices.gotOn")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("prices.holdsUntil")}</th>
                      <th className="py-2 pe-5 text-start font-medium">{t("prices.firm")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((quote) => {
                      const best = quote.dealLineId
                        ? bestByLine.get(quote.dealLineId) === quote.id
                        : false;
                      const firmness = firmnessOf(quote);
                      return (
                        <tr
                          key={quote.id}
                          className={`border-t border-line-subtle ${best ? "bg-good-bg/40" : ""}`}
                        >
                          <td className="max-w-[220px] truncate py-2.5 ps-5 text-ink">
                            {quote.dealLineId ? lineLabel.get(quote.dealLineId) : "—"}
                          </td>
                          <td className="py-2.5 pe-4">
                            <span className="text-secondary">
                              {t(`prices.source.${quote.source}`)}
                              {quote.supplierName ? ` — ${quote.supplierName}` : ""}
                            </span>
                            {quote.capturedPlace ? (
                              <span className="block text-micro text-muted">
                                {quote.capturedPlace}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                            {money(quote.price, quote.currency)}
                          </td>
                          <td className="py-2.5 pe-4 text-muted">{day.format(quote.capturedAt)}</td>
                          <td className="py-2.5 pe-4 text-muted">
                            {quote.validUntil ? day.format(quote.validUntil) : "—"}
                          </td>
                          <td className="py-2.5 pe-5">
                            <Badge tone={FIRMNESS_TONE[firmness]}>
                              {t(`prices.firmness.${firmness}`)}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("prices.addTitle")}</h2>
              <span className="ms-auto text-micro text-muted">{t("prices.addHint")}</span>
            </div>

            {found.lines.length === 0 ? (
              <p className="mt-3 text-tiny text-muted">{t("prices.noLinesYet")}</p>
            ) : (
              <form action={addPriceAction.bind(null, locale, id)} className="mt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label>
                    <span className="text-micro text-secondary">{t("prices.whereFrom")}</span>
                    <select name="source" defaultValue="shop_visit" className={`${INPUT} mt-1`}>
                      {PRICE_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {t(`prices.source.${source}`)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.item")}</span>
                    <select name="dealLineId" defaultValue={line ?? ""} className={`${INPUT} mt-1`}>
                      <option value="">—</option>
                      {found.lines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.position} — {l.designation}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.supplier")}</span>
                    <input name="supplierName" className={`${INPUT} mt-1`} />
                    {/*
                      The yellow note from the frame. A shop you walked into is a
                      supplier whether or not anybody typed it in, and refusing
                      the price until somebody fills in a company form is how the
                      price ends up on a scrap of paper.
                    */}
                    <span className="mt-1 block text-micro leading-relaxed text-muted">
                      {t("prices.supplierHint")}
                    </span>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.wherePlace")}</span>
                    <input
                      name="capturedPlace"
                      placeholder="Adrar centre, rue Emir Abdelkader"
                      className={`${INPUT} mt-1`}
                    />
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.spokeTo")}</span>
                    <input name="capturedFrom" className={`${INPUT} mt-1`} />
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.pricePerUnit")}</span>
                    <input
                      name="price"
                      inputMode="decimal"
                      className={`${INPUT} mt-1 text-end tabular-nums`}
                    />
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.writtenOrVerbal")}</span>
                    <select name="firmness" defaultValue="verbal" className={`${INPUT} mt-1`}>
                      <option value="written">{t("prices.firmness.written")}</option>
                      <option value="verbal">{t("prices.verbalNoDocument")}</option>
                    </select>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.vat")}</span>
                    {/*
                      Asked, never assumed. Suppliers quote both ways and the
                      difference is nineteen per cent — the whole margin.
                    */}
                    <select name="written" defaultValue="excl" className={`${INPUT} mt-1`}>
                      <option value="excl">{t("prices.excl")}</option>
                      <option value="incl">{t("prices.incl")}</option>
                    </select>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("prices.holdsUntil")}</span>
                    <input type="date" name="validUntil" className={`${INPUT} mt-1`} />
                  </label>

                  <label>
                    <span className="text-micro text-secondary">{t("deal.currency")}</span>
                    <input
                      name="currency"
                      defaultValue={found.deal.currency}
                      className={`${INPUT} mt-1`}
                    />
                  </label>
                </div>

                <div className="mt-4 flex justify-end">
                  <Button type="submit" variant="primary">
                    {t("prices.save")}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("prices.coverage")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(
                [
                  ["items", coverage.items, "neutral"],
                  ["withAnyPrice", coverage.withAnyPrice, "good"],
                  ["withTwoOrMore", coverage.withTwoOrMore, "good"],
                  [
                    "noPriceYet",
                    coverage.noPriceYet,
                    coverage.noPriceYet > 0 ? "critical" : "good",
                  ],
                  ["pricedByUs", coverage.pricedByUs, "accent"],
                  ["verbalOnly", coverage.verbalOnly, coverage.verbalOnly > 0 ? "warning" : "good"],
                ] as const
              ).map(([key, value, tone]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`prices.coverageRow.${key}`)}</dt>
                  <dd className="ms-auto">
                    <Badge tone={tone}>{value}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("prices.riskTitle")}</h2>
            {/*
              The frame's own sentence, with this enquiry's numbers in it. It
              blocks nothing — the offer still goes out. It puts the risk on the
              screen before it does, rather than in September when the supplier
              says the price has moved.
            */}
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {risk.decidesOn
                ? t("prices.riskBody", {
                    verbal: risk.verbal,
                    client: found.clientName,
                    when: day.format(risk.decidesOn),
                  })
                : t("prices.riskNoDeadline")}
            </p>

            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(
                [
                  ["firm", risk.firm, "good"],
                  ["verbal", risk.verbal, risk.verbal > 0 ? "warning" : "good"],
                  ["expiresFirst", risk.expiresFirst, risk.expiresFirst > 0 ? "critical" : "good"],
                ] as const
              ).map(([key, value, tone]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`prices.riskRow.${key}`)}</dt>
                  <dd className="ms-auto">
                    <Badge tone={tone}>{t("prices.nLines", { n: value })}</Badge>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("prices.stillOpen")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("prices.nItems", { n: coverage.noPriceYet })}
              </span>
            </div>
            {coverage.noPriceYet === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("prices.allPriced")}</p>
            ) : (
              <ul className="flex flex-col">
                {found.lines
                  .filter((l) => !quotes.some((q) => q.dealLineId === l.id))
                  .map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-tiny text-ink">
                        {l.designation}
                      </span>
                      <Link
                        href={`/deals/${id}/prices?line=${l.id}`}
                        className="shrink-0 text-micro text-accent-ink hover:underline"
                      >
                        {t("prices.addFor")}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
