import { desc, eq, inArray } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { formatMoney } from "@/domain/money";
import { daysOverdue, isOverdue } from "@/domain/state";
import { Link } from "@/i18n/navigation";

/**
 * Screen 17 — Invoices.
 *
 * The subtitle on that screen ends "overdue is computed from the due date, not
 * stored", and this page is where that sentence has to be true: there is no
 * overdue status in the table, only a status the record holds and an age this
 * file works out from today's date.
 *
 * The design also draws a Paid column, an Export button and a relance banner.
 * Payments do not exist yet, so a Paid column would read "0" on every row and
 * mean nothing. They arrive together, and the note at the foot of the table
 * says so rather than the screen pretending.
 */
export const dynamic = "force-dynamic";

const KINDS = ["invoice", "proforma", "credit_note", "situation"];

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  issued: "accent",
  part_paid: "warning",
  paid: "good",
  credited: "serious",
  written_off: "serious",
};

const FILTERS = ["all", "draft", "issued", "part_paid", "paid"] as const;

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const { status } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const rows = await db
    .select({
      id: document.id,
      kind: document.kind,
      number: document.number,
      status: document.status,
      issuedOn: document.issuedOn,
      dueOn: document.dueOn,
      currency: document.currency,
      totals: document.totals,
      clientName: party.legalName,
      clientCode: party.code,
    })
    .from(document)
    .innerJoin(party, eq(document.partyId, party.id))
    .where(inArray(document.kind, KINDS))
    .orderBy(desc(document.createdAt));

  const withMoney = rows.map((row) => {
    const totals = (row.totals ?? {}) as Record<string, string>;
    const totalIncl = totals.totalIncl ?? totals.totalExcl ?? "0";
    // No payments module yet, so nothing has been paid and the balance is the
    // whole total. When payments arrive this line reads from them; until then
    // it is honest arithmetic over the facts that exist.
    const balanceValue = row.status === "paid" ? "0" : totalIncl;
    const dueOn = row.dueOn ? new Date(row.dueOn) : null;

    return {
      ...row,
      totalIncl,
      overdue: isOverdue(dueOn, balanceValue),
      days: daysOverdue(dueOn),
      unpaid: row.status !== "paid" && row.status !== "draft" && row.status !== "credited",
    };
  });

  const counts: Record<string, number> = { all: withMoney.length };
  for (const key of FILTERS.slice(1)) {
    counts[key] = withMoney.filter((r) => r.status === key).length;
  }

  const active = status && FILTERS.includes(status as (typeof FILTERS)[number]) ? status : "all";
  const shown = active === "all" ? withMoney : withMoney.filter((r) => r.status === active);

  const outstanding = withMoney
    .filter((r) => r.unpaid)
    .reduce((sum, r) => sum + Number(r.totalIncl), 0);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("invoices.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("invoices.subtitle", {
              unpaid: withMoney.filter((r) => r.unpaid).length,
              outstanding: formatMoney(outstanding.toFixed(2), { locale }),
            })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="secondary" disabledReason={t("invoices.exportLater")}>
            {t("invoices.export")}
          </Button>
          <Button variant="secondary" disabledReason={t("invoices.proformaLater")}>
            {t("invoices.newProforma")}
          </Button>
          <Link href="/documents/new">
            <Button variant="primary">{t("invoices.newInvoice")}</Button>
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-7 pt-5">
        {FILTERS.map((key) => (
          <Link key={key} href={key === "all" ? "/invoices" : `/invoices?status=${key}`}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-micro font-medium ${
                active === key ? "bg-ink text-on-ink" : "bg-chip text-secondary hover:bg-sunken"
              }`}
            >
              {t(`invoices.filter.${key}`)}
              <span className={active === key ? "opacity-70" : "text-muted"}>{counts[key]}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="px-7 py-5">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          {shown.length === 0 ? (
            <div className="p-6">
              <p className="text-tiny text-ink">{t("invoices.empty")}</p>
              <Link className="mt-3 inline-block" href="/documents/new">
                <Button variant="primary" size="small">
                  {t("invoices.newInvoice")}
                </Button>
              </Link>
            </div>
          ) : (
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2.5 ps-5 text-start font-medium">{t("invoices.col.number")}</th>
                  <th className="py-2.5 pe-4 text-start font-medium">{t("invoices.col.type")}</th>
                  <th className="py-2.5 pe-4 text-start font-medium">{t("invoices.col.client")}</th>
                  <th className="py-2.5 pe-4 text-end font-medium">{t("invoices.col.total")}</th>
                  <th className="py-2.5 pe-4 text-start font-medium">{t("invoices.col.issued")}</th>
                  <th className="py-2.5 pe-4 text-start font-medium">{t("invoices.col.age")}</th>
                  <th className="py-2.5 pe-5 text-start font-medium">{t("invoices.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 ps-5">
                      <Link
                        href={`/documents/${row.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {row.number ?? t("invoices.noNumber")}
                      </Link>
                    </td>
                    <td className="py-2.5 pe-4">
                      <Badge tone={row.kind === "invoice" ? "neutral" : "accent"}>
                        {t.has(`documents.kind.${row.kind}`)
                          ? t(`documents.kind.${row.kind}`)
                          : row.kind}
                      </Badge>
                    </td>
                    <td className="py-2.5 pe-4 text-secondary">
                      {row.clientCode} — {row.clientName}
                    </td>
                    <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                      {formatMoney(row.totalIncl, { locale, currency: row.currency })}
                    </td>
                    <td className="py-2.5 pe-4 text-muted">{row.issuedOn ?? "—"}</td>
                    <td className="py-2.5 pe-4">
                      {row.status === "draft" ? (
                        <span className="text-muted">{t("invoices.ageDraft")}</span>
                      ) : row.overdue ? (
                        <Badge tone="critical">
                          {t("invoices.overdueDays", { days: row.days })}
                        </Badge>
                      ) : (
                        <span className="text-muted">{t("invoices.notDue")}</span>
                      )}
                    </td>
                    <td className="py-2.5 pe-5">
                      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
                        {t.has(`invoices.status.${row.status}`)
                          ? t(`invoices.status.${row.status}`)
                          : row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("invoices.paymentsLater")}
          </p>
        </section>
      </div>
    </main>
  );
}
