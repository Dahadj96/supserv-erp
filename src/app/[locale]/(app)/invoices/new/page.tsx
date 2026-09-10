import { eq, sql } from "drizzle-orm";
import { Check, CircleHelp, Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { db } from "@/db";
import { bankAccount, companyIdentity } from "@/db/schema/company";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { type BillableSource, type BillScope, billable, billableSources } from "@/documents/bill";
import { check } from "@/documents/compliance";
import { peekNumber } from "@/documents/numbering";
import { formatMoney } from "@/domain/money";
import { Link } from "@/i18n/navigation";
import { billAction } from "./actions";

/**
 * Screen 72 — New invoice, from something that already exists.
 *
 * "Most of this is already known · check it rather than type it."
 *
 * The carried-over table is the screen, and its right-hand column is the point:
 * every row says WHERE the value came from — the party master, the source
 * document, settings, the client. Only the rows that say "ask" are a person's
 * to answer. A form of thirteen empty fields would be retyping thirteen things
 * the system already knows, and every one of them a chance to differ from what
 * was agreed.
 *
 * TWO DEPARTURES FROM THE FRAME.
 *
 * Its header offers "Issue the invoice" directly. This creates a DRAFT and
 * sends you to screen 18 to issue it. Issuing reserves a number and runs the
 * compliance profile; that happens in exactly one place, and a facture is
 * uneditable the instant it exists (LAW 5) — worth one more click.
 *
 * Its lifecycle strip draws Draft, Issued, Part paid, Paid as four states. Two
 * of them are stored and two are computed from payment allocations, and the
 * strip below says which is which. The frame's own note makes the same point
 * about overdue; this extends it one step, because a "Paid" chip beside a
 * "Draft" chip invites somebody to store all four.
 */
export const dynamic = "force-dynamic";

const DEFAULT_TERMS_DAYS = 30;

export default async function NewInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string; scope?: string; error?: string; all?: string }>;
}) {
  const { locale } = await params;
  const { source, scope: rawScope, error, all } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  /*
    THE WRONG FORM, AND WHAT IT ACTUALLY WAS.

    This line read `if (!source) hardRedirect('/documents/new')`. So pressing
    "New invoice" on screen 17 — whose button linked at `/documents/new`
    directly, and would have arrived here at the same place anyway — opened the
    generic builder: twenty-two document kinds with Quotation ticked, because
    it ticks the first kind the person may issue when the query string does not
    say otherwise.

    The invoice-specific form was already here. It was reachable only from a
    document that already knew it was the source, so the one button labelled
    "New invoice" could never open it.

    Now the bare route asks which order is being invoiced, and the answer is
    what makes the carried-over table below possible. "Nothing to start from"
    is still a legitimate answer and still goes to the blank builder — with
    `?kind=invoice`, so the kind a person asked for is the kind that is ticked.
  */
  if (!source) {
    const openOnly = all !== "1";
    const sources = await billableSources({ openOnly });
    return <SourcePicker locale={locale} sources={sources} openOnly={openOnly} />;
  }

  const scope: BillScope = rawScope === "remaining" ? "remaining" : "delivered";

  const [doc] = await db
    .select({
      id: document.id,
      kind: document.kind,
      number: document.number,
      locale: document.locale,
      currency: document.currency,
      partyId: document.partyId,
      totals: document.totals,
      settlement: document.settlement,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(eq(document.id, source))
    .limit(1);
  if (!doc) notFound();

  const [counterparty] = await db.select().from(party).where(eq(party.id, doc.partyId)).limit(1);
  const [company] = await db.select().from(companyIdentity).limit(1);
  const [bank] = await db
    .select()
    .from(bankAccount)
    .where(eq(bankAccount.isDefault, true))
    .limit(1);

  const lines = await billable({ sourceId: doc.id, scope });
  const open = lines.filter((line) => Number(line.billable) > 0);
  const deliveredLines = lines.filter((line) => Number(line.delivered) > 0).length;

  const findings = await check({
    kind: "invoice",
    company: company ?? null,
    counterparty: counterparty ?? null,
    total: Number((doc.totals as { totalIncl?: string })?.totalIncl ?? "0"),
    settlementInCash: doc.settlement === "especes",
    stampDuty: Number((doc.totals as { stampDuty?: string })?.stampDuty ?? "0"),
  });
  const blockers = findings.filter((f) => f.severity === "block");

  const today = new Date();
  const invoiceDate = today.toISOString().slice(0, 10);
  const dueDate = new Date(today.getTime() + DEFAULT_TERMS_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const preview = await peekNumber("invoice", today);

  const money = (amount: string) => formatMoney(amount, { locale, currency: doc.currency });
  const total = open.reduce(
    (sum, line) => sum + Number(line.billable) * Number(line.unitPrice ?? "0"),
    0,
  );

  /** Every row, its value, and where the value came from. */
  const carried: { key: string; value: string; from: string; ask?: boolean }[] = [
    { key: "client", value: doc.clientName, from: "partyMaster" },
    {
      key: "billingAddress",
      value: counterparty?.address ?? t("newInvoice.notRecorded"),
      from: "partyMaster",
    },
    {
      key: "identifiers",
      value:
        counterparty?.nif && counterparty?.nis && counterparty?.rc
          ? t("newInvoice.allThree")
          : t("newInvoice.someMissing"),
      from: "partyMaster",
    },
    { key: "source", value: doc.number ?? "—", from: "theSource" },
    {
      key: "lines",
      value: t("newInvoice.nOfM", { n: deliveredLines, m: lines.length }),
      from: "sourceAndBLs",
    },
    {
      key: "bank",
      value: bank
        ? `${bank.bankName}${bank.agency ? ` — ${bank.agency}` : ""}`
        : t("newInvoice.notSetUp"),
      from: "settings",
    },
    {
      key: "language",
      // LAW 4 — the document follows the counterparty, not the person typing.
      value: doc.locale.toUpperCase(),
      from: "theClientNotYou",
    },
    { key: "invoiceDate", value: invoiceDate, from: "ask", ask: true },
    {
      key: "whichLines",
      value: t("newInvoice.deliveredOrAll", { n: deliveredLines, m: lines.length }),
      from: "ask",
      ask: true,
    },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">
            {t("newInvoice.title", { number: doc.number ?? "—" })}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {doc.clientName} · {t("newInvoice.checkDontRetype")}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link href={`/documents/${doc.id}`} className="text-tiny text-secondary hover:underline">
            {t("newInvoice.cancel")}
          </Link>
        </div>
      </div>

      {deliveredLines > 0 && deliveredLines < lines.length ? (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-good bg-good-bg px-4 py-3 md:mx-7">
          <Info className="size-4 shrink-0 text-good-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-tiny leading-relaxed text-good-ink">
            {t("newInvoice.partialBanner", { n: deliveredLines, m: lines.length })}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`newInvoice.error.${error}`) ? t(`newInvoice.error.${error}`) : error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 pt-5 md:px-7">
        {(["delivered", "remaining"] as const).map((key) => (
          <Link key={key} href={`/invoices/new?source=${doc.id}&scope=${key}`}>
            <span
              className={`inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-1 text-micro font-medium ${
                scope === key ? "bg-ink text-on-ink" : "bg-chip text-secondary hover:bg-sunken"
              }`}
            >
              {t(`newInvoice.scope.${key}`)}
            </span>
          </Link>
        ))}
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.carried")}</h2>
              <span className="ms-auto text-micro text-muted">{t("newInvoice.fromWhere")}</span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {carried.map((row) => (
                  <tr key={row.key} className="border-b border-line-subtle last:border-0">
                    <td className="w-[1%] py-2.5 ps-5 pe-3">
                      {row.ask ? (
                        <CircleHelp className="size-3.5 text-warning-ink" aria-hidden />
                      ) : (
                        <Check className="size-3.5 text-good-ink" aria-hidden />
                      )}
                    </td>
                    <td className="py-2.5 pe-4 text-secondary">{t(`newInvoice.row.${row.key}`)}</td>
                    <td className="py-2.5 pe-4 text-ink">{row.value}</td>
                    <td className="py-2.5 pe-5 text-end text-micro text-muted">
                      {t(`newInvoice.from.${row.from}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.linesToInvoice")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("newInvoice.editBeforeIssuing")}
              </span>
            </div>

            <form action={billAction.bind(null, locale, doc.id)}>
              <input type="hidden" name="scope" value={scope} />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">#</th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("newInvoice.designation")}
                      </th>
                      <th className="py-2 pe-4 text-end font-medium">{t("newInvoice.ordered")}</th>
                      <th className="py-2 pe-4 text-end font-medium">
                        {t("newInvoice.delivered")}
                      </th>
                      <th className="py-2 pe-4 text-end font-medium">
                        {t("newInvoice.alreadyInvoiced")}
                      </th>
                      <th className="py-2 pe-4 text-end font-medium">
                        {t("newInvoice.unitPrice")}
                      </th>
                      <th className="py-2 pe-5 text-end font-medium">
                        {t("newInvoice.thisInvoice")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.lineId} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-muted">{line.position}</td>
                        <td className="max-w-[240px] truncate py-2.5 pe-4 text-ink">
                          {line.designation ?? "—"}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                          {line.ordered}
                        </td>
                        <td className="py-2.5 pe-4 text-end">
                          {Number(line.delivered) > 0 ? (
                            <Badge tone="good">{line.delivered}</Badge>
                          ) : (
                            <span className="text-micro text-muted">
                              {t("newInvoice.notDelivered")}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                          {line.alreadyInvoiced}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                          {line.unitPrice ? money(line.unitPrice) : "—"}
                        </td>
                        <td className="py-2.5 pe-5 text-end">
                          <input
                            name={`qty:${line.lineId}`}
                            inputMode="decimal"
                            defaultValue={line.billable}
                            className={`${INPUT} w-24 text-end tabular-nums`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-end gap-4 border-t border-line-subtle px-5 py-4">
                <label>
                  <span className="text-micro text-secondary">{t("newInvoice.invoiceDate")}</span>
                  <input
                    type="date"
                    name="invoiceDate"
                    defaultValue={invoiceDate}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("newInvoice.dueDate")}</span>
                  <input
                    type="date"
                    name="dueDate"
                    defaultValue={dueDate}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <p className="min-w-0 flex-1 text-micro leading-relaxed text-muted">
                  {t("newInvoice.createsADraft")}
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  disabledReason={open.length === 0 ? t("newInvoice.nothingLeft") : undefined}
                >
                  {t("newInvoice.create")}
                </Button>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.lifecycle")}</h2>
              <span className="ms-auto text-micro text-muted">{t("newInvoice.sameMachine")}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["draft", "issued"] as const).map((key) => (
                <Badge key={key} tone="neutral">
                  {t(`invoices.state.${key === "issued" ? "unpaid" : key}`)}
                </Badge>
              ))}
              {(["partPaid", "paid"] as const).map((key) => (
                <Badge key={key} tone="accent">
                  {t(`invoices.state.${key}`)}
                </Badge>
              ))}
            </div>
            {/*
              The frame draws all four as one row of states. Two of them are
              stored on the document; two are arithmetic over payment
              allocations and change without anybody touching it.
            */}
            <p className="mt-3 text-micro leading-relaxed text-secondary">
              {t("newInvoice.lifecycleNote")}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.totals")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("newInvoice.totalExcl")}>
                <span className="tabular-nums text-ink">{money(total.toFixed(2))}</span>
              </Row>
              <Row label={t("newInvoice.linesChosen")}>
                <span className="text-ink">
                  {t("newInvoice.nOfM", { n: open.length, m: lines.length })}
                </span>
              </Row>
              <Row label={t("newInvoice.stampDuty")}>
                {/* Nobody has confirmed the threshold or the rate. */}
                <span className="text-muted">{t("newInvoice.atSettlement")}</span>
              </Row>
              <Row label={t("newInvoice.dueDate")}>
                <span className="text-ink">{dueDate}</span>
              </Row>
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.numbering")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("newInvoice.nextAvailable")}>
                <span className="font-mono text-micro text-ink">
                  {preview ?? t("newInvoice.notSetUp")}
                </span>
              </Row>
              <Row label={t("newInvoice.reserved")}>
                <Badge tone="accent">{t("newInvoice.onIssueOnly")}</Badge>
              </Row>
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("newInvoice.numberingNote")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.beforeIssuing")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("newInvoice.fromYourProfile")}
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-2 text-tiny">
              {findings.map((finding) => (
                <li key={finding.code} className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-secondary">
                    {t.has(`rules.${finding.code}`) ? t(`rules.${finding.code}`) : finding.code}
                  </span>
                  <Badge
                    tone={
                      finding.severity === "block"
                        ? "critical"
                        : finding.severity === "warn"
                          ? "warning"
                          : "good"
                    }
                  >
                    {t(`convert.severity.${finding.severity}`)}
                  </Badge>
                </li>
              ))}
            </ul>
            {blockers[0]?.fixRoute ? (
              <Link
                href={blockers[0].fixRoute}
                className="mt-3 inline-block text-micro text-accent-ink hover:underline"
              >
                {t("convert.fixIt")}
              </Link>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="min-w-0 text-secondary">{label}</dt>
      <dd className="ms-auto shrink-0">{children}</dd>
    </div>
  );
}

/**
 * Step zero — which order is being invoiced.
 *
 * The frame's own first question, drawn as its four chips: an order, an offer,
 * a situation, or nothing. Three of them were grey with "orders arrive in phase
 * 5" written underneath. Orders arrived. So they are rows now, with the figures
 * that decide between them — ordered, already invoiced, left to bill — and the
 * fourth is a link to the blank builder with Invoice already chosen.
 */
async function SourcePicker({
  locale,
  sources,
  openOnly,
}: {
  locale: string;
  sources: BillableSource[];
  openOnly: boolean;
}) {
  const t = await getTranslations();
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const kindName = (kind: string) =>
    t.has(`docTypes.kind.${kind}`) ? t(`docTypes.kind.${kind}`) : kind;

  /*
    The escape hatch, and it is a real one: a direct invoice with no order
    behind it happens — a job priced and done on the same visit. It goes to the
    blank builder carrying the kind, which is the whole difference between
    "New invoice" and what this screen used to do.
  */
  const blank = (
    <Link href="/documents/new?kind=invoice">
      <Button variant="secondary">{t("newInvoice.startBlank")}</Button>
    </Link>
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">{t("newInvoice.pickSourceTitle")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("newInvoice.pickSourceSubtitle")}</p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          {blank}
          <Link href="/invoices" className="text-tiny text-secondary hover:underline">
            {t("newInvoice.cancel")}
          </Link>
        </div>
      </div>

      <div className="max-w-[1100px] px-4 py-5 md:px-7">
        {sources.length === 0 ? (
          <StateBlock
            title={openOnly ? t("newInvoice.nothingOpenTitle") : t("newInvoice.noSourcesTitle")}
            body={openOnly ? t("newInvoice.nothingOpen") : t("newInvoice.noSources")}
            action={
              openOnly ? (
                <Link href="/invoices/new?all=1">
                  <Button variant="secondary">{t("newInvoice.showAllSources")}</Button>
                </Link>
              ) : (
                blank
              )
            }
          />
        ) : (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.whatToBill")}</h2>
              <span className="ms-auto text-micro text-muted">
                {openOnly ? t("newInvoice.openOnlyNote") : t("newInvoice.allSourcesNote")}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">{t("invoices.col.number")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("invoices.col.client")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("invoices.col.issued")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deliveries.lines")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("newInvoice.ordered")}</th>
                    <th className="py-2 pe-4 text-end font-medium">
                      {t("newInvoice.alreadyInvoiced")}
                    </th>
                    <th className="py-2 pe-4 text-end font-medium">{t("newInvoice.leftToBill")}</th>
                    <th className="py-2 pe-5 text-end font-medium">
                      <span className="sr-only">{t("newInvoice.pickThisOne")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((row) => (
                    <tr key={row.documentId} className="border-b border-line-subtle last:border-0">
                      <td className="py-2.5 ps-5">
                        <span className="font-mono text-micro font-medium text-ink">
                          {row.number ?? t("invoices.noNumber")}
                        </span>
                        <span className="ms-2 text-micro text-muted">{kindName(row.kind)}</span>
                      </td>
                      <td className="py-2.5 pe-4 text-secondary">{row.clientName}</td>
                      <td className="py-2.5 pe-4 text-muted">
                        {row.issuedOn ? day.format(row.issuedOn) : "—"}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-ink">{row.lines}</td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                        {row.ordered}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                        {row.invoiced}
                      </td>
                      <td className="py-2.5 pe-4 text-end">
                        <Badge tone={Number(row.remaining) > 0 ? "warning" : "good"}>
                          {row.remaining}
                        </Badge>
                      </td>
                      <td className="py-2.5 pe-5 text-end">
                        <Link href={`/invoices/new?source=${row.documentId}`}>
                          <Button variant="secondary" size="small">
                            {t("newInvoice.pickThisOne")}
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("newInvoice.carriedForward")}
            </p>
          </section>
        )}

        {openOnly && sources.length > 0 ? (
          <p className="mt-3 text-micro text-muted">
            <Link href="/invoices/new?all=1" className="text-accent-ink hover:underline">
              {t("newInvoice.showAllSources")}
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}
