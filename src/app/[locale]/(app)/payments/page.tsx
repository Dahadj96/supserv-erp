import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { profile } from "@/domain/compliance-profile";
import { formatMoney } from "@/domain/money";
import { ageingOf, ageOf, balanceOf } from "@/domain/money/ageing";
import { collectionOf } from "@/domain/money/collection";
import {
  allocationsFor,
  listPayments,
  owings,
  receivedSince,
  settlements,
} from "@/domain/money/store";
import { Link } from "@/i18n/navigation";
import { recordPaymentAction } from "./actions";
import { type InvoiceChoice, RecordPayment } from "./record-payment";

/**
 * Screen 19 — Payments.
 *
 * A payment is a thing that happened at the bank. It is not a field on an
 * invoice, and the whole screen is built on that: one transfer settles three
 * invoices, one invoice is settled by a deposit and a balance two months later,
 * and a `paid_amount` column makes both of those a lie while making the bank
 * reconciliation impossible.
 *
 * Everything shown here is computed at load — remaining balances, days
 * outstanding, average days to pay. Nothing is stored and refreshed by a job.
 */
export const dynamic = "force-dynamic";

/** The quarter `today` falls in, as an ISO date. */
function quarterStart(today: Date): string {
  const month = Math.floor(today.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(today.getUTCFullYear(), month, 1)).toISOString().slice(0, 10);
}

