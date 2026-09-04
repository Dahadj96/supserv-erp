import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { report } from "@/domain/control/reports";
import { BUCKETS } from "@/domain/money/ageing";
import { Link } from "@/i18n/navigation";

/**
 * Screen 28 — Reports.
 *
 * Every figure is computed when the page is drawn. No report table, no nightly
 * rollup, no cached total — LAW 1 in the place it is most tempting to break,
 * because a stored summary is a number that can disagree with the rows it
 * claims to summarise, and nobody ever notices which of the two is wrong.
 *
 * The bars are drawn with CSS widths from real numbers rather than a chart
 * library. Twelve months of one figure does not need 90 kB of JavaScript, and a
 * bar you can read the number off is better than one you have to hover.
 */
export const dynamic = "force-dynamic";

export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const data = await report();
  const format = await getFormatter({ locale });

  const money = (value: string | number) =>
    format.number(Number(value), { maximumFractionDigits: 0 });

  const monthLabel = (month: string) => {
    const [year, m] = month.split("-");
    const date = new Date(Number(year), Number(m) - 1, 1);
    return format.dateTime(date, { month: "short", year: "2-digit" });
  };

  /** A row of months, as bars. Widest bar is the largest month, not a scale. */
  const Bars = ({ rows }: { rows: typeof data.invoices }) => {
    const peak = Math.max(...rows.map((row) => Number(row.total)), 1);
    return (
      <ul className="flex flex-col gap-1.5 p-5">
        {rows.map((row) => (
          <li key={row.month} className="flex items-center gap-3">
            <span className="w-[62px] shrink-0 text-micro text-muted">{monthLabel(row.month)}</span>
            <span className="h-3 flex-1 rounded-full bg-plane">
              <span
                className="block h-3 rounded-full bg-accent-ink"
                style={{ width: `${Math.max(2, (Number(row.total) / peak) * 100)}%` }}
              />
            </span>
            <span className="w-[110px] shrink-0 text-end text-micro tabular-nums text-ink">
              {money(row.total)}
            </span>
            <span className="w-[44px] shrink-0 text-end text-micro tabular-nums text-muted">
              {row.count}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("reports.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("reports.subtitle")}</p>
      </div>

      {data.everIssued ? null : (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
          <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-accent-ink">
            {t("reports.nothingIssuedYet")}
          </p>
        </div>
      )}

      <div className="grid max-w-[1400px] grid-cols-1 sm:grid-cols-2 items-start gap-5 px-4 md:px-7 py-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("reports.invoiced")}</h2>
            <span className="ms-auto text-micro text-muted">{t("reports.twelveMonths")}</span>
          </div>
          {data.invoices.length === 0 ? (
            <p className="p-5 text-tiny text-muted">{t("reports.noInvoices")}</p>
          ) : (
            <Bars rows={data.invoices} />
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("reports.offered")}</h2>
            <span className="ms-auto text-micro text-muted">{t("reports.twelveMonths")}</span>
          </div>
          {data.offers.length === 0 ? (
            <p className="p-5 text-tiny text-muted">{t("reports.noOffers")}</p>
          ) : (
            <Bars rows={data.offers} />
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("reports.enquiries")}</h2>
            <Link href="/deals" className="ms-auto text-micro text-accent-ink hover:underline">
              {t("reports.seeThem")}
            </Link>
          </div>
          {data.deals.total === 0 ? (
            <p className="p-5 text-tiny text-muted">{t("reports.noDeals")}</p>
          ) : (
            <dl className="p-5">
              {(["won", "lost", "noBid", "open"] as const).map((key) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`reports.outcome.${key}`)}</dt>
                  <dd className="ms-auto text-tiny tabular-nums text-ink">{data.deals[key]}</dd>
                  <dd className="w-[54px] text-end text-micro tabular-nums text-muted">
                    {Math.round((data.deals[key] / data.deals.total) * 100)}%
                  </dd>
                </div>
              ))}
              <p className="mt-3 text-micro leading-relaxed text-muted">{t("reports.wonHow")}</p>
            </dl>
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("reports.owed")}</h2>
            <Link
              href="/payments/ageing"
              className="ms-auto text-micro text-accent-ink hover:underline"
            >
              {t("reports.seeThem")}
            </Link>
          </div>
          {Number(data.ageing.total) === 0 ? (
            <p className="p-5 text-tiny text-muted">{t("reports.nothingOwed")}</p>
          ) : (
            <dl className="p-5">
              {BUCKETS.map((bucket) => (
                <div
                  key={bucket}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2"
                >
                  <dt className="text-tiny text-secondary">{t(`ageing.bucket.${bucket}`)}</dt>
                  <dd className="ms-auto text-tiny tabular-nums text-ink">
                    {money(data.ageing.buckets[bucket].amount)}
                  </dd>
                  <dd className="w-[54px] text-end text-micro tabular-nums text-muted">
                    {data.ageing.buckets[bucket].pct}%
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline gap-3 py-2">
                <dt className="text-tiny font-semibold text-ink">{t("reports.total")}</dt>
                <dd className="ms-auto text-tiny font-semibold tabular-nums text-ink">
                  {money(data.ageing.total)}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("reports.byKind")}</h2>
            <span className="ms-auto text-micro text-muted">{t("reports.draftsAreNotSales")}</span>
          </div>
          {data.kinds.length === 0 ? (
            <p className="p-5 text-tiny text-muted">{t("reports.noDocuments")}</p>
          ) : (
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {data.kinds.map((row) => (
                  <tr key={row.kind} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 ps-5 text-ink">
                      {t.has(`docTypes.kind.${row.kind}`)
                        ? t(`docTypes.kind.${row.kind}`)
                        : row.kind}
                    </td>
                    <td className="w-[120px] py-2 text-end tabular-nums text-ink">{row.issued}</td>
                    <td className="w-[140px] py-2 pe-5 text-end">
                      {row.drafts > 0 ? (
                        <Badge tone="neutral">{t("reports.drafts", { count: row.drafts })}</Badge>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("reports.computedNow")}
          </p>
        </section>
      </div>
    </main>
  );
}
