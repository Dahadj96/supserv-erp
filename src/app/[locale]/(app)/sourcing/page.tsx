import { MailWarning } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { listSourcingRequests, sourcingCounts } from "@/domain/deal/sourcing-list";
import { Link } from "@/i18n/navigation";

/**
 * Screen 09 — Sourcing.
 *
 * The nav has pointed here since phase 0 and nothing answered. `requestsForDeal`
 * answers "what did we ask about this enquiry"; this answers the one that keeps
 * money on the table — what are we waiting on, everywhere.
 *
 * `bounced` is counted apart from `silent` on purpose, and screen 67 says why:
 * "A bounced address is not a slow supplier — it is a broken record." One needs
 * chasing, the other needs the address book fixing, and a single "no reply"
 * column would hide a supplier who has silently dropped out of every comparison
 * for a year.
 */
export const dynamic = "force-dynamic";

export default async function SourcingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [rows, counts] = await Promise.all([listSourcingRequests(), sourcingCounts()]);

  const format = await getFormatter({ locale });
  const day = (date: Date | null) =>
    date ? format.dateTime(date, { day: "2-digit", month: "short" }) : "—";

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("nav.sourcing")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {counts.all === 0
            ? t("sourcing.noneYet")
            : t("sourcing.subtitle", { waiting: counts.waiting, unsent: counts.unsent })}
        </p>
      </div>

      {counts.bounced > 0 ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-warning-bg px-4 py-3">
          <MailWarning className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-warning-ink">
            {t("sourcing.bouncedWarning", { count: counts.bounced })}
          </p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <p className="max-w-[620px] p-7 text-tiny leading-relaxed text-muted">
            {t("sourcing.none")}
          </p>
        ) : (
          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle bg-plane">
                <th className="px-4 md:px-7 py-2 text-start font-medium text-muted">
                  {t("sourcing.column.ref")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("sourcing.column.subject")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("sourcing.column.client")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("sourcing.column.sent")}
                </th>
                <th className="px-4 py-2 text-start font-medium text-muted">
                  {t("sourcing.column.replyBy")}
                </th>
                <th className="px-4 md:px-7 py-2 text-end font-medium text-muted">
                  {t("sourcing.column.answers")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line-subtle hover:bg-plane">
                  <td className="px-4 md:px-7 py-2.5">
                    <Link href={`/sourcing/${row.id}`} className="text-ink hover:underline">
                      {row.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{row.subject}</td>
                  <td className="px-4 py-2.5 text-secondary">{row.clientName ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    {row.sentAt ? (
                      <span className="text-secondary">{day(row.sentAt)}</span>
                    ) : (
                      // Written and not sent. The same distinction relance makes.
                      <Badge tone="neutral">{t("sourcing.notSent")}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-secondary">{day(row.replyBy)}</td>
                  <td className="px-4 md:px-7 py-2.5 text-end">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-micro tabular-nums text-secondary">
                        {t("sourcing.quotedOf", { quoted: row.quoted, asked: row.asked })}
                      </span>
                      {row.silent > 0 ? (
                        <Badge tone="warning">{t("sourcing.silent", { count: row.silent })}</Badge>
                      ) : null}
                      {row.bounced > 0 ? (
                        <Badge tone="critical">
                          {t("sourcing.bounced", { count: row.bounced })}
                        </Badge>
                      ) : null}
                    </span>
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
