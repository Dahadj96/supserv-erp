"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INSTRUMENTS, type Instrument, rulesFor, toCheck } from "@/domain/money/instruments";
import { Link } from "@/i18n/navigation";

/**
 * Screen 19 — the form, and the two cards that answer questions about whatever
 * is currently selected in it.
 *
 * Of the domain, this file imports only `instruments.ts`, which touches no
 * database and imports nothing that does. That is
 * the rule `tests/unit/client-bundle.test.ts` enforces and the reason
 * `capture/reading.ts` was split off `capture/quick.ts`: a client component
 * that reaches a module importing `@/db` drags `postgres` and `node:tls` into
 * the browser bundle, and the page five-hundreds on every render while
 * typecheck and the whole suite stay green.
 *
 * Everything the form needs about invoices arrives as plain data, already
 * computed and already formatted by the server — including the ages, so that
 * nothing here reads a clock the server did not read.
 */

export type InvoiceChoice = {
  documentId: string;
  number: string;
  clientName: string;
  currency: string;
  /** Raw, for arithmetic. */
  balance: string;
  /** Formatted on the server, so both sides show the same string. */
  totalFmt: string;
  paidFmt: string;
  balanceFmt: string;
  dueFmt: string | null;
  ageDays: number;
};

export function RecordPayment({
  invoices,
  confirmedCodes,
  today,
  action,
  quarter,
  children,
}: {
  invoices: InvoiceChoice[];
  /** Compliance-profile rule codes somebody has actually confirmed. */
  confirmedCodes: string[];
  /** ISO date, from the server's clock. */
  today: string;
  action: (form: FormData) => void;
  quarter: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("payments");

  const [documentId, setDocumentId] = useState(invoices[0]?.documentId ?? "");
  const [method, setMethod] = useState<Instrument>("virement");
  const [amount, setAmount] = useState("");

  const invoice = invoices.find((i) => i.documentId === documentId) ?? invoices[0] ?? null;
  const currency = invoice?.currency ?? "DZD";

  const confirmed = useMemo(() => new Set(confirmedCodes), [confirmedCodes]);

  // Partial means "leaves a balance". Typed nothing yet is not partial — it is
  // nothing typed, and lighting up a warning before somebody has entered a
  // figure teaches them to ignore it.
  const entered = Number(amount.replace(/\s/g, "").replace(",", "."));
  const partial =
    invoice !== null &&
    Number.isFinite(entered) &&
    entered > 0 &&
    entered + 0.005 < Number(invoice.balance);

  const rules = rulesFor({ method, currency, partial, confirmed });
  const mustCheck = toCheck(rules);

  return (
    <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 pb-8 md:grid-cols-3 md:px-7">
      <div className="flex flex-col gap-5 md:col-span-2">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("record")}</h2>
            <span className="ms-auto text-micro text-muted">{t("partialAllowed")}</span>
          </div>

          {invoices.length === 0 ? (
            <p className="px-5 py-4 text-tiny text-muted">{t("nothingToSettle")}</p>
          ) : (
            <form action={action} className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="text-micro text-secondary">{t("invoice")}</span>
                <select
                  name="documentId"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  className={`${INPUT} mt-1`}
                >
                  {invoices.map((i) => (
                    <option key={i.documentId} value={i.documentId}>
                      {i.number} — {i.clientName} · {i.balanceFmt}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-micro text-secondary">{t("amountReceived")}</span>
                <input
                  name="amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={`${INPUT} mt-1 tabular-nums`}
                />
              </label>

              <label>
                <span className="text-micro text-secondary">{t("date")}</span>
                {/* Defaults to today and is editable, because money arrives on
                    the day the bank says, not the day somebody gets to it. */}
                <input
                  type="date"
                  name="receivedOn"
                  defaultValue={today}
                  className={`${INPUT} mt-1`}
                />
              </label>

              <label>
                <span className="text-micro text-secondary">{t("instrument")}</span>
                <select
                  name="method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as Instrument)}
                  className={`${INPUT} mt-1`}
                >
                  {INSTRUMENTS.map((key) => (
                    <option key={key} value={key}>
                      {t(`instrumentName.${key}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-micro text-secondary">{t("reference")}</span>
                {/* The bank's own reference, kept verbatim. It is how this row
                    is matched to a line on the statement. */}
                <input name="bankRef" className={`${INPUT} mt-1 font-mono`} />
              </label>

              <input type="hidden" name="currency" value={currency} />

              <label className="sm:col-span-2">
                <span className="text-micro text-secondary">{t("note")}</span>
                <input name="note" className={`${INPUT} mt-1`} />
              </label>

              {mustCheck.length > 0 ? (
                <p className="sm:col-span-2 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro leading-relaxed text-warning-ink">
                  {mustCheck.map((rule) => t(`rule.${rule.key}.warning`)).join(" ")}
                </p>
              ) : null}

              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                <p className="text-micro text-muted">{t("recordsWhatHappened")}</p>
                <div className="ms-auto">
                  <Button type="submit" variant="primary">
                    {t("record")}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </section>

        {children}
      </div>

      <div className="flex flex-col gap-5">
        {invoice ? (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("thisInvoice")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("invoice")}>
                <span className="font-mono text-micro text-ink">{invoice.number}</span>
              </Row>
              <Row label={t("client")}>
                <span className="text-ink">{invoice.clientName}</span>
              </Row>
              <Row label={t("totalIncl")}>
                <span className="tabular-nums text-ink">{invoice.totalFmt}</span>
              </Row>
              <Row label={t("alreadyPaid")}>
                <Badge tone="good">{invoice.paidFmt}</Badge>
              </Row>
              <Row label={t("remaining")}>
                <Badge tone={Number(invoice.balance) > 0 ? "warning" : "good"}>
                  {invoice.balanceFmt}
                </Badge>
              </Row>
              <Row label={t("dueDate")}>
                <span className="text-ink">{invoice.dueFmt ?? "—"}</span>
              </Row>
              <Row label={t("daysOutstanding")}>
                {/* Age since ISSUE, the same clock screen 20's buckets use. */}
                <Badge tone={invoice.ageDays > 90 ? "critical" : "accent"}>
                  {t("nDays", { n: invoice.ageDays })}
                </Badge>
              </Row>
            </dl>
          </section>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("rulesThatApply")}</h2>
          <dl className="mt-3 flex flex-col gap-2.5 text-tiny">
            {rules.map((rule) => (
              <div key={rule.key} className="flex items-baseline gap-3">
                <dt
                  className={`min-w-0 ${rule.active ? "font-medium text-ink" : "text-secondary"}`}
                >
                  {t(`rule.${rule.key}.label`)}
                </dt>
                <dd className="ms-auto shrink-0">
                  <Badge
                    tone={
                      rule.state === "check"
                        ? "warning"
                        : rule.state === "applies"
                          ? "accent"
                          : "good"
                    }
                  >
                    {t(`rule.${rule.key}.${rule.state}`)}
                  </Badge>
                </dd>
              </div>
            ))}
          </dl>
          {/*
            The frame states three of these as law. Screen 69 forbids that:
            the software enforces rules, it does not assert that they are the
            law. Anything nobody has confirmed says so and links to where it
            can be confirmed.
          */}
          {rules.some((r) => r.state === "check") ? (
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("unconfirmedRules")}{" "}
              {/* Locale-aware, because `localePrefix` is "always" and a bare
                  href would bounce a French user through a redirect. */}
              <Link href="/settings/compliance" className="text-accent-ink hover:underline">
                {t("settleThem")}
              </Link>
            </p>
          ) : null}
        </section>

        {quarter}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="min-w-0 truncate text-secondary">{label}</dt>
      <dd className="ms-auto shrink-0">{children}</dd>
    </div>
  );
}
