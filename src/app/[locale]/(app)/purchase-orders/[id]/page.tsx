import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import type { Verdict } from "@/domain/purchase/match";
import { purchaseOrder } from "@/domain/purchase/order";
import { payables } from "@/domain/purchase/store";
import { Link } from "@/i18n/navigation";
import { RecordPanels } from "./record";

/**
 * Screen 68 — Supplier order.
 *
 * "This is the leg that was missing. Without it the client delivery date is a
 * guess and the margin is whatever the supplier decides to invoice." The frame
 * says so in its own last panel, and it is right.
 *
 * Everything on this page is computed at draw time from three documents and
 * their lines. There is no purchase-order table, no received quantity column
 * and no matched flag — LAW 1, in the place where a stored figure would be most
 * tempting and most dangerous, because the whole screen exists to catch numbers
 * that disagree.
 */
export const dynamic = "force-dynamic";

const VERDICT_TONE: Record<Verdict, "good" | "warning" | "critical"> = {
  matches: "good",
  explained: "warning",
  doesNotMatch: "critical",
};

const STATE_TONE = {
  complete: "good",
  partial: "warning",
  awaiting: "neutral",
  over: "warning",
} as const;

const BLOCK_TONE = { ready: "good", waiting: "warning", blocked: "critical" } as const;

