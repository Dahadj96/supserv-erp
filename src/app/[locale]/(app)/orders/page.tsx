import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { isOrderKind, listOrders, ORDER_KINDS, orderCounts } from "@/domain/order/list";
import { Link } from "@/i18n/navigation";

/**
 * Screen 13 — Orders.
 *
 * Both directions in one list: what clients ordered from us, and what we
 * ordered from suppliers. The column that earns the screen is the last one —
 * an order issued with nothing delivered against it is the thing that goes
 * quiet and costs money, and it is computed from the delivery notes rather
 * than from a status somebody has to maintain.
 */
export const dynamic = "force-dynamic";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const query = await searchParams;
  const kind = isOrderKind(query.kind) ? query.kind : undefined;

  const [rows, counts] = await Promise.all([listOrders(kind), orderCounts()]);
  const format = await getFormatter({ locale });
  const money = (value: string) => format.number(Number(value), { maximumFractionDigits: 0 });

  const facets = [
    { key: "all", href: "/orders", count: counts.all, active: !kind },
    ...ORDER_KINDS.map((k) => ({
      key: k,
      href: `/orders?kind=${k}`,
      count: counts[k],
      active: kind === k,
    })),
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.orders")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("orders.subtitle")}</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-7 py-2.5">
        {facets.map((facet) => (
          <Link
            key={facet.key}
            href={facet.href}
            aria-current={facet.active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              facet.active
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`orders.kind.${facet.key}`)}
            <span className={facet.active ? "text-surface/70" : "text-muted"}>{facet.count}</span>
          </Link>
        ))}

        {counts.undelivered > 0 ? (
          <span className="ms-auto text-micro text-muted">
            {t("orders.undelivered", { count: counts.undelivered })}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("orders.none")}
          </p>
        ) : (
          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane">
                <th className="px-7 py-2 text-start font-medium text-muted">
                  {t("orders.column.number")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("orders.column.counterparty")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("orders.column.kind")}
                </th>
                <th className="px-4 py-2 text-end font-medium text-muted">
                  {t("orders.column.total")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("orders.column.issued")}
                </th>
                <th className="px-7 py-2 text-end font-medium text-muted">
                  {t("orders.column.delivered")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle hover:bg-plane">
                  <td className="px-7 py-2.5">
                    <Link href={`/documents/${row.id}`} className="text-ink hover:underline">
                      {row.number ?? t("orders.draft")}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.counterparty ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone="neutral">{t(`orders.kind.${row.kind}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-secondary">
                    {money(row.total)} {row.currency}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.issuedOn ?? "—"}</td>
                  <td className="px-7 py-2.5 text-end">
                    {row.number === null ? (
                      <span className="text-micro text-muted">—</span>
                    ) : row.delivered > 0 ? (
                      <Badge tone="good">
                        {t("orders.deliveredCount", { count: row.delivered })}
                      </Badge>
                    ) : (
                      <Badge tone="warning">{t("orders.nothingDelivered")}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
