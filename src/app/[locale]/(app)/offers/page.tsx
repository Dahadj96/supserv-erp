import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
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
      <div className="shrink-0 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.offers")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("offer.listSummary", {
            n: rows.length,
            drafts: rows.filter((r) => !r.number).length,
          })}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center md:px-7">
          <h2 className="text-lead font-semibold text-ink">{t("offer.noneTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[460px] text-tiny leading-relaxed text-secondary">
            {t("offer.noneBody")}
          </p>
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
                    <Link className="text-ink hover:underline" href={`/offers/${row.id}/build`}>
                      {row.number ?? t("offer.noNumberYet")}
                    </Link>
                  </td>
                  <td className="py-2.5 pe-4 text-secondary">{row.clientName}</td>
                  <td className="py-2.5 pe-4 text-muted">
                    {row.dealId ? (
                      <Link className="hover:underline" href={`/deals/${row.dealId}`}>
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
