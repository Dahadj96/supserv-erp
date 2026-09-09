import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Fragment } from "react";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can, canAny } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listPeople } from "@/domain/people";
import type { CautionState, CrewState } from "@/domain/project/cautions";
import { needsAttention } from "@/domain/project/cautions";
import { nextFinalAccount } from "@/domain/project/final";
import type { SituationState } from "@/domain/project/progress";
import { nextRetentionRelease } from "@/domain/project/retention";
import { contractCandidates, contractOf, withAmendments } from "@/domain/project/situations";
import { getProject } from "@/domain/project/store";
import { Link } from "@/i18n/navigation";
import {
  crewAction,
  crewUpdateAction,
  saveFinalAccountAction,
  saveRetentionReleaseAction,
  situationApprovedAction,
  situationSubmittedAction,
} from "./actions";
import { RecordPanels } from "./record";

/**
 * Screen 16 — the project.
 *
 * Two numbers side by side that most systems never show together: physical
 * progress, which a chef de chantier estimated, and financial progress, which
 * is arithmetic over the situations the client has signed. The gap between them
 * is work done and not yet asked for — money the company has already spent.
 *
 * The banner is the caution de bonne exécution expiring before the réception
 * provisoire. Same shape as the tender dossier's "expires before deposit", and
 * the same reason: a guarantee valid today and lapsed on the day it is needed
 * is one the client can call in.
 */
export const dynamic = "force-dynamic";

const SITUATION_TONE: Record<SituationState, "neutral" | "warning" | "accent" | "good"> = {
  draft: "neutral",
  submitted: "warning",
  approved: "accent",
  paid: "good",
};

const CAUTION_TONE: Record<CautionState, "good" | "warning" | "critical" | "neutral"> = {
  live: "good",
  released: "neutral",
  expiring: "warning",
  expiresBeforeAcceptance: "critical",
  lapsed: "critical",
};

