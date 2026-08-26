import { AlertCircle } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { deliveries } from "@/domain/delivery/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 14 — Deliveries.
 *
 * The frame draws this inside one order: "ORD-2026-0046 / Deliveries", with an
 * order overview beside it. Orders are not a module in this system yet — they
 * appear in no phase of `docs/PLAN.md` §7 — so the list is anchored on what
 * does exist: the document each bon de livraison COVERS, which is the offer or
 * proforma the client agreed to. The same query takes a `sourceId` and narrows
 * to one, which is the per-order view the day orders arrive.
 *
 * The amber banner is the point of the screen: "Delivery BL-2026-0118 has no
 * signed proof attached. Without it we cannot answer a delivery dispute."
 */
export const dynamic = "force-dynamic";

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { locale } = await params;
  const { source } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const rows = await deliveries(source ? { sourceId: source } : {});

  // Issued, gone out, and no signed copy has come back. A draft is a lorry
  // that has not left, so it is not missing anything yet.
  const unsigned = rows.filter((row) => row.number !== null && row.signedCopyOnFile === null);

  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">{t("deliveries.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("deliveries.subtitle", { n: rows.length, unsigned: unsigned.length })}
          </p>
        </div>
      </div>

      {unsigned.length > 0 ? (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3 md:mx-7">
          <AlertCircle className="size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-tiny leading-relaxed text-warning-ink">
            {t("deliveries.noProof", {
              numbers: unsigned
                .slice(0, 3)
                .map((row) => row.number)
                .join(", "),
              n: unsigned.length,
            })}
          </p>
        </div>
      ) : null}

      <div className="px-4 py-5 md:px-7">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          {rows.length === 0 ? (
            <p className="px-5 py-4 text-tiny text-muted">{t("deliveries.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">{t("deliveries.number")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deliveries.client")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deliveries.covers")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deliveries.date")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deliveries.lines")}</th>
                    <th className="py-2 pe-5 text-start font-medium">{t("deliveries.proof")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.documentId} className="border-b border-line-subtle last:border-0">
                      <td className="py-2.5 ps-5">
                        <Link
                          href={`/deliveries/${row.documentId}`}
                          className="font-mono text-micro font-medium text-ink hover:underline"
                        >
                          {row.number ?? t("deliveries.draft")}
                        </Link>
                      </td>
                      <td className="py-2.5 pe-4 text-secondary">{row.clientName}</td>
                      <td className="py-2.5 pe-4 font-mono text-micro text-muted">
                        {row.coversNumber ?? "—"}
                      </td>
                      <td className="py-2.5 pe-4 text-muted">
                        {row.issuedOn ? day.format(row.issuedOn) : "—"}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-ink">{row.lines}</td>
                      <td className="py-2.5 pe-5">
                        {row.number === null ? (
                          // Nothing has gone out, so nothing is missing.
                          <span className="text-micro text-muted">
                            {t("deliveries.notDispatched")}
                          </span>
                        ) : row.signedCopyOnFile ? (
                          <Badge tone="good">
                            {t("deliveries.signedBy", { who: row.receivedBy ?? "—" })}
                          </Badge>
                        ) : (
                          <Badge tone="warning">{t("deliveries.proofMissing")}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("deliveries.whyItMatters")}
          </p>
        </section>
      </div>
    </main>
  );
}
