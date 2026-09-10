import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import type { RequestState } from "@/domain/recruitment/request";
import { listRequests, requestCounts } from "@/domain/recruitment/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 26 — personnel requests.
 *
 * "Two welders in In Salah by the 24th." The screen answers one question about
 * each: how many people can actually be there on the day.
 *
 * That is not the same as how many are confirmed, and the difference is the
 * reason this screen exists. A welder confirmed for a TouatGaz site whose
 * attestation expires on the 22nd is not a warning — he is one man short, and a
 * headcount that counted him would send somebody to a site they will be turned
 * away from.
 */
export const dynamic = "force-dynamic";

type Facet = "all" | "open" | "filled" | "cancelled";
const FACETS: Facet[] = ["all", "open", "filled", "cancelled"];

const STATE_TONE: Record<RequestState, "critical" | "warning" | "good" | "neutral"> = {
  late: "critical",
  urgent: "critical",
  open: "warning",
  filled: "good",
  cancelled: "neutral",
};

export default async function PersonnelRequestsPage({
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
  const [all, counts] = await Promise.all([listRequests(now), requestCounts(now)]);

  const rows =
    show === "all"
      ? all
      : all.filter((row) =>
          show === "open"
            ? row.request.state === "open" ||
              row.request.state === "urgent" ||
              row.request.state === "late"
            : row.request.state === show,
        );

  /** The one that will actually go wrong first. */
  const worst = all
    .filter((row) => row.request.blocked.length > 0 && row.request.state !== "cancelled")
    .sort((a, b) => (a.request.daysToStart ?? 999) - (b.request.daysToStart ?? 999))[0];

  const open = rows.find((row) => row.request.state !== "cancelled" && row.shortlist.length > 0);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("nav.personnelRequests")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("requests.summary", {
            open: counts.open,
            positions: counts.positions,
            soon: counts.withinSeven,
          })}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {worst ? (
          <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
            <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
            <p className="max-w-[940px] text-tiny leading-relaxed text-critical-ink">
              {t("requests.banner", {
                ref: worst.ref,
                needed: worst.request.needed,
                role: worst.role,
                wilaya: worst.wilaya ?? "—",
                days: worst.request.daysToStart ?? 0,
                usable: worst.request.usable,
              })}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-4 md:px-7 pt-4">
          {FACETS.map((facet) => (
            <Link
              key={facet}
              href={facet === "all" ? "/personnel-requests" : `/personnel-requests?show=${facet}`}
              aria-current={show === facet ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
                show === facet
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-secondary hover:border-line-strong"
              }`}
            >
              {t(`requests.facet.${facet}`)}
              <span className={show === facet ? "text-surface/70" : "text-muted"}>
                {counts[facet]}
              </span>
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("requests.none")}
          </p>
        ) : (
          <table className="mt-4 w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                <th className="px-4 md:px-7 py-2 text-start font-medium">
                  {t("requests.column.ref")}
                </th>
                <th className="px-4 py-2 text-start font-medium">{t("requests.column.role")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("requests.column.for")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("requests.column.wilaya")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("requests.column.needed")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("requests.column.confirmed")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("requests.column.start")}</th>
                <th className="px-4 md:px-7 py-2 text-start font-medium">
                  {t("requests.column.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle hover:bg-plane">
                  <td className="px-4 md:px-7 py-2.5 text-ink">{row.ref}</td>
                  <td className="px-4 py-2.5 text-ink">{row.role}</td>
                  <td className="px-4 py-2.5 text-secondary">
                    {row.projectId ? (
                      <Link href={`/projects/${row.projectId}`} className="hover:underline">
                        {row.projectCode} — {row.projectObject}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.wilaya ?? "—"}</td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-ink">
                    {row.request.needed}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums">
                    {/* Usable, not confirmed. The two differ exactly when
                        somebody's ticket will have lapsed by the start date,
                        and that is the number that decides. */}
                    <span
                      className={
                        row.request.usable < row.request.needed ? "text-critical-ink" : "text-ink"
                      }
                    >
                      {row.request.usable}
                    </span>
                    {row.request.blocked.length > 0 ? (
                      <span className="ms-1 text-micro text-muted">
                        {t("requests.ofConfirmed", { n: row.request.confirmed })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.startOn ?? "—"}</td>
                  <td className="px-4 md:px-7 py-2.5">
                    <Badge tone={STATE_TONE[row.request.state]}>
                      {t(`requests.state.${row.request.state}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {open ? (
          <section className="mx-4 md:mx-7 my-6 rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("requests.shortlist.title", {
                  ref: open.ref,
                  needed: open.request.needed,
                  role: open.role,
                  wilaya: open.wilaya ?? "—",
                })}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {open.certificationRequired
                  ? t("requests.shortlist.certificationMandatory")
                  : t("requests.shortlist.noCertificationNeeded")}
              </span>
            </div>

            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                  <th className="px-5 py-2 text-start font-medium">
                    {t("requests.column.candidate")}
                  </th>
                  <th className="px-3 py-2 text-start font-medium">{t("requests.column.trade")}</th>
                  <th className="px-3 py-2 text-start font-medium">
                    {t("requests.column.certification")}
                  </th>
                  <th className="px-3 py-2 text-start font-medium">
                    {t("requests.column.expires")}
                  </th>
                  <th className="px-3 py-2 text-start font-medium">
                    {t("requests.column.mobility")}
                  </th>
                  <th className="px-5 py-2 text-start font-medium">{t("requests.column.stage")}</th>
                </tr>
              </thead>
              <tbody>
                {open.shortlist.map((row) => (
                  <tr key={row.id} className="border-b border-line-subtle last:border-0">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/candidates/${row.personId}`}
                        className="text-ink hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-secondary">{row.trade ?? "—"}</td>
                    <td className="px-3 py-2.5 text-secondary">{row.certification ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {row.certificationExpiresOn ? (
                        row.certificationLapsesBeforeStart ? (
                          <Badge tone="critical">
                            {t("requests.expiresBeforeStart", { on: row.certificationExpiresOn })}
                          </Badge>
                        ) : (
                          <span className="text-secondary">{row.certificationExpiresOn}</span>
                        )
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-secondary">{row.mobility ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      <Badge
                        tone={
                          row.stage === "confirmed"
                            ? "good"
                            : row.stage === "rejected"
                              ? "critical"
                              : "neutral"
                        }
                      >
                        {t(`requests.stage.${row.stage}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </main>
  );
}
