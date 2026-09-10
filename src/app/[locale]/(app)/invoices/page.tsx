import { AlertCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  describeDocumentDiscard,
  discardDocumentFromListAction,
} from "@/app/[locale]/(app)/documents/[id]/delete-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowDelete } from "@/components/ui/row-delete";
import { formatMoney } from "@/domain/money";
import { ageOf, balanceOf, daysLate } from "@/domain/money/ageing";
import { isOwing, over90, type PaidState, paidStateOf } from "@/domain/money/invoices";
import { billed, owings } from "@/domain/money/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 17 — Invoices.
 *
 * The subtitle ends "overdue is computed from the due date, not stored", and
 * this page is where that sentence has to be true. It shipped in phase 3 with a
 * note at the foot of the table saying the Paid column would arrive with the
 * payments module, rather than showing a column of zeroes that meant nothing.
 * It has arrived, and the note is gone.
 *
 * Paid and Partly paid are NOT statuses here. `document.status` keeps what the
 * document is — draft, issued, credited, written off — and paid-ness is
 * arithmetic over allocations, worked out on every load. See
 * `src/domain/money/invoices.ts` for why the two must not share a column.
 */
export const dynamic = "force-dynamic";

const STATE_TONE: Record<PaidState, BadgeTone> = {
  draft: "neutral",
  noLegalValue: "neutral",
  unpaid: "accent",
  partPaid: "warning",
  paid: "good",
  credited: "serious",
  writtenOff: "serious",
};