const CREW_TONE: Record<CrewState, "good" | "warning" | "critical" | "neutral" | "accent"> = {
  onSite: "good",
  proposed: "accent",
  expiring: "warning",
  expired: "critical",
  left: "neutral",
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ opened?: string; recorded?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { opened, recorded, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const p = await getProject(id);
  if (!p) notFound();
  const [contracts, people, contract, final, release] = await Promise.all([
    contractCandidates(p.dealId),
    listPeople("all", 300),
    contractOf(id),
    // The project is already in hand — see the note on `nextFinalAccount`.
    nextFinalAccount(id, p),
    nextRetentionRelease(id, p),
  ]);
  // What is under contract TODAY: the marché the person typed, plus what each
  // avenant added. Progress against the original would read past 100%.
  const underContract = withAmendments(p.amountExcl, contract?.amendments ?? []);

  const format = await getFormatter({ locale });
  const money = (value: string) =>
    `${format.number(Number(value), { maximumFractionDigits: 0 })} ${p.currency}`;
  /** A rate, as it was typed. `numeric(6,3)` reads back "1.000". */
  const rate = (value: string | null) => (value === null ? "—" : String(Number(value)));

  const urgent = p.cautions.filter((c) => needsAttention(c.state));
  const siteWrite = can(session.role, "works.issue");
  const datesWrite = canAny(session.role, ["works.issue", "invoices.issue"]);
  const openDraft = p.progress.situations.find((s) => s.number === null);
  const today = new Date().toISOString().slice(0, 10);
  // The inline inputs on a table row: INPUT without its w-full, so a width
  // class is the width.
  const COMPACT = INPUT.replace("w-full ", "");

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {p.code} — {p.object}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {p.client}
            {p.wilaya ? ` · ${p.wilaya}` : ""}
            {p.startedOn ? ` · ${t("project.startedOn", { on: p.startedOn })}` : ""}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {/* One draft at a time: the button continues it when there is one,
              and opens the next number when there is not. */}
          <Link href={`/projects/${id}/situation`}>
            <Button
              variant="primary"
              disabledReason={siteWrite ? undefined : t("documents.notAllowed")}
            >
              {openDraft
                ? t("project.continueSituation", { n: openDraft.sequence })
                : t("project.nextSituation", { n: p.situationsTotal + 1 })}
            </Button>
          </Link>
        </div>
      </div>

      {opened ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("project.openedOk", { code: p.code })}
        </p>
      ) : null}
      {recorded ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t.has(`projectRecord.ok.${recorded}`) ? t(`projectRecord.ok.${recorded}`) : recorded}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`projectRecord.error.${error}`) ? t(`projectRecord.error.${error}`) : error}
        </p>
      ) : null}

      {urgent.length > 0 ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[940px] text-tiny leading-relaxed text-critical-ink">
            {t(`project.cautionBanner.${urgent[0]?.state}`, {
              kind: t(`project.caution.${urgent[0]?.kind}`),
              on: urgent[0]?.expiresOn ?? "—",
            })}
          </p>
        </div>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("project.situations.title")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("project.situations.approvedToDate", {
                  amount: money(p.progress.money.approved),
                })}
              </span>
            </div>

            {p.progress.situations.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("project.situations.none")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">N°</th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("project.column.period")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">{t("project.column.amount")}</th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("project.column.retention")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("project.column.submitted")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium">
                      {t("project.column.status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.progress.situations.map((s) => {
                    /*
                      The two dates the client controls, recorded the day the
                      paper moves. A draft has been nowhere; an issued one is
                      submitted, then approved by a named engineer. The form
                      sits on its own row under the situation, full width,
                      because seven columns on a 12-inch panel leave no room
                      for a name.
                    */
                    const followUp =
                      s.number === null
                        ? null
                        : !s.submittedOn
                          ? "submit"
                          : !s.approvedOn
                            ? "approve"
                            : null;
                    return (
                      <Fragment key={s.documentId}>
                        <tr className={followUp ? "" : "border-b border-line-subtle last:border-0"}>
                          <td className="px-5 py-2.5 text-muted">{s.sequence}</td>
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/documents/${s.documentId}`}
                              className="text-ink hover:underline"
                            >
                              {s.number ?? t("project.draft")}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-end tabular-nums text-ink">
                            {money(s.amountExcl)}
                          </td>
                          <td className="px-3 py-2.5 text-end tabular-nums text-secondary">
                            {money(s.retention)}
                          </td>
                          <td className="px-3 py-2.5 text-secondary">{s.submittedOn ?? "—"}</td>
                          <td className="px-5 py-2.5">
                            {s.waitingDays !== null ? (
                              <Badge tone="warning">
                                {t("project.waitingDays", { days: s.waitingDays })}
                              </Badge>
                            ) : (
                              <Badge tone={SITUATION_TONE[s.state]}>
                                {t(`project.situation.${s.state}`)}
                              </Badge>
                            )}
                            {s.approvedOn ? (
                              <span className="ms-2 text-micro text-muted">
                                {t("project.approvedOnBy", { on: s.approvedOn })}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                        {followUp === "submit" ? (
                          <tr className="border-b border-line-subtle last:border-0">
                            <td colSpan={6} className="px-5 pb-2.5">
                              <form
                                action={situationSubmittedAction.bind(null, locale, id)}
                                className="flex flex-wrap items-center justify-end gap-2"
                              >
                                <input type="hidden" name="documentId" value={s.documentId} />
                                <span className="text-micro text-secondary">
                                  {t("project.submittedOn")}
                                </span>
                                <input
                                  type="date"
                                  name="on"
                                  defaultValue={today}
                                  aria-label={t("project.submittedOn")}
                                  className={`${COMPACT} h-[28px] w-[150px]`}
                                />
                                <Button
                                  type="submit"
                                  variant="secondary"
                                  size="small"
                                  disabledReason={
                                    datesWrite ? undefined : t("documents.notAllowed")
                                  }
                                >
                                  {t("projectRecord.record")}
                                </Button>
                              </form>
                            </td>
                          </tr>
                        ) : followUp === "approve" ? (
                          <tr className="border-b border-line-subtle last:border-0">
                            <td colSpan={6} className="px-5 pb-2.5">
                              <form
                                action={situationApprovedAction.bind(null, locale, id)}
                                className="flex flex-wrap items-center justify-end gap-2"
                              >
                                <input type="hidden" name="documentId" value={s.documentId} />
                                <span className="text-micro text-secondary">
                                  {t("project.approvedOn")}
                                </span>
                                <input
                                  type="date"
                                  name="on"
                                  defaultValue={today}
                                  aria-label={t("project.approvedOn")}
                                  className={`${COMPACT} h-[28px] w-[150px]`}
                                />
                                <span className="text-micro text-secondary">
                                  {t("project.approvedBy")}
                                </span>
                                <input
                                  name="by"
                                  placeholder={t("project.approvedByHint")}
                                  aria-label={t("project.approvedBy")}
                                  className={`${COMPACT} h-[28px] w-[220px]`}
                                />
                                <Button
                                  type="submit"
                                  variant="secondary"
                                  size="small"
                                  disabledReason={
                                    datesWrite ? undefined : t("documents.notAllowed")
                                  }
                                >
                                  {t("projectRecord.record")}
                                </Button>
                              </form>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("project.crew.title")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("project.crew.count", {
                  n: p.crew.filter((c) => c.state !== "left").length,
                })}
              </span>
            </div>

            {p.crew.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("project.crew.none")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">{t("project.column.name")}</th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("project.column.trade")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("project.column.certification")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("project.column.expires")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("project.column.onSiteSince")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium">
                      {t("project.column.status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.crew.map((member) => (
                    <tr key={member.id} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-2.5 text-ink">{member.name}</td>
                      <td className="px-3 py-2.5 text-secondary">
                        {member.role ?? member.trade ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{member.certification ?? "—"}</td>
                      <td className="px-3 py-2.5 text-secondary">
                        {member.certificationExpiresOn ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{member.onSiteSince ?? "—"}</td>
                      <td className="px-5 py-2.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={CREW_TONE[member.state]}>
                            {t(`project.crewState.${member.state}`)}
                          </Badge>
                          {/* A proposed man arrives; a man on site leaves.
                              One date each, recorded the day it happens. */}
                          {member.state !== "left" ? (
                            <form
                              action={crewUpdateAction.bind(null, locale, id)}
                              className="flex items-center gap-1.5"
                            >
                              <input type="hidden" name="crewId" value={member.id} />
                              <input
                                type="hidden"
                                name="which"
                                value={member.state === "proposed" ? "arrived" : "left"}
                              />
                              <input
                                type="date"
                                name="on"
                                defaultValue={today}
                                aria-label={
                                  member.state === "proposed"
                                    ? t("projectRecord.crew.arrived")
                                    : t("projectRecord.crew.left")
                                }
                                className={`${COMPACT} h-[28px] w-[150px]`}
                              />
                              <Button
                                type="submit"
                                variant="ghost"
                                size="small"
                                disabledReason={siteWrite ? undefined : t("documents.notAllowed")}
                              >
                                {member.state === "proposed"
                                  ? t("projectRecord.crew.arrived")
                                  : t("projectRecord.crew.left")}
                              </Button>
                            </form>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Who goes on site next. From screen 51's people, with their
                tickets following them — the row above shows the soonest
                expiry the moment they are added. */}
            <form
              action={crewAction.bind(null, locale, id)}
              className="flex flex-wrap items-end gap-2 border-t border-line-subtle px-5 py-3.5"
            >
              <label className="min-w-[220px] flex-1">
                <span className="text-micro text-secondary">{t("projectRecord.crew.person")}</span>
                <select name="personId" className={`${INPUT} mt-1`} defaultValue="">
                  <option value="">{t("projectRecord.crew.pick")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                      {person.trade ? ` · ${person.trade}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-[160px]">
                <span className="text-micro text-secondary">{t("projectRecord.crew.role")}</span>
                <input name="role" className={`${INPUT} mt-1`} />
              </label>
              <label className="w-[160px]">
                <span className="text-micro text-secondary">
                  {t("projectRecord.crew.onSiteSince")}
                </span>
                <input type="date" name="onSiteSince" className={`${INPUT} mt-1`} />
              </label>
              <Button
                type="submit"
                variant="secondary"
                disabledReason={siteWrite ? undefined : t("documents.notAllowed")}
              >
                {t("projectRecord.crew.add")}
              </Button>
              <span className="basis-full text-micro leading-relaxed text-muted">
                {t("projectRecord.crew.hint")}
              </span>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("project.panel.title")}</h2>
              <span className="ms-auto">
                <Badge
                  tone={
                    p.state === "warranty" ? "good" : p.state === "closed" ? "neutral" : "accent"
                  }
                >
                  {t(`projects.state.${p.state}`)}
                </Badge>
              </span>
            </div>
            <dl className="mt-3">
              {[
                { key: "client", value: p.client },
                { key: "contract", value: p.contractRef ?? "—" },
                {
                  key: "amount",
                  // What is under contract today. When an avenant has moved
                  // it, the marché's own figure is named beside it — the two
                  // are different facts and the client quotes both.
                  value: underContract
                    ? underContract === p.amountExcl
                      ? money(underContract)
                      : `${money(underContract)} (${t("amendment.wasMarche", {
                          amount: money(p.amountExcl as string),
                        })})`
                    : "—",
                },
                { key: "started", value: p.startedOn ?? "—" },
                {
                  key: "end",
                  // The délai in force, with the signed one beside it when an
                  // avenant de prolongation has moved it. Penalties run from
                  // the first of those two and arguments start over the second.
                  value: p.deadline
                    ? p.deadline === p.contractualEnd
                      ? p.deadline
                      : `${p.deadline} (${t("amendment.wasDeadline", {
                          date: p.contractualEnd ?? "—",
                        })})`
                    : "—",
                },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2"
                >
                  <dt className="shrink-0 text-tiny text-secondary">
                    {t(`project.panel.${row.key}`)}
                  </dt>
                  <dd className="ms-auto text-end text-tiny text-ink">{row.value}</dd>
                </div>
              ))}
              {p.daysLeft !== null ? (
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("project.panel.daysLeft")}</dt>
                  <dd className="ms-auto">
                    <Badge
                      tone={p.daysLeft < 0 ? "critical" : p.daysLeft < 30 ? "warning" : "neutral"}
                    >
                      {p.daysLeft < 0
                        ? t("project.lateBy", { days: -p.daysLeft })
                        : t("project.daysLeft", { days: p.daysLeft })}
                    </Badge>
                  </dd>
                </div>
              ) : null}
            </dl>

            {/* THE TWO NUMBERS. Physical is somebody's estimate and says so;
                financial is arithmetic over the situations the client signed.
                The gap is work done and not yet asked for. */}
            <div className="mt-4 flex flex-col gap-3">
              {[
                { key: "physical", value: p.progress.physicalPercent },
                { key: "financial", value: p.progress.financialPercent },
              ].map((bar) => (
                <div key={bar.key}>
                  <div className="flex items-baseline gap-3">
                    <span className="text-tiny text-secondary">
                      {t(`project.progress.${bar.key}`)}
                    </span>
                    <span className="ms-auto text-tiny tabular-nums text-ink">
                      {bar.value === null ? "—" : `${bar.value}%`}
                    </span>
                  </div>
                  <span
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-warning"
                      style={{ width: `${bar.value ?? 0}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-3 text-micro leading-relaxed text-muted">
              {p.progress.aheadOfBilling === null
                ? t("project.progress.noEstimate")
                : p.progress.aheadOfBilling > 0
                  ? t("project.progress.ahead", { points: p.progress.aheadOfBilling })
                  : t("project.progress.level")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("project.reception.title")}</h2>
            <dl className="mt-3">
              {[
                {
                  key: "provisoire",
                  value: p.pvProvisoireOn,
                  planned: p.pvProvisoirePlanned,
                },
                { key: "definitive", value: p.pvDefinitiveOn, planned: null },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2"
                >
                  <dt className="text-tiny text-secondary">{t(`project.reception.${row.key}`)}</dt>
                  <dd className="ms-auto text-end">
                    {row.value ? (
                      <span className="text-tiny text-ink">{row.value}</span>
                    ) : row.planned ? (
                      <Badge tone="warning">
                        {t("project.reception.planned", { on: row.planned })}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">{t("project.reception.notIssued")}</Badge>
                    )}
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline gap-3 py-2">
                <dt className="text-tiny text-secondary">{t("project.reception.warranty")}</dt>
                <dd className="ms-auto text-tiny text-ink">
                  {p.warrantyMonths ? t("project.months", { n: p.warrantyMonths }) : "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("project.retention.title")}</h2>
            <dl className="mt-3">
              <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                <dt className="text-tiny text-secondary">{t("project.retention.rate")}</dt>
                <dd className="ms-auto text-tiny tabular-nums text-ink">
                  {rate(p.retentionPct)} %
                </dd>
              </div>
              <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                <dt className="text-tiny text-secondary">{t("project.retention.held")}</dt>
                <dd className="ms-auto">
                  <Badge tone={Number(p.progress.money.retentionHeld) > 0 ? "warning" : "neutral"}>
                    {money(p.progress.money.retentionHeld)}
                  </Badge>
                </dd>
              </div>
              {Number(p.progress.money.retentionReleased) > 0 ? (
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("retention.returned")}</dt>
                  <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                    {money(p.progress.money.retentionReleased)}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline gap-3 py-2">
                <dt className="text-tiny text-secondary">{t("project.retention.release")}</dt>
                <dd className="ms-auto text-end text-tiny text-ink">
                  {p.retentionReleases.on ?? "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t(`project.retention.basis.${p.retentionReleases.basis}`)}
            </p>

            {/*
              THE MONEY COMES BACK BECAUSE SOMEBODY ASKS. No client volunteers
              the retenue de garantie, and nothing here invoices it by itself:
              the button writes the demande, the wilaya pays it, and the marché
              closes when the money arrives — not when the letter goes out.
            */}
            {release ? (
              <div className="mt-3 border-t border-line-subtle pt-3">
                {release.issued.length > 0 ? (
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {release.issued.map((one) => (
                      <li key={one.documentId} className="flex items-baseline gap-3 text-tiny">
                        <Link
                          href={`/documents/${one.documentId}`}
                          className="text-accent-ink hover:underline"
                        >
                          {one.number ?? t("retention.theDraft")}
                        </Link>
                        <span className="ms-auto text-micro text-muted">{one.issuedOn ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {release.blocked ? (
                  <p className="text-micro leading-relaxed text-muted">
                    {t(`retention.blocked.${release.blocked}`)}
                  </p>
                ) : (
                  <form
                    action={saveRetentionReleaseAction.bind(null, locale, id)}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <label className="w-[150px]">
                      <span className="text-micro text-secondary">{t("retention.issuedOn")}</span>
                      <input
                        type="date"
                        name="issuedOn"
                        defaultValue={release.draft?.issuedOn ?? today}
                        className={`${INPUT} mt-1`}
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="secondary"
                      disabledReason={
                        !can(session.role, "invoices.issue")
                          ? t("documents.notAllowed")
                          : !release.nextNumber
                            ? t("retention.blocked.noSeries")
                            : undefined
                      }
                    >
                      {release.draft ? t("retention.redraw") : t("retention.ask")}
                    </Button>
                    <p className="basis-full text-micro leading-relaxed text-muted">
                      {t("retention.why", {
                        amount: `${money(release.toAsk)}`,
                      })}
                    </p>
                  </form>
                )}
              </div>
            ) : null}
          </section>

          {p.cautions.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-tiny font-semibold text-ink">{t("project.cautions.title")}</h2>
                <span className="ms-auto text-micro text-muted">
                  {t("project.cautions.live", {
                    n: p.cautions.filter((c) => c.state !== "released").length,
                  })}
                </span>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {p.cautions.map((caution) => (
                  <li key={caution.id} className="flex items-baseline gap-3">
                    <span className="text-tiny text-secondary">
                      {t(`project.caution.${caution.kind}`)}
                      {caution.pct ? ` — ${caution.pct} %` : ""}
                    </span>
                    <span className="ms-auto shrink-0">
                      <Badge tone={CAUTION_TONE[caution.state]}>
                        {caution.expiresOn && caution.state !== "released"
                          ? t("project.expiresOn", { on: caution.expiresOn })
                          : t(`project.cautionState.${caution.state}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-micro leading-relaxed text-muted">
                {t("project.cautions.why")}
              </p>
            </section>
          ) : null}

          {/*
            PÉNALITÉS DE RETARD — a figure the CLIENT may apply, never one this
            system withholds. It shows nothing at all until somebody has read
            the rate, the ceiling and the base off the CCAP, and it says which
            of the three is missing rather than showing a reassuring zero.
          */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("penalty.title")}</h2>
              {p.penalty.capped ? (
                <Badge tone="warning">{t("penalty.atTheCap")}</Badge>
              ) : p.penalty.stillRunning ? (
                <Badge tone="warning">{t("penalty.running")}</Badge>
              ) : null}
            </div>

            {p.penalty.blocked ? (
              <p className="mt-2 text-micro leading-relaxed text-muted">
                {t(`penalty.blocked.${p.penalty.blocked}`)}{" "}
                <a href="#terms" className="text-accent-ink hover:underline">
                  {t("penalty.readTheCcap")}
                </a>
              </p>
            ) : (
              <>
                <dl className="mt-3">
                  {[
                    { key: "deadline", value: p.deadline ?? "—" },
                    {
                      key: "countedTo",
                      value: p.pvProvisoireOn
                        ? t("penalty.toReception", { date: p.pvProvisoireOn })
                        : t("penalty.toToday", { date: p.penalty.countedTo ?? "—" }),
                    },
                    { key: "daysLate", value: String(p.penalty.daysLate) },
                    {
                      key: "basis",
                      value: `${money(p.penalty.basis as string)} ${p.currency} ${t(
                        `projectNew.retentionBase.${p.penaltyBase ?? "excl"}`,
                      )}`,
                    },
                    {
                      key: "rate",
                      // `numeric(6,3)` reads back "1.000", and "1.000‰" in a
                      // French sentence is a thousand per mille to half the
                      // people who see it.
                      value: t("penalty.rateReads", {
                        perMille: rate(p.penaltyPerMille),
                        capPct: rate(p.penaltyCapPct),
                      }),
                    },
                    {
                      key: "cap",
                      value: `${money(p.penalty.cap as string)} ${p.currency}`,
                    },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                    >
                      <dt className="shrink-0 text-tiny text-secondary">
                        {t(`penalty.row.${row.key}`)}
                      </dt>
                      <dd className="ms-auto text-end text-tiny text-ink">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex items-baseline gap-3 border-t border-line pt-3">
                  <span className="text-tiny font-semibold text-ink">
                    {t("penalty.row.amount")}
                  </span>
                  <span className="ms-auto text-[15px] font-semibold tabular-nums text-ink">
                    {money(p.penalty.amount as string)} {p.currency}
                  </span>
                </div>
              </>
            )}

            <p className="mt-3 border-t border-line-subtle pt-3 text-micro leading-relaxed text-muted">
              {t("penalty.why")}
            </p>
            {p.latePenaltyText ? (
              <p className="mt-2 text-micro leading-relaxed text-secondary">
                {t("penalty.f.theirWords", { text: p.latePenaltyText })}
              </p>
            ) : null}
          </section>

          {/*
            THE DÉCOMPTE FINAL — the page that closes the marché. Nothing on it
            is typed: it is the situations, what each withheld, what was paid
            against them and what the clause allows, added up. The button is a
            date and a signature away from a paper the wilaya can check against
            its own file.
          */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("final.title")}</h2>
              {final?.issued ? (
                <Link
                  href={`/documents/${final.issued.documentId}`}
                  className="ms-auto text-micro text-accent-ink hover:underline"
                >
                  {final.issued.number ?? t("final.theDraft")}
                </Link>
              ) : final?.draft ? (
                <Link
                  href={`/documents/${final.draft.documentId}`}
                  className="ms-auto text-micro text-accent-ink hover:underline"
                >
                  {t("final.theDraft")}
                </Link>
              ) : null}
            </div>

            {final && !final.account.blocked ? (
              <>
                <dl className="mt-3">
                  {[
                    { key: "works", value: final.account.worksIncl },
                    { key: "advance", value: `− ${money(final.account.advanceRecovered)}` },
                    { key: "retention", value: `− ${money(final.account.retentionHeld)}` },
                    { key: "netCertified", value: final.account.netCertified },
                    { key: "paid", value: `− ${money(final.account.paid)}` },
                    { key: "penalty", value: `− ${money(final.account.penalty)}` },
                  ].map((row) => (
                    <div
                      key={row.key}
                      className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                    >
                      <dt className="shrink-0 text-tiny text-secondary">
                        {t(`final.row.${row.key}`)}
                      </dt>
                      <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                        {row.value.startsWith("−") ? row.value : money(row.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex items-baseline gap-3 border-t border-line pt-3">
                  <span className="text-tiny font-semibold text-ink">{t("final.row.balance")}</span>
                  <span className="ms-auto text-[15px] font-semibold tabular-nums text-ink">
                    {money(final.account.balance)} {p.currency}
                  </span>
                </div>
                <p className="mt-2 text-micro leading-relaxed text-muted">
                  {t("final.retentionComesBack", {
                    amount: `${money(final.account.retentionToRelease)} ${p.currency}`,
                  })}
                </p>
              </>
            ) : (
              <p className="mt-2 text-micro leading-relaxed text-muted">
                {final ? t(`final.blocked.${final.account.blocked}`) : "—"}
              </p>
            )}

            {final && !final.issued ? (
              <form
                action={saveFinalAccountAction.bind(null, locale, id)}
                className="mt-3 flex flex-wrap items-end gap-2 border-t border-line-subtle pt-3"
              >
                <label className="w-[160px]">
                  <span className="text-micro text-secondary">{t("final.issuedOn")}</span>
                  <input
                    type="date"
                    name="issuedOn"
                    defaultValue={final.draft?.issuedOn ?? new Date().toISOString().slice(0, 10)}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <Button
                  type="submit"
                  variant="secondary"
                  disabledReason={
                    !can(session.role, "invoices.issue")
                      ? t("documents.notAllowed")
                      : final.account.blocked
                        ? t(`final.blocked.${final.account.blocked}`)
                        : !final.nextNumber
                          ? t("final.blocked.noSeries")
                          : undefined
                  }
                >
                  {final.draft ? t("final.redraw") : t("final.draw")}
                </Button>
                <p className="basis-full text-micro leading-relaxed text-muted">{t("final.why")}</p>
              </form>
            ) : null}
          </section>

          <RecordPanels
            locale={locale}
            p={p}
            contracts={contracts}
            contract={contract}
            canWrite={siteWrite}
            canAmend={can(session.role, "offers.issue")}
          />

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("project.fromDeal")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("project.fromDealWhy")}
            </p>
            <Link
              href={`/deals/${p.dealId}`}
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {p.dealRef}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
