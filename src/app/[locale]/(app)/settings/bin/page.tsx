import { getTranslations, setRequestLocale } from "next-intl/server";
import { restoreCompany } from "@/app/[locale]/(app)/companies/delete-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listBin } from "@/domain/deletion";

/**
 * Screen 83 — the bin. Restorable for 30 days, then the record is gone but its
 * audit trail is not.
 */
export const dynamic = "force-dynamic";

export default async function BinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const rows = await listBin();
  const fmt = (d: Date) => d.toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB");

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("bin.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("bin.subtitle")}</p>
      </div>

      <div className="max-w-[1000px] px-7 py-6">
        {rows.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
            <h2 className="text-lead font-semibold text-ink">{t("bin.emptyTitle")}</h2>
            <p className="mx-auto mt-1.5 max-w-[420px] text-tiny leading-relaxed text-secondary">
              {t("bin.emptyBody")}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-tiny">
            <thead>
              <tr className="border-b border-line-subtle text-micro text-muted">
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.what")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.when")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.reason")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("bin.goneIn")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle last:border-0">
                  <td className="px-4 py-2.5 text-ink">
                    {row.what}
                    <span className="ms-2 text-micro text-muted">{row.code}</span>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{fmt(row.deletedAt)}</td>
                  <td className="px-4 py-2.5 text-secondary">{row.reason || "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={row.daysLeft <= 5 ? "critical" : "neutral"}>
                      {t("bin.days", { count: row.daysLeft })}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-end">
                    <form action={restoreCompany.bind(null, locale, row.id)}>
                      <Button type="submit" variant="secondary" size="small">
                        {t("bin.restore")}
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-4 max-w-[720px] text-micro leading-relaxed text-muted">
          {t("bin.afterThirtyDays")}
        </p>
      </div>
    </main>
  );
}
