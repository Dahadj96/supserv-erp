import { ArrowRight, Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BEHAVIOUR, isImpossible, waitingFor } from "@/domain/approval/gates";
import { gates, requests } from "@/domain/approval/store";
import { decideAction } from "./actions";

/**
 * Screen 65 — Approvals.
 *
 * "The audit log records what happened. These rules stop it happening until
 * someone with the authority agrees. Different jobs — the system needs both."
 *
 * And the card that answers the obvious objection for a company of one:
 *
 * "If you are the Gérant and the Commercial at once, these gates cost you a
 * click each. Keep them anyway. The value is not the second person — it is that
 * six months later the audit log says why the margin was 11.4% on that job, and
 * you are not reconstructing it from memory."
 */
export const dynamic = "force-dynamic";

const MONTH = 30 * 86_400_000;

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; decided?: string }>;
}) {
  const { locale } = await params;
  const { error, decided } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const all = await gates();
  const now = new Date();
  const view = waitingFor(await requests({ status: "waiting" }), all, session.role);
  const recent = (await requests({ since: new Date(now.getTime() - MONTH) })).filter(
    (row) => row.status !== "waiting",
  );

  const stamp = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const roleName = (role: string) => (t.has(`users.${role}`) ? t(`users.${role}`) : role);

  const label = (code: string) =>
    t.has(`approvals.gate.${code}`) ? t(`approvals.gate.${code}`) : code;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">{t("approvals.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("approvals.subtitle", { n: view.mine, total: view.requests.length })}
          </p>
        </div>
      </div>

      <div className="mx-4 mt-4 flex flex-wrap items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3 md:mx-7">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="min-w-0 flex-1 text-tiny leading-relaxed text-accent-ink">
          {t("approvals.logVsGate")}
        </p>
      </div>

      {decided ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          {t(`approvals.${decided}`)}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`approvals.error.${error}`) ? t(`approvals.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          {view.requests.length === 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-6">
              <p className="text-tiny text-ink">{t("approvals.nothingWaiting")}</p>
              <p className="mt-2 text-micro leading-relaxed text-muted">
                {t("approvals.nothingWaitingWhy")}
              </p>
            </section>
          ) : null}

          {view.requests.map((row) => {
            const gate = all.find((g) => g.code === row.gateCode);
            const mine = gate?.role === session.role;
            const keys = [
              ...new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})]),
            ];

            return (
              <section
                key={row.id}
                className="rounded-[var(--radius-card)] border border-line bg-surface"
              >
                <div className="border-b border-line-subtle px-5 py-3.5">
                  <h2 className="text-tiny font-semibold text-ink">{row.subject}</h2>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-micro text-muted">
                    <Badge tone="warning">
                      {t("approvals.needsRole", { role: roleName(gate?.role ?? "gerant") })}
                    </Badge>
                    <span>
                      {t("approvals.requestedBy", { who: row.requestedBy })} ·{" "}
                      {stamp.format(row.requestedAt)}
                    </span>
                  </p>
                </div>

                {/*
                  Before and after, frozen onto the request. Six weeks later the
                  before may no longer exist — the offer was re-priced, the quote
                  expired — and showing today's values against an August decision
                  would be reconstructing history.
                */}
                <table className="w-full border-collapse text-tiny">
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key} className="border-b border-line-subtle">
                        <td className="w-[30%] py-2.5 ps-5 pe-4 text-secondary">
                          {t.has(`approvals.field.${key}`) ? t(`approvals.field.${key}`) : key}
                        </td>
                        <td className="py-2.5 pe-4 text-muted line-through decoration-line">
                          {row.before?.[key] ?? "—"}
                        </td>
                        <td className="w-[1%] py-2.5 pe-3">
                          <ArrowRight className="size-3.5 text-muted" aria-hidden />
                        </td>
                        <td className="py-2.5 pe-5 font-medium text-ink">
                          {row.after?.[key] ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="px-5 py-3.5">
                  <p className="text-micro text-secondary">{t("approvals.theirReason")}</p>
                  {row.reasonCode ? (
                    <p className="mt-1">
                      <Badge tone="accent">
                        {t.has(`approvals.reason.${row.reasonCode}`)
                          ? t(`approvals.reason.${row.reasonCode}`)
                          : row.reasonCode}
                      </Badge>
                    </p>
                  ) : null}
                  {/* The sentence in their own words. This is the thing somebody
                      reads in six months; a reason code alone answers nothing. */}
                  <p className="mt-1.5 text-tiny leading-relaxed text-ink">
                    {row.justification ?? "—"}
                  </p>
                </div>

                <form className="flex flex-wrap items-end gap-3 border-t border-line-subtle px-5 py-3.5">
                  <input type="hidden" name="requestId" value={row.id} />
                  <p className="text-micro text-critical-ink">{t("approvals.blockedUntil")}</p>
                  <label className="min-w-[180px] flex-1">
                    <span className="text-micro text-secondary">{t("approvals.note")}</span>
                    <input name="note" className={`${INPUT} mt-1`} />
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    formAction={decideAction.bind(null, locale, false)}
                    disabledReason={mine ? undefined : t("approvals.notYours")}
                  >
                    {t("approvals.decline")}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    formAction={decideAction.bind(null, locale, true)}
                    disabledReason={mine ? undefined : t("approvals.notYours")}
                  >
                    {t("approvals.approve")}
                  </Button>
                </form>

                {row.requestedBy === session.userId && mine ? (
                  // Allowed, and recorded as such. A gate that refused would be
                  // a gate somebody routes around by not asking.
                  <p className="border-t border-line-subtle px-5 py-2.5 text-micro text-muted">
                    {t("approvals.selfApprovalNote")}
                  </p>
                ) : null}
              </section>
            );
          })}

          {recent.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">{t("approvals.decided")}</h2>
              </div>
              <ul className="flex flex-col">
                {recent.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-tiny text-ink">
                      {row.subject}
                    </span>
                    {row.selfApproved ? (
                      <Badge tone="neutral">{t("approvals.selfApproved")}</Badge>
                    ) : null}
                    <Badge tone={row.status === "approved" ? "good" : "serious"}>
                      {t(`approvals.status.${row.status}`)}
                    </Badge>
                    <span className="shrink-0 text-micro text-muted">
                      {row.decidedAt ? stamp.format(row.decidedAt) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("approvals.whatIsGated")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("approvals.nRules", { n: all.length })}
              </span>
            </div>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {all.map((gate) => (
                <div key={gate.code} className="flex items-baseline gap-3">
                  <dt className="min-w-0 text-secondary">
                    {label(gate.code)}
                    {gate.threshold !== null ? (
                      <span className="ms-1 text-muted">
                        {t("approvals.atThreshold", { n: gate.threshold })}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="ms-auto shrink-0">
                    {isImpossible(gate) ? (
                      // Not a permission nobody has — a fact about the code.
                      // LAW 5 is structural; there is no path that edits an
                      // issued document, so there is nothing to approve.
                      <Badge tone="neutral">{t("approvals.nobodyNotPossible")}</Badge>
                    ) : (
                      <Badge tone="warning">{roleName(gate.role)}</Badge>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("approvals.howAGateBehaves")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {Object.entries(BEHAVIOUR).map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="min-w-0 text-secondary">{t(`approvals.behaviour.${key}`)}</dt>
                  <dd className="ms-auto shrink-0">
                    <Badge tone={value === "blockedNotWarned" ? "critical" : "good"}>
                      {t(`approvals.behaviourValue.${value}`)}
                    </Badge>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("approvals.oneManCompany")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {t("approvals.oneManCompanyBody")}
            </p>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("approvals.selfApproval")}</dt>
                <dd className="ms-auto">
                  <Badge tone="warning">{t("approvals.allowedStillRecorded")}</Badge>
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("approvals.delegation")}</dt>
                <dd className="ms-auto text-muted">{t("approvals.delegationLater")}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}
