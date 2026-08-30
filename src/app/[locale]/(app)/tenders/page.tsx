import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { badgeMessageKey } from "@/domain/deal/stage";
import { listTenders, tenderCounts } from "@/domain/tender/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 07 — Tenders.
 *
 * The deal list, filtered to the ones answering a formal procedure, with the
 * two columns an enquiry does not have: the bid bond and how complete the
 * folder is.
 *
 * The Dossier bar is computed on every draw from the pieces and the company's
 * papers — there is no stored percentage, for the same reason there is no
 * stored stage. A folder that was 100 % in July is not 100 % in September when
 * the CASNOS attestation has expired in between, and a stored number would
 * still say it was.
 */
export const dynamic = "force-dynamic";

type Facet = "all" | "open" | "submitted" | "awarded" | "lost";

const FACETS: Facet[] = ["all", "open", "submitted", "awarded", "lost"];

export default async function TendersPage({
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
  const [all, counts] = await Promise.all([listTenders(now), tenderCounts(now)]);
  const format = await getFormatter({ locale });

  const rows = all.filter((row) => {
    if (show === "submitted") return row.submittedAt !== null;
    if (show === "awarded") return row.badge === "won";
    if (show === "lost") return row.badge === "lost";
    if (show === "open")
      return row.submittedAt === null && row.badge !== "lost" && row.badge !== "noBid";
    return true;
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.tenders")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("tenders.summary", {
            open: counts.open,
            closing: counts.closingSoon,
            incomplete: counts.incomplete,
          })}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-surface px-7 py-2.5">
        {FACETS.map((facet) => (
          <Link
            key={facet}
            href={facet === "all" ? "/tenders" : `/tenders?show=${facet}`}
            aria-current={show === facet ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-tiny ${
              show === facet
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`tenders.facet.${facet}`)}
            <span className={show === facet ? "text-surface/70" : "text-muted"}>
              {counts[facet]}
            </span>
          </Link>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("tenders.none")}
          </p>
        ) : (
          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                <th className="px-7 py-2 text-start font-medium">{t("tenders.column.ref")}</th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("tenders.column.authority")}
                </th>
                <th className="px-4 py-2 text-start font-medium">{t("tenders.column.object")}</th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("tenders.column.procedure")}
                </th>
                <th className="px-4 py-2 text-start font-medium">
                  {t("tenders.column.submission")}
                </th>
                <th className="px-4 py-2 text-end font-medium">{t("tenders.column.caution")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("tenders.column.dossier")}</th>
                <th className="px-7 py-2 text-start font-medium">{t("tenders.column.closes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.dealId} className="border-b border-line-subtle hover:bg-plane">
                  <td className="px-7 py-2.5">
                    <Link href={`/tenders/${row.dealId}`} className="text-ink hover:underline">
                      {/* Their reference, not ours. It is the one on every
                          envelope and in every email about this tender. */}
                      {row.clientReference ?? row.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.authority}</td>
                  <td className="max-w-[280px] truncate px-4 py-2.5 text-ink">{row.object}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={
                        row.procedure === "aonr" || row.procedure === "aoo" ? "neutral" : "accent"
                      }
                    >
                      {t(`tenders.procedure.${row.procedure}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">
                    {t(`enquiry.method.${row.submissionMethod}`)}
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-secondary">
                    {row.cautionAmount
                      ? format.number(Number(row.cautionAmount), { maximumFractionDigits: 0 })
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-[70px] overflow-hidden rounded-full bg-line"
                        aria-hidden
                      >
                        <span
                          className={`block h-full rounded-full ${
                            row.blocking > 0
                              ? "bg-critical"
                              : row.percent === 100
                                ? "bg-good"
                                : "bg-warning"
                          }`}
                          style={{ width: `${row.percent}%` }}
                        />
                      </span>
                      <span className="tabular-nums text-micro text-secondary">{row.percent}%</span>
                    </div>
                  </td>
                  <td className="px-7 py-2.5">
                    {row.submittedAt ? (
                      <Badge tone="good">
                        {t("tenders.submittedOn", {
                          on: format.dateTime(row.submittedAt, { day: "numeric", month: "short" }),
                        })}
                      </Badge>
                    ) : row.deadline.kind === "closed" ? (
                      <Badge tone="neutral">{t(badgeMessageKey(row.badge))}</Badge>
                    ) : row.deadline.kind === "none" ? (
                      <span className="text-micro text-muted">{t("tenders.noDeadline")}</span>
                    ) : (
                      <Badge
                        tone={
                          (row.deadline.hoursLeft ?? 0) < 0
                            ? "critical"
                            : (row.deadline.hoursLeft ?? 0) < 48
                              ? "critical"
                              : "warning"
                        }
                      >
                        {format.dateTime(row.deadline.at as Date, {
                          day: "numeric",
                          month: "short",
                        })}
                      </Badge>
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
