import { TriangleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { WAITING_TOO_LONG_DAYS } from "@/domain/project/progress";
import { listProjects, projectCounts } from "@/domain/project/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 15 — Projects.
 *
 * What happens between winning the work and the last invoice being paid. For a
 * company doing travaux that is most of the year, and almost none of it shows
 * up on the enquiry and invoice screens.
 *
 * The five cards across the top are not decoration. Each one is money or a
 * date that goes wrong quietly: retention nobody goes back for, a situation
 * sitting unsigned, a bank guarantee about to lapse.
 */
export const dynamic = "force-dynamic";

type Facet = "all" | "active" | "warranty" | "closed";
const FACETS: Facet[] = ["all", "active", "warranty", "closed"];

const STATE_TONE = { active: "accent", warranty: "good", closed: "neutral" } as const;

export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const query = await searchParams;
  const show = (FACETS as string[]).includes(query.show ?? "") ? (query.show as Facet) : "all";

  const now = new Date();
  const [all, counts] = await Promise.all([listProjects(now), projectCounts(now)]);
  const format = await getFormatter({ locale });
  const money = (value: string, currency: string) =>
    `${format.number(Number(value), { maximumFractionDigits: 0 })} ${currency}`;

  const rows = show === "all" ? all : all.filter((row) => row.state === show);

  /** The one that has been waiting longest, across every project. */
  const worst = all
    .map((row) => ({ row, wait: row.progress.longestWait }))
    .filter((one) => one.wait !== null)
    .sort((a, b) => (b.wait?.waitingDays ?? 0) - (a.wait?.waitingDays ?? 0))[0];

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.projects")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("projects.summary", {
            active: counts.active,
            warranty: counts.warranty,
            retention: money(counts.retentionHeld, "DZD"),
          })}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-4 gap-4 px-7 pt-5">
          {[
            { key: "active", value: String(counts.active) },
            { key: "waiting", value: String(counts.waiting) },
            { key: "retention", value: money(counts.retentionHeld, "DZD") },
            { key: "cautions", value: String(counts.cautionsLive) },
          ].map((card) => (
            <div
              key={card.key}
              className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
            >
              <p className="text-micro text-muted">{t(`projects.card.${card.key}`)}</p>
              <p className="mt-1 text-[22px] font-semibold tabular-nums text-ink">{card.value}</p>
            </div>
          ))}
        </div>

        {worst?.wait && (worst.wait.waitingDays ?? 0) >= WAITING_TOO_LONG_DAYS ? (
          <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
            <TriangleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
            <p className="max-w-[940px] text-tiny leading-relaxed text-warning-ink">
              {t("projects.waitingBanner", {
                n: worst.wait.sequence,
                code: worst.row.code,
                client: worst.row.client,
                days: worst.wait.waitingDays ?? 0,
              })}
            </p>
            <Link
              href={`/projects/${worst.row.id}`}
              className="ms-auto shrink-0 self-center text-tiny text-warning-ink underline"
            >
              {t("projects.openSituation")}
            </Link>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-7 pt-4">
          {FACETS.map((facet) => (
            <Link
              key={facet}
              href={facet === "all" ? "/projects" : `/projects?show=${facet}`}
              aria-current={show === facet ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
                show === facet
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-secondary hover:border-line-strong"
              }`}
            >
              {t(`projects.facet.${facet}`)}
              <span className={show === facet ? "text-surface/70" : "text-muted"}>
                {counts[facet]}
              </span>
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("projects.none")}
          </p>
        ) : (
          <table className="mt-4 w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                <th className="px-7 py-2 text-start font-medium">{t("projects.column.code")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("projects.column.client")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("projects.column.object")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("projects.column.wilaya")}</th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("projects.column.progress")}
                </th>
                <th className="px-4 py-2 text-center font-medium">
                  {t("projects.column.situations")}
                </th>
                <th className="px-4 py-2 text-end font-medium">{t("projects.column.retention")}</th>
                <th className="px-7 py-2 text-start font-medium">{t("projects.column.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle hover:bg-plane">
                  <td className="px-7 py-2.5">
                    <Link href={`/projects/${row.id}`} className="text-ink hover:underline">
                      {row.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.client}</td>
                  <td className="max-w-[260px] truncate px-4 py-2.5 text-ink">{row.object}</td>
                  <td className="px-4 py-2.5 text-secondary">{row.wilaya ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-[70px] overflow-hidden rounded-full bg-line"
                        aria-hidden
                      >
                        <span
                          className={`block h-full rounded-full ${
                            row.progress.financialPercent === 100 ? "bg-good" : "bg-warning"
                          }`}
                          style={{ width: `${row.progress.financialPercent ?? 0}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-micro text-secondary">
                        {row.progress.financialPercent === null
                          ? "—"
                          : `${row.progress.financialPercent}%`}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center tabular-nums text-secondary">
                    {row.situationsApproved} / {row.situationsTotal}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-secondary">
                    {Number(row.progress.money.retentionHeld) > 0
                      ? format.number(Number(row.progress.money.retentionHeld), {
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </td>
                  <td className="px-7 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={STATE_TONE[row.state]}>{t(`projects.state.${row.state}`)}</Badge>
                      {row.cautionsNeedingAttention > 0 ? (
                        <Badge tone="critical">
                          {t("projects.cautionsAt", { n: row.cautionsNeedingAttention })}
                        </Badge>
                      ) : null}
                    </div>
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
