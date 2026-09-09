import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { whatIsLate } from "@/assistant/late";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { report } from "@/domain/control/reports";
import { sourcingCounts } from "@/domain/deal/sourcing-list";
import { BUCKETS } from "@/domain/money/ageing";
import { orderCounts } from "@/domain/order/list";
import { Link } from "@/i18n/navigation";

/**
 * Screens 03 and 04 — the dashboard, drawn twice in the Figma file: once for
 * the Gérant and once for the Commercial.
 *
 * One page. The difference between the two frames is which numbers are on it,
 * and that is a permission question that `can()` already answers — building two
 * routes would mean two places to forget the same check. A Commercial without
 * `invoices.issue` does not see the money row, and the row is absent rather
 * than greyed: on a dashboard a greyed figure still tells you an order of
 * magnitude by its width.
 *
 * Nothing here is new arithmetic. Every tile reads a function some other screen
 * already stands on, so the dashboard cannot disagree with the screen you click
 * through to — which is the failure that makes dashboards distrusted.
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const seesMoney = Boolean(session.role && can(session.role, "invoices.issue"));

  const [late, data, sourcing, orders] = await Promise.all([
    whatIsLate(),
    report(),
    sourcingCounts(),
    orderCounts(),
  ]);

  const format = await getFormatter({ locale });
  const money = (value: string | number) =>
    format.number(Number(value), { maximumFractionDigits: 0 });

  const Tile = ({
    label,
    value,
    href,
    tone,
    note,
  }: {
    label: string;
    value: string;
    href: string;
    tone?: "critical" | "warning";
    note?: string;
  }) => (
    <Link
      href={href}
      className="rounded-[var(--radius-card)] border border-line bg-surface p-5 hover:border-line-strong"
    >
      <p className="text-micro text-muted">{label}</p>
      <p
        className={`mt-1 text-[26px] font-semibold tabular-nums ${
          tone === "critical"
            ? "text-critical-ink"
            : tone === "warning"
              ? "text-warning-ink"
              : "text-ink"
        }`}
      >
        {value}
      </p>
      {note ? <p className="mt-1 text-micro text-muted">{note}</p> : null}
    </Link>
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.dashboard")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("dashboard.subtitle", { role: t(`auth.roles.${session.role}`) })}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-2 md:grid-cols-4 gap-4 px-4 md:px-7 py-6">
        <Tile
          label={t("dashboard.late")}
          value={String(late.things.length)}
          href="/assistant"
          tone={late.things.length > 0 ? "critical" : undefined}
          note={late.examined > 0 ? t("dashboard.ofExamined", { count: late.examined }) : undefined}
        />
        <Tile
          label={t("dashboard.openDeals")}
          value={String(data.deals.open)}
          href="/deals"
          note={
            data.deals.total > 0 ? t("dashboard.ofDeals", { count: data.deals.total }) : undefined
          }
        />
        <Tile
          label={t("dashboard.awaitingSuppliers")}
          value={String(sourcing.waiting)}
          href="/sourcing"
          tone={sourcing.bounced > 0 ? "warning" : undefined}
          note={
            sourcing.bounced > 0 ? t("dashboard.bounced", { count: sourcing.bounced }) : undefined
          }
        />
        <Tile
          label={t("dashboard.undelivered")}
          value={String(orders.undelivered)}
          href="/orders"
          tone={orders.undelivered > 0 ? "warning" : undefined}
        />
      </div>

      {seesMoney ? (
        <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 pb-6">
          <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("dashboard.owed")}</h2>
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

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("dashboard.outcomes")}</h2>
            {data.deals.total === 0 ? (
              <p className="mt-3 text-tiny text-muted">{t("reports.noDeals")}</p>
            ) : (
              <dl className="mt-3">
                {(["won", "lost", "noBid"] as const).map((key) => (
                  <div
                    key={key}
                    className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                  >
                    <dt className="text-tiny text-secondary">{t(`reports.outcome.${key}`)}</dt>
                    <dd className="ms-auto text-tiny tabular-nums text-ink">{data.deals[key]}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Link
              href="/reports"
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {t("dashboard.allReports")}
            </Link>
          </section>
        </div>
      ) : (
        <p className="mx-4 md:mx-7 max-w-[760px] pb-6 text-micro leading-relaxed text-muted">
          {t("dashboard.moneyHidden")}
        </p>
      )}

      {data.everIssued ? null : (
        <p className="mx-4 md:mx-7 max-w-[900px] rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3 text-tiny leading-relaxed text-accent-ink">
          {t("dashboard.nothingIssuedYet")}{" "}
          <Link href="/setup" className="underline">
            {t("settings.dayOne")}
          </Link>
        </p>
      )}

      <div className="h-6" />
    </main>
  );
}