export default async function PaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; recorded?: string }>;
}) {
  const { locale } = await params;
  const { error, recorded } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const today = new Date();
  const from = quarterStart(today);

  const ledger = await owings();
  const ageing = ageingOf(ledger, today);
  const payments = await listPayments(50);
  const allocations = await allocationsFor(payments.map((p) => p.id));
  const collection = collectionOf({
    received: await receivedSince(from),
    stillToCollect: ageing.total,
    settlements: await settlements(),
    today,
  });

  // Only rules a person has actually confirmed count as settled. Everything
  // else the payment card shows as a question — screen 69's whole point.
  const confirmedCodes = (await profile()).filter((r) => r.confirmedOn).map((r) => r.code);

  const money = (amount: string, currency = "DZD") => formatMoney(amount, { locale, currency });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const iso = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`) : null);

  // What can still take money. A settled invoice is not offered, because
  // allocating against it would create a credit nobody asked for.
  const open = ledger.filter((o) => Number(balanceOf(o)) > 0);
  const invoices: InvoiceChoice[] = open
    .map((o) => ({
      documentId: o.documentId,
      number: o.number ?? "—",
      clientName: o.clientName,
      currency: o.currency,
      balance: balanceOf(o),
      totalFmt: money(o.totalIncl, o.currency),
      paidFmt: money(o.paid, o.currency),
      balanceFmt: money(balanceOf(o), o.currency),
      dueFmt: o.dueOn ? day.format(o.dueOn) : null,
      ageDays: ageOf(o.issuedOn, today),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  // Today's balance per invoice, for the "balance left" column.
  const balances = new Map(ledger.map((o) => [o.documentId, balanceOf(o)]));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">{t("payments.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("payments.subtitle", {
              n: collection.payments,
              received: money(collection.received),
            })}
          </p>
        </div>
        {/*
          The frame's header carries Export here. This carries the way to
          screen 20 instead, which is otherwise unreachable from the rail —
          and a person looking at what came in is one thought away from what
          has not.
        */}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link
            href="/payments/ageing"
            className="rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-tiny text-secondary hover:bg-plane"
          >
            {t("payments.seeAgeing")}
          </Link>
        </div>
      </div>

      {recorded ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          {t("payments.recorded")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`payments.error.${error}`) ? t(`payments.error.${error}`) : error}
        </p>
      ) : null}

      <div className="pt-5">
        <RecordPayment
          invoices={invoices}
          confirmedCodes={confirmedCodes}
          today={today.toISOString().slice(0, 10)}
          action={recordPaymentAction.bind(null, locale)}
          quarter={
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("payments.quarterToDate")}</h2>
              <dl className="mt-3 flex flex-col gap-2 text-tiny">
                <div className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t("payments.received")}</dt>
                  <dd className="ms-auto tabular-nums text-ink">{money(collection.received)}</dd>
                </div>
                <div className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t("payments.stillToCollect")}</dt>
                  <dd className="ms-auto">
                    <Badge tone={Number(collection.stillToCollect) > 0 ? "critical" : "good"}>
                      {money(collection.stillToCollect)}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t("payments.averageDaysToPay")}</dt>
                  <dd className="ms-auto">
                    {collection.averageDaysToPay === null ? (
                      <span className="text-muted">{t("payments.notYet")}</span>
                    ) : (
                      <Badge tone={collection.averageDaysToPay > 60 ? "warning" : "good"}>
                        {t("payments.nDays", { n: collection.averageDaysToPay })}
                      </Badge>
                    )}
                  </dd>
                </div>
                {collection.best ? (
                  <div className="flex items-baseline gap-3">
                    <dt className="text-secondary">{t("payments.bestPayer")}</dt>
                    <dd className="ms-auto">
                      <Badge tone="good">
                        {collection.best.clientName} —{" "}
                        {t("payments.nDays", { n: collection.best.averageDays })}
                      </Badge>
                    </dd>
                  </div>
                ) : null}
                {collection.worst ? (
                  <div className="flex items-baseline gap-3">
                    <dt className="text-secondary">{t("payments.worstPayer")}</dt>
                    <dd className="ms-auto">
                      <Badge tone="critical">
                        {collection.worst.clientName} —{" "}
                        {t("payments.nDays", { n: collection.worst.averageDays })}
                      </Badge>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {/*
                Unpaid invoices are counted in these averages, and the screen
                says so rather than presenting a number that is still moving as
                a finished one. Excluding them would rank the client who has
                never paid above the client who pays in ninety days.
              */}
              {collection.stillRunning > 0 ? (
                <p className="mt-3 text-micro leading-relaxed text-muted">
                  {t("payments.includesUnpaid", { n: collection.stillRunning })}
                </p>
              ) : null}
              {collection.otherCurrencies.length > 0 ? (
                <p className="mt-2 text-micro leading-relaxed text-warning-ink">
                  {t("payments.otherCurrencies", {
                    list: collection.otherCurrencies.join(", "),
                  })}
                </p>
              ) : null}
            </section>
          }
        >
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("payments.recent")}</h2>
              <span className="ms-auto text-micro text-muted">{t("payments.newestFirst")}</span>
            </div>

            {payments.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("payments.noneYet")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">{t("payments.date")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("payments.invoice")}</th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("payments.instrument")}
                      </th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("payments.reference")}
                      </th>
                      <th className="py-2 pe-4 text-end font-medium">{t("payments.amount")}</th>
                      <th className="py-2 pe-4 text-end font-medium">
                        {t("payments.balanceLeft")}
                      </th>
                      <th className="py-2 pe-5 text-end font-medium">{t("bin.remove")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((row) => {
                      const against = allocations.get(row.id) ?? [];
                      const held = Number(row.amount) - Number(row.allocated);
                      return (
                        <tr key={row.id} className="border-t border-line-subtle">
                          <td className="py-2.5 ps-5 text-muted">
                            {day.format(iso(row.receivedOn) ?? today)}
                          </td>
                          <td className="py-2.5 pe-4">
                            {against.length === 0 ? (
                              <span className="text-muted">{row.clientName}</span>
                            ) : (
                              <span className="flex flex-col">
                                {against.map((a) => (
                                  <span
                                    key={a.documentId}
                                    className="font-mono text-micro text-ink"
                                  >
                                    {a.number ?? "—"}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pe-4">
                            <Badge tone="accent">
                              {t(`payments.instrumentName.${row.method}`)}
                            </Badge>
                          </td>
                          <td className="py-2.5 pe-4 font-mono text-micro text-secondary">
                            {row.bankRef ?? "—"}
                          </td>
                          <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                            {money(row.amount, row.currency)}
                          </td>
                          <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                            {/*
                              The invoice's balance TODAY, not at the moment this
                              payment landed. A later payment moves it, and
                              showing a frozen figure beside a live one is how
                              two numbers on one screen disagree.
                            */}
                            {against.length === 0 ? (
                              <span className="text-muted">—</span>
                            ) : (
                              against.map((a) => (
                                <span key={a.documentId} className="block">
                                  {money(balances.get(a.documentId) ?? "0", row.currency)}
                                </span>
                              ))
                            )}
                            {held > 0.005 ? (
                              <span className="block text-micro text-warning-ink">
                                {t("payments.heldUnallocated", {
                                  amount: money(held.toFixed(2), row.currency),
                                })}
                              </span>
                            ) : null}
                          </td>
                          {/*
                            PRESENT AND GREY, AND IT WILL NEVER BE ANYTHING ELSE.

                            A payment is a thing that happened at the bank. It is
                            not a row somebody typed and may untype: the money
                            arrived, the statement says so, and a system where
                            what arrived can be made to disappear is a system
                            nobody can reconcile against a bank.

                            So this is not a control waiting on a feature. It is
                            the refusal, said where somebody looks for the
                            button — with what to do instead, because a wrong
                            amount and a wrong allocation are two different
                            mistakes with two different answers.
                          */}
                          <td className="py-2.5 pe-5 text-end">
                            <Button
                              variant="ghost"
                              size="small"
                              disabledReason={t("payments.neverRemoved")}
                            >
                              {t("bin.remove")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </RecordPayment>
      </div>
    </main>
  );
}
