import { CalendarClock, CircleAlert, Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import {
  type ExpiringRow,
  type ExpiryKind,
  type ExpiryState,
  expiringReport,
} from "@/domain/control/expiring";
import { EXPIRING_WITHIN_DAYS } from "@/domain/tender/dossier";
import { Link } from "@/i18n/navigation";

/**
 * Screen 27b — everything that expires, in one place. Task U2.
 *
 * WHY IT LIVES UNDER /compliance. Expiry is scattered across four tables and
 * was visible on four unrelated screens: a CNAS attestation inside one tender's
 * folder, a bank guarantee inside one site, a welder's habilitation on one
 * man's page, an offer's validity nowhere at all. The question "what expires
 * next" is not asked from any of those screens — it is asked on a Monday
 * morning by somebody who wants to know what the company has to renew, which is
 * the question Compliance answers. Screen 27 is thin and already in the rail,
 * so this is one click from it, with its worst numbers repeated up there so
 * nobody has to know this page exists to be warned by it.
 *
 * A route of its own rather than a third panel on 27, because 27 answers "what
 * are the RULES doing to us today" — confirmed, unconfirmed, drafts sailing
 * through — and this is a work list with rows, dates and links out. One screen
 * doing both would be two screens sharing a scrollbar.
 *
 * COMPUTED, NEVER STORED (LAW 1). Every row is `expires_on` against today, and
 * for a company paper against each open tender's own closing time. A folder
 * that was complete in July is not complete in September, and no column here
 * claims otherwise.
 */
export const dynamic = "force-dynamic";

const TONE: Record<ExpiryState, BadgeTone> = {
  expired: "critical",
  beforeDeposit: "critical",
  soon: "warning",
  later: "neutral",
};

/** Worst first, so the table can be read from the top and stopped at. */
const RANK: Record<ExpiryState, number> = {
  expired: 0,
  beforeDeposit: 1,
  soon: 2,
  later: 3,
};

export default async function ExpiringPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const report = await expiringReport();

  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB", {
      dateStyle: "long",
      timeZone: "UTC",
    });

  /**
   * What the thing IS, in the words the rest of the ERP already uses for it.
   * `t.has` guards every one: a credential key or a caution kind can be free
   * text somebody typed, and a built key that misses is a 500 rather than a
   * missing label.
   */
  const KIND_LABEL: Record<ExpiryKind, (row: ExpiringRow) => string> = {
    credential: (row) =>
      t.has(`tender.piece.${row.what}`) ? t(`tender.piece.${row.what}`) : row.what,
    caution: (row) =>
      t.has(`project.caution.${row.what}`) ? t(`project.caution.${row.what}`) : row.what,
    certification: (row) => row.what,
    offer: (row) =>
      t.has(`documents.kind.${row.what}`) ? t(`documents.kind.${row.what}`) : row.what,
  };

  const rows = [...report.rows].sort(
    (a, b) => RANK[a.state] - RANK[b.state] || a.expiresOn.localeCompare(b.expiresOn),
  );

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("expiring.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("expiring.subtitle")}</p>
        </div>
        <div className="ms-auto">
          <Link href="/compliance">
            <Button variant="ghost">{t("expiring.backToCompliance")}</Button>
          </Link>
        </div>
      </div>

      {report.beforeDeposit > 0 || report.expired > 0 ? (
        <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[940px] text-tiny leading-relaxed text-critical-ink">
            {report.beforeDeposit > 0
              ? t("expiring.banner.beforeDeposit", { count: report.beforeDeposit })
              : t("expiring.banner.expired", { count: report.expired })}
          </p>
        </div>
      ) : null}

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <CalendarClock className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("expiring.intro", { days: EXPIRING_WITHIN_DAYS })}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          {/* The block REPLACES the card rather than sitting inside it —
              `StateBlock` draws its own border, and one bordered box centred
              inside another is the look of a component used where it does not
              belong. Task 3.2 settled that on Deliveries and Payments. */}
          {rows.length === 0 ? (
            <StateBlock
              title={t("expiring.none.title")}
              body={t("expiring.none.body")}
              action={
                <Link href="/tenders">
                  <Button variant="secondary">{t("expiring.none.action")}</Button>
                </Link>
              }
            />
          ) : (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">{t("expiring.table.title")}</h2>
                <span className="ms-auto text-micro text-muted">
                  {t("expiring.table.counted", { count: report.total })}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="border-b border-line-subtle text-micro text-muted">
                      <th className="py-2 ps-5 pe-4 text-start font-medium">
                        {t("expiring.table.what")}
                      </th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("expiring.table.when")}
                      </th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("expiring.table.breaks")}
                      </th>
                      <th className="py-2 pe-5 text-end font-medium">
                        {t("expiring.table.renew")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-line-subtle last:border-0">
                        <td className="py-3 ps-5 pe-4 align-top">
                          <p className="text-ink">{KIND_LABEL[row.kind](row)}</p>
                          <p className="mt-0.5 text-micro text-muted">
                            {t(`expiring.kind.${row.kind}`)}
                            {row.detail ? ` · ${row.detail}` : ""}
                          </p>
                        </td>
                        <td className="py-3 pe-4 align-top">
                          <p className="whitespace-nowrap text-ink">{day(row.expiresOn)}</p>
                          <p className="mt-1">
                            <Badge tone={TONE[row.state]}>
                              {row.state === "expired"
                                ? t("expiring.state.expired", { days: -row.daysLeft })
                                : row.state === "beforeDeposit"
                                  ? t("expiring.state.beforeDeposit")
                                  : row.state === "soon"
                                    ? t("expiring.state.soon", { days: row.daysLeft })
                                    : t("expiring.state.later", { days: row.daysLeft })}
                            </Badge>
                          </p>
                        </td>
                        <td className="py-3 pe-4 align-top">
                          {row.breaks.length === 0 ? (
                            <p className="text-micro leading-relaxed text-muted">
                              {t("expiring.breaks.nothingOpen")}
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-1">
                              {row.breaks.map((consequence) => (
                                <li key={consequence.href}>
                                  <Link
                                    href={consequence.href}
                                    className="text-tiny text-accent-ink hover:underline"
                                  >
                                    {consequence.label}
                                  </Link>
                                  {consequence.beforeDeposit ? (
                                    <span className="ms-2 text-micro font-semibold text-critical-ink">
                                      {t("expiring.breaks.beforeDeposit")}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="py-3 pe-5 text-end align-top">
                          {row.renewHref ? (
                            <Link href={row.renewHref}>
                              <Button
                                variant={
                                  row.state === "expired" || row.state === "beforeDeposit"
                                    ? "primary"
                                    : "secondary"
                                }
                                size="small"
                              >
                                {t(`expiring.renew.${row.kind}`)}
                              </Button>
                            </Link>
                          ) : (
                            <Button size="small" disabledReason={t("expiring.noRenewScreen")}>
                              {t(`expiring.renew.${row.kind}`)}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("expiring.summary.title")}</h2>
            <dl className="mt-3">
              <Line label={t("expiring.summary.expired")} value={report.expired} />
              <Line
                label={t("expiring.summary.beforeDeposit")}
                value={report.beforeDeposit}
                emphasis
              />
              <Line
                label={t("expiring.summary.soon", { days: EXPIRING_WITHIN_DAYS })}
                value={report.soon}
              />
              <Line label={t("expiring.summary.total")} value={report.total} />
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("expiring.summary.computed")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <Info className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("expiring.notHere.title")}</h2>
            </div>
            <p className="mt-3 text-micro leading-relaxed text-secondary">
              {t("expiring.notHere.intro")}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              <li className="text-micro leading-relaxed text-secondary">
                {t("expiring.notHere.requiredValidity")}
              </li>
              <li className="text-micro leading-relaxed text-secondary">
                {t("expiring.notHere.supplierValidity")}
              </li>
              <li className="text-micro leading-relaxed text-secondary">
                {t("expiring.notHere.bidBond")}
              </li>
              <li className="text-micro leading-relaxed text-secondary">
                {report.proformaValidityConfirmed
                  ? t("expiring.notHere.proformaConfirmed")
                  : t("expiring.notHere.proformaUnconfirmed")}
              </li>
              <li className="text-micro leading-relaxed text-secondary">
                {t("expiring.notHere.prices")}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}

function Line({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0">
      <dt className={`text-tiny ${emphasis && value > 0 ? "text-critical-ink" : "text-secondary"}`}>
        {label}
      </dt>
      <dd
        className={`ms-auto text-end text-tiny tabular-nums ${
          emphasis && value > 0 ? "font-semibold text-critical-ink" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