export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; paid?: string }>;
}) {
  const { locale, id } = await params;
  const { error, paid } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const order = await purchaseOrder(id);
  if (!order) notFound();
  const owed = order.supplier ? await payables({ partyId: order.supplier.id }) : [];

  const format = await getFormatter({ locale });
  const money = (value: string) =>
    `${format.number(Number(value), { maximumFractionDigits: 0 })} ${order.money.currency}`;
  const qty = (value: string) => format.number(Number(value), { maximumFractionDigits: 2 });

  const { match, money: sums } = order;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">
          {order.number ?? t("purchaseOrder.draft")}
          {order.supplier ? ` — ${order.supplier.name}` : ""}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-tiny text-muted">
          {order.dealRef ? (
            <Link href={`/deals/${order.dealId}`} className="text-accent-ink hover:underline">
              {order.dealRef}
            </Link>
          ) : null}
          {order.issuedOn ? (
            <span>{t("purchaseOrder.issuedOn", { on: order.issuedOn })}</span>
          ) : null}
          {sums.terms ? <span>· {sums.terms}</span> : null}
        </p>
      </div>

      {/* The banner, and only when there is something to say. A permanent one is
          decoration; this one names the amount and where to look. */}
      {!match.clean ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[940px] text-tiny leading-relaxed text-critical-ink">
            {Number(sums.held) > 0
              ? t("purchaseOrder.banner.held", { amount: money(sums.held) })
              : t("purchaseOrder.banner.quantity")}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`purchaseOrder.error.${error}`) ? t(`purchaseOrder.error.${error}`) : error}
        </p>
      ) : null}
      {paid ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("purchaseOrder.record.paidOk")}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 md:px-7 py-6 2xl:grid-cols-3">
        <div className="flex flex-col gap-5 2xl:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.lines.title")}</h2>
              <span className="ms-auto text-micro text-muted">{t("purchaseOrder.lines.how")}</span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                  <th className="px-5 py-2 text-start font-medium">#</th>
                  <th className="px-3 py-2 text-start font-medium">
                    {t("purchaseOrder.column.designation")}
                  </th>
                  <th className="px-3 py-2 text-start font-medium">
                    {t("purchaseOrder.column.unit")}
                  </th>
                  <th className="px-3 py-2 text-end font-medium">
                    {t("purchaseOrder.column.ordered")}
                  </th>
                  <th className="px-3 py-2 text-end font-medium">
                    {t("purchaseOrder.column.received")}
                  </th>
                  <th className="px-3 py-2 text-end font-medium">
                    {t("purchaseOrder.column.remaining")}
                  </th>
                  <th className="px-3 py-2 text-end font-medium">
                    {t("purchaseOrder.column.unitCost")}
                  </th>
                  <th className="px-5 py-2 text-start font-medium">
                    {t("purchaseOrder.column.status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {match.lines.map((line) => (
                  <tr key={line.position} className="border-b border-line-subtle last:border-0">
                    <td className="px-5 py-2.5 text-muted">{line.position}</td>
                    <td className="px-3 py-2.5 text-ink">{line.designation ?? "—"}</td>
                    <td className="px-3 py-2.5 text-secondary">{line.unit ?? "—"}</td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">
                      {qty(line.orderedQty)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-ink">
                      {qty(line.receivedQty)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-secondary">
                      {qty(line.remainingQty)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums text-secondary">
                      {qty(line.orderedUnitCost)}
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATE_TONE[line.state]}>
                          {t(`purchaseOrder.state.${line.state}`)}
                        </Badge>
                        {line.price === "doesNotMatch" ? (
                          <Badge tone="critical">{t("purchaseOrder.repriced")}</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("purchaseOrder.receipts.title")}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {t("purchaseOrder.receipts.how")}
              </span>
            </div>

            {order.receipts.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("purchaseOrder.receipts.none")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">
                      {t("purchaseOrder.column.receipt")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("purchaseOrder.column.date")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("purchaseOrder.column.supplierRef")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("purchaseOrder.column.lines")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("purchaseOrder.column.receivedBy")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium">
                      {t("purchaseOrder.column.condition")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.receipts.map((receipt) => (
                    <tr key={receipt.id} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-2.5">
                        <Link
                          href={`/documents/${receipt.id}`}
                          className="text-ink hover:underline"
                        >
                          {receipt.number ?? t("purchaseOrder.draft")}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{receipt.receivedOn ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-micro text-secondary">
                        {receipt.supplierRef ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-secondary">
                        {receipt.lines}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{receipt.receivedBy ?? "—"}</td>
                      <td className="px-5 py-2.5">
                        {receipt.condition ? (
                          <Badge tone="warning">{receipt.condition}</Badge>
                        ) : (
                          <span className="text-micro text-muted">
                            {t("purchaseOrder.noReserves")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.match.title")}</h2>
              <span className="ms-auto text-micro text-muted">{t("purchaseOrder.match.how")}</span>
            </div>

            <div className="flex flex-col gap-2 px-5 py-4">
              {[
                {
                  key: "quantity",
                  ordered: qty(match.quantity.ordered),
                  received: qty(match.quantity.received),
                  invoiced: qty(match.quantity.invoiced),
                  verdict: match.quantity.verdict,
                },
                {
                  key: "total",
                  ordered: money(match.total.ordered),
                  received: money(match.total.received),
                  invoiced: money(match.total.invoiced),
                  verdict: match.total.verdict,
                },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[var(--radius-control)] border border-line-subtle px-4 py-3"
                >
                  <span className="text-tiny font-medium text-ink">
                    {t(`purchaseOrder.match.${row.key}`)}
                  </span>
                  {(["ordered", "received", "invoiced"] as const).map((leg) => (
                    <span key={leg} className="flex flex-col">
                      <span className="text-micro text-muted">{t(`purchaseOrder.leg.${leg}`)}</span>
                      <span className="text-tiny tabular-nums text-ink">{row[leg]}</span>
                    </span>
                  ))}
                  <span className="ms-auto">
                    <Badge tone={VERDICT_TONE[row.verdict]}>
                      {t(`purchaseOrder.verdict.${row.verdict}`)}
                    </Badge>
                  </span>
                </div>
              ))}

              {match.lines
                .filter((line) => line.price === "doesNotMatch")
                .map((line) => (
                  <div
                    key={line.position}
                    className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3"
                  >
                    <span className="text-tiny font-medium text-critical-ink">
                      {t("purchaseOrder.match.unitPrice", { position: line.position })}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-micro text-critical-ink/70">
                        {t("purchaseOrder.leg.ordered")}
                      </span>
                      <span className="text-tiny tabular-nums text-critical-ink">
                        {qty(line.orderedUnitCost)}
                      </span>
                    </span>
                    <span className="flex flex-col">
                      <span className="text-micro text-critical-ink/70">
                        {t("purchaseOrder.leg.invoiced")}
                      </span>
                      <span className="text-tiny tabular-nums text-critical-ink">
                        {qty(line.invoicedUnitCost ?? "0")}
                      </span>
                    </span>
                    <span className="ms-auto text-tiny tabular-nums text-critical-ink">
                      {money(line.priceDifference ?? "0")}
                    </span>
                  </div>
                ))}

              <p className="mt-1 text-micro leading-relaxed text-secondary">
                {t("purchaseOrder.match.nothingIsPaid")}
              </p>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.owed.title")}</h2>
            <dl className="mt-3">
              {[
                { key: "ordered", value: sums.ordered, tone: "neutral" as const },
                { key: "invoiced", value: sums.invoiced, tone: "neutral" as const },
                { key: "paid", value: sums.paid, tone: "good" as const },
                { key: "held", value: sums.held, tone: "critical" as const },
                { key: "safeToPay", value: sums.safeToPay, tone: "good" as const },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`purchaseOrder.owed.${row.key}`)}</dt>
                  <dd className="ms-auto text-end">
                    {row.key === "held" && Number(row.value) === 0 ? (
                      <span className="text-tiny tabular-nums text-muted">{money(row.value)}</span>
                    ) : (
                      <Badge tone={row.tone}>{money(row.value)}</Badge>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {/* The frame splits this into "paid on order" and "due on delivery".
                Those come out of a free-text terms field, and a wrong figure on
                the panel that decides what SUPSERV pays is worse than no figure
                — so the terms are shown in the words somebody wrote, and what
                is paid is read from the bank. */}
            {sums.terms ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
                {t("purchaseOrder.owed.terms", { terms: sums.terms })}
              </p>
            ) : (
              <p className="mt-3 text-micro leading-relaxed text-muted">
                {t("purchaseOrder.owed.noTerms")}
              </p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.blocks.title")}</h2>
            <dl className="mt-3">
              {order.blocks.map((block) => (
                <div
                  key={block.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">
                    {t(`purchaseOrder.blocks.${block.key}`, { count: block.count ?? 0 })}
                  </dt>
                  <dd className="ms-auto">
                    <Badge tone={BLOCK_TONE[block.state]}>
                      {t(`purchaseOrder.blockState.${block.state}`)}
                    </Badge>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("purchaseOrder.blocks.why")}
            </p>
          </section>

          {order.invoices.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("purchaseOrder.invoices.title")}
              </h2>
              <ul className="mt-3 flex flex-col gap-1.5">
                {order.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-baseline gap-3">
                    <Link
                      href={`/documents/${invoice.id}`}
                      className="text-tiny text-accent-ink hover:underline"
                    >
                      {invoice.number ?? t("purchaseOrder.draft")}
                    </Link>
                    <span className="ms-auto text-micro text-muted">{invoice.issuedOn ?? "—"}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-micro leading-relaxed text-muted">
                {t("purchaseOrder.invoices.theirNumber")}
              </p>
            </section>
          ) : null}

          <RecordPanels
            locale={locale}
            order={order}
            owed={owed}
            canReceive={can(session.role, "purchase.order.issue")}
            canRecordInvoice={can(session.role, "purchase.invoice.record")}
            canPay={can(session.role, "payments.record")}
          />
        </div>
      </div>
    </main>
  );
}
