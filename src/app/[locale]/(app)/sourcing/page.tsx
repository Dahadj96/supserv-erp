import { MailWarning } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
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
      {/*
        P1. The screen had a secondary and no primary, so it stated the way to
        record a price somebody quoted over the counter and not the way to ask
        for one. Both are here now, in the order the header wants them: the
        primary opens the deal a consultation is sent from, which is what its
        own empty state has always said.

        Task 3.4's reason for the counter price still holds and it keeps its
        place. Screen 74 is a PHONE job that was only ever in the phone bar,
        which is `md:hidden`: on a laptop the one screen for "a man in a shop
        said 21 400" could be reached by typing its URL and no other way. It
        belongs on this screen rather than in the rail, because this is the
        screen about gathering prices and `src/mobile.ts` is explicit that there
        are four phone jobs and this is one of them.
      */}
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("nav.sourcing") }]}
        title={t("nav.sourcing")}
        state={
          counts.all === 0
            ? t("sourcing.noneYet")
            : t("sourcing.subtitle", { waiting: counts.waiting, unsent: counts.unsent })
        }
        actions={
          <>
            <Link href="/prices/new">
              <Button variant="secondary">{t("sourcing.counterPrice")}</Button>
            </Link>
            <Link href="/deals">
              <Button variant="primary">{t("common.openADeal")}</Button>
            </Link>
          </>
        }
      />

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
          // Task 3.2. "No requests recorded." was true and said nothing: it did
          // not name what a request IS, where one starts, or what the screen
          // would show once one existed.
          <div className="p-4 md:p-7">
            <StateBlock
              title={t("sourcing.noneTitle")}
              body={t("sourcing.none")}
              action={
                <Link href="/deals">
                  <Button variant="primary">{t("common.openADeal")}</Button>
                </Link>
              }
            />
          </div>
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
