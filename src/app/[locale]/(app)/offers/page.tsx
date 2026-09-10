import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { formatMoney } from "@/domain/money";
import { listOffers } from "@/domain/offer/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 11 — Offers.
 *
 * The margin column obeys `offers.margin.view`, the same permission the builder
 * reads. A list that shows a figure the detail screen hides is worse than
 * either choice on its own.
 */
export const dynamic = "force-dynamic";

export default async function OffersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session?.role) hardRedirect(`/${locale}/sign-in`);

  const seesMargin = can(session.role, "offers.margin.view");
  const rows = await listOffers();

  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", { dateStyle: "medium" });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/*
        P1. The queue's fourth v5 decision settles this button: it reads "Build
        offer from a deal" rather than "New offer", because `offer.noneBody`
        already says an offer is built from a deal and a button that immediately
        asks "which one?" teaches nothing. The name is what tells somebody what
        an offer IS. It opens the deals list, which is the picker.

        The frame's state line reads "7 awaiting client decision · 4 130 000 DZD
        at stake" and this one does not, because it cannot: a document is
        draft / issued / credited / written_off, and nothing anywhere records
        that a client accepted or refused an offer. `offer.listSummary` is the
        live line the data can actually support. Named in the report.
      */}
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("nav.offers") }]}
        title={t("nav.offers")}
        state={t("offer.listSummary", {
          n: rows.length,
          drafts: rows.filter((r) => !r.number).length,
        })}
        actions={
          <Link href="/deals">
            <Button variant="primary">{t("offer.buildFromDeal")}</Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        /*
          Task 3.2. This screen had the right words in hand-written markup that
          reproduced `StateBlock` line for line — the same heading size, the
          same 460px measure, the same centring — and stopped one element short
          of it: the button. Two copies of a component is how the third one
          comes to look slightly different.
        */
        <div className="px-4 py-6 md:px-7">
          <StateBlock
            title={t("offer.noneTitle")}
            body={t("offer.noneBody")}
            action={
              <Link href="/deals">
                <Button variant="primary">{t("offer.noneAction")}</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto px-4 py-5 md:px-7">
          <table className="w-full max-w-[1400px] border-collapse text-tiny">
            <thead>
              <tr className="text-micro uppercase tracking-wide text-muted">
                <th className="py-2 text-start font-medium">{t("deals.reference")}</th>
                <th className="py-2 pe-4 text-start font-medium">{t("deals.client")}</th>
                <th className="py-2 pe-4 text-start font-medium">{t("offer.fromWhich")}</th>
                <th className="py-2 pe-4 text-end font-medium">{t("offer.totalExcl")}</th>
                {seesMargin ? (
                  <th className="py-2 pe-4 text-end font-medium">{t("offer.margin")}</th>
                ) : null}
                <th className="py-2 pe-4 text-start font-medium">{t("deals.stage")}</th>
                <th className="py-2 text-start font-medium">{t("offer.created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line-subtle">
                  <td className="py-2.5">
                    <Link
                      className="inline-flex min-h-9 items-center md:min-h-0 text-ink hover:underline"
                      href={`/offers/${row.id}/build`}
                    >
                      {row.number ?? t("offer.noNumberYet")}
                    </Link>
                  </td>
                  <td className="py-2.5 pe-4 text-secondary">{row.clientName}</td>
                  <td className="py-2.5 pe-4 text-muted">
                    {row.dealId ? (
                      <Link
                        className="inline-flex min-h-9 items-center md:min-h-0 hover:underline"
                        href={`/deals/${row.dealId}`}
                      >
                        {row.dealRef}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 pe-4 text-end tabular-nums text-ink">
                    {formatMoney(row.totalExcl, { locale, currency: row.currency })}
                  </td>
                  {seesMargin ? (
                    <td className="py-2.5 pe-4 text-end">
                      {row.marginPct === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <Badge tone={Number(row.marginPct) <= 0 ? "critical" : "neutral"}>
                          {row.marginPct}%
                        </Badge>
                      )}
                    </td>
                  ) : null}
                  <td className="py-2.5 pe-4">
                    <Badge tone={row.number ? "good" : "neutral"}>
                      {row.number ? t("offer.issued") : t("offer.draft")}
                    </Badge>
                  </td>
                  <td className="py-2.5 text-muted">{day.format(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