const FILTERS = ["all", "proforma", "draft", "unpaid", "partPaid", "paid"] as const;
type Filter = (typeof FILTERS)[number];

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

  const today = new Date();
  const rows = (await billed()).map((row) => {
    const state = paidStateOf(row);
    return {
      ...row,
      state,
      ageDays: ageOf(row.issuedOn, today),
      lateDays: daysLate(row.dueOn, today),
      // What the paper ASKED for, less what came in. On a situation that is
      // its net à payer: the retenue de garantie the client is holding under
      // the CCAP is not an unpaid balance. See `Owing.owedNow`.
      balance: balanceOf(row),
    };
  });

  // The banner runs off the same ledger screen 20 uses, so the two screens
  // cannot disagree about what is past ninety days.
  const alert = over90(await owings(), today);

  const counts: Record<Filter, number> = {
    all: rows.length,
    proforma: rows.filter((r) => r.state === "noLegalValue").length,
    draft: rows.filter((r) => r.state === "draft").length,
    unpaid: rows.filter((r) => r.state === "unpaid").length,
    partPaid: rows.filter((r) => r.state === "partPaid").length,
    paid: rows.filter((r) => r.state === "paid").length,
  };

  const active: Filter = FILTERS.includes(status as Filter) ? (status as Filter) : "all";
  const wanted: Partial<Record<Filter, PaidState>> = {
    proforma: "noLegalValue",
    draft: "draft",
    unpaid: "unpaid",
    partPaid: "partPaid",
    paid: "paid",
  };
  const shown = active === "all" ? rows : rows.filter((r) => r.state === wanted[active]);

  const owed = rows.filter((r) => isOwing(r.state));
  const outstanding = owed.reduce((sum, r) => sum + Number(r.balance), 0);

  const money = (amount: string, currency = "DZD") => formatMoney(amount, { locale, currency });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      {/*
        P1. Three buttons, exactly one primary, and the two greys keep their
        reasons — the header pattern does not change what a control is allowed
        to do, only where it lives and that it must exist.
      */}
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("invoices.title") }]}
        title={t("invoices.title")}
        state={t("invoices.subtitle", {
          unpaid: owed.length,
          outstanding: money(outstanding.toFixed(2)),
        })}
        actions={
          <>
            <Button variant="secondary" disabledReason={t("invoices.exportLater")}>
              {t("invoices.export")}
            </Button>
            <Button variant="secondary" disabledReason={t("invoices.proformaLater")}>
              {t("invoices.newProforma")}
            </Button>
            {/*
              T2. This linked at `/documents/new`, so "New invoice" opened "New
              document" with Quotation ticked among twenty-two kinds. It opens
              the invoice form, which asks which order is being invoiced and
              carries the client and the lines across from it.
            */}
            <Link href="/invoices/new">
              <Button variant="primary">{t("invoices.newInvoice")}</Button>
            </Link>
          </>
        }
      />

      {alert ? (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3 md:mx-7">
          <AlertCircle className="size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-tiny leading-relaxed text-critical-ink">
            {t("invoices.over90", {
              n: alert.invoices,
              clients: alert.clients.join(t("invoices.and")),
              amount: money(alert.amount),
            })}{" "}
            {alert.silentDays === null
              ? t("invoices.neverChased")
              : t("invoices.silentFor", { n: alert.silentDays })}
          </p>
          {/*
            The frame's button says "Send relances". Nothing here sends. It goes
            to the screen where a person drafts one and puts it in front of a
            client themselves — LAW 6.
          */}
          <Link
            href="/payments/ageing"
            className="shrink-0 rounded-[var(--radius-control)] border border-critical bg-surface px-3 py-1.5 text-tiny text-critical-ink hover:bg-critical-bg"
          >
            {t("invoices.chaseThem")}
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 pt-5 md:px-7">
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

      <div className="px-4 py-5 md:px-7">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          {shown.length === 0 ? (
            <div className="p-6">
              <p className="text-tiny text-ink">{t("invoices.empty")}</p>
              <Link className="mt-3 inline-block" href="/invoices/new">
                <Button variant="primary" size="small">
                  {t("invoices.newInvoice")}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle text-micro text-muted">
                    <th className="py-2.5 ps-5 text-start font-medium">
                      {t("invoices.col.number")}
                    </th>
                    <th className="py-2.5 pe-4 text-start font-medium">{t("invoices.col.type")}</th>
                    <th className="py-2.5 pe-4 text-start font-medium">
                      {t("invoices.col.client")}
                    </th>
                    <th className="py-2.5 pe-4 text-start font-medium">
                      {t("invoices.col.object")}
                    </th>
                    <th className="py-2.5 pe-4 text-end font-medium">{t("invoices.col.total")}</th>
                    <th className="py-2.5 pe-4 text-end font-medium">{t("invoices.col.paid")}</th>
                    <th className="py-2.5 pe-4 text-start font-medium">
                      {t("invoices.col.issued")}
                    </th>
                    <th className="py-2.5 pe-4 text-start font-medium">{t("invoices.col.age")}</th>
                    <th className="py-2.5 pe-4 text-start font-medium">
                      {t("invoices.col.status")}
                    </th>
                    <th className="w-10 py-2.5 pe-5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.documentId} className="border-b border-line-subtle last:border-0">
                      <td className="py-2.5 ps-5">
                        <Link
                          href={`/documents/${row.documentId}`}
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
                      <td className="py-2.5 pe-4 text-secondary">{row.clientName}</td>
                      <td className="max-w-[220px] truncate py-2.5 pe-4 text-muted">
                        {row.object ?? "—"}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                        {money(row.totalIncl, row.currency)}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                        {/* A proforma cannot be paid — there is nothing to pay. */}
                        {row.state === "noLegalValue" ? "—" : money(row.paid, row.currency)}
                      </td>
                      <td className="py-2.5 pe-4 text-muted">
                        {row.issuedOn ? day.format(row.issuedOn) : "—"}
                      </td>
                      <td className="py-2.5 pe-4">
                        {row.state === "draft" ? (
                          <span className="text-muted">{t("invoices.ageDraft")}</span>
                        ) : row.lateDays > 0 && isOwing(row.state) ? (
                          // Age is days since ISSUE; the red is for being LATE.
                          // Both are on the chip because the frame shows both:
                          // "128 d · overdue".
                          <Badge tone="critical">
                            {t("invoices.ageOverdue", { n: row.ageDays })}
                          </Badge>
                        ) : (
                          <Badge tone={row.ageDays > 60 ? "warning" : "good"}>
                            {t("invoices.nDays", { n: row.ageDays })}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 pe-4">
                        <Badge tone={STATE_TONE[row.state]}>
                          {t(`invoices.state.${row.state}`)}
                        </Badge>
                      </td>
                      {/*
                        V2 — `discardDocument` existed and was callable from the
                        document's own page and nowhere else, so a draft typed
                        for the wrong client had to be opened before it could be
                        removed. It is on the row now.

                        Only on a DRAFT, and not because of tidiness: an issued
                        invoice can never be binned by anybody (LAW 5), so a
                        trash icon beside one would be a control that exists
                        only to refuse. The correction for an issued invoice is
                        an avoir, and that is a different button on the document
                        itself.
                      */}
                      <td className="py-2.5 pe-5 text-end">
                        {row.state === "draft" ? (
                          <RowDelete
                            label={row.number ?? t("invoices.noNumber")}
                            what={t("rowDelete.what.document")}
                            describe={describeDocumentDiscard.bind(null, locale, row.documentId)}
                            action={discardDocumentFromListAction.bind(
                              null,
                              locale,
                              "/invoices",
                              row.documentId,
                            )}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
