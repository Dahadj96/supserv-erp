import { TriangleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import type { PersonStage } from "@/domain/recruitment/request";
import { CERT_EXPIRING_DAYS, candidateCounts, listCandidates } from "@/domain/recruitment/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 24 — Candidates.
 *
 * Its own breadcrumb reads "People / Candidates", and that is the design: this
 * is a view of the people list, not a second list of humans. A candidate who is
 * hired keeps their row, their trade, their phone number and every
 * certification already attached to them — one field changes.
 *
 * The banner counts certifications expiring within thirty days, and it counts
 * them across everybody, including people already on a site. A ticket running
 * out under a man who is working is worth more attention than one under a CV
 * nobody has read.
 */
export const dynamic = "force-dynamic";

type Facet = "all" | "new" | "reviewing" | "shortlisted" | "interview" | "hired" | "archived";
const FACETS: Facet[] = [
  "all",
  "new",
  "reviewing",
  "shortlisted",
  "interview",
  "hired",
  "archived",
];

const STAGE_TONE: Record<PersonStage, "neutral" | "accent" | "warning" | "good"> = {
  new: "neutral",
  reviewing: "accent",
  shortlisted: "accent",
  interview: "warning",
  hired: "good",
  archived: "neutral",
};

export default async function CandidatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ show?: string; trade?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const query = await searchParams;
  const show = (FACETS as string[]).includes(query.show ?? "") ? (query.show as Facet) : "all";

  const now = new Date();
  const [all, counts] = await Promise.all([listCandidates(now), candidateCounts(now)]);
  const format = await getFormatter({ locale });

  const rows = all
    .filter((row) => (show === "all" ? true : show === "hired" ? row.hired : row.stage === show))
    .filter((row) => (query.trade ? row.trade === query.trade : true));

  const link = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { show: show === "all" ? undefined : show, trade: query.trade, ...extra };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/candidates?${qs}` : "/candidates";
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("candidates.title")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("candidates.subtitle", { n: counts.all, expiring: counts.expiring })}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {counts.expiring > 0 ? (
          <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
            <TriangleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
            <p className="max-w-[940px] text-tiny leading-relaxed text-warning-ink">
              {t("candidates.expiringBanner", {
                n: counts.expiring,
                days: CERT_EXPIRING_DAYS,
              })}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-7 pt-4">
          {FACETS.map((facet) => (
            <Link
              key={facet}
              href={link({ show: facet === "all" ? undefined : facet })}
              aria-current={show === facet ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
                show === facet
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-secondary hover:border-line-strong"
              }`}
            >
              {t(`candidates.facet.${facet}`)}
              <span className={show === facet ? "text-surface/70" : "text-muted"}>
                {counts[facet]}
              </span>
            </Link>
          ))}
        </div>

        {counts.trades.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 px-7 pt-2.5">
            <span className="text-micro text-muted">{t("candidates.discipline")}</span>
            {counts.trades.map((trade) => (
              <Link
                key={trade}
                href={link({ trade: query.trade === trade ? undefined : trade })}
                className={`rounded-full border px-2.5 py-0.5 text-micro ${
                  query.trade === trade
                    ? "border-ink bg-ink text-surface"
                    : "border-line bg-surface text-secondary hover:border-line-strong"
                }`}
              >
                {trade} {all.filter((r) => r.trade === trade).length}
              </Link>
            ))}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("candidates.none")}
          </p>
        ) : (
          <table className="mt-4 w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                <th className="px-7 py-2 text-start font-medium">{t("candidates.column.name")}</th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("candidates.column.discipline")}
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("candidates.column.appliedFor")}
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("candidates.column.certifications")}
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("candidates.column.expires")}
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("candidates.column.wilaya")}
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("candidates.column.received")}
                </th>
                <th className="px-7 py-2 text-start font-medium">
                  {t("candidates.column.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle hover:bg-plane">
                  <td className="px-7 py-2.5">
                    <Link href={`/candidates/${row.id}`} className="text-ink hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.trade}</td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-secondary">
                    {row.appliedFor ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.certification ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {row.certificationExpiresOn === null ? (
                      <span className="text-muted">—</span>
                    ) : row.daysLeft !== null &&
                      row.daysLeft >= 0 &&
                      row.daysLeft <= CERT_EXPIRING_DAYS ? (
                      <Badge tone="warning">
                        {t("candidates.expiresIn", {
                          on: row.certificationExpiresOn,
                          days: row.daysLeft,
                        })}
                      </Badge>
                    ) : row.daysLeft !== null && row.daysLeft < 0 ? (
                      <Badge tone="critical">{t("candidates.expired")}</Badge>
                    ) : (
                      <span className="text-secondary">{row.certificationExpiresOn}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">
                    {row.mobility ?? row.wilaya ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">
                    {format.dateTime(row.receivedAt, { day: "numeric", month: "short" })}
                  </td>
                  <td className="px-7 py-2.5">
                    <Badge tone={row.hired ? "good" : STAGE_TONE[row.stage]}>
                      {t(`candidates.stage.${row.hired ? "hired" : row.stage}`)}
                    </Badge>
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
