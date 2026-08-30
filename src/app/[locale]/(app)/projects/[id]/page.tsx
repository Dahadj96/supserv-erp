import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import type { CautionState, CrewState } from "@/domain/project/cautions";
import { needsAttention } from "@/domain/project/cautions";
import type { SituationState } from "@/domain/project/progress";
import { getProject } from "@/domain/project/store";
import { Link } from "@/i18n/navigation";

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
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const p = await getProject(id);
  if (!p) notFound();

  const format = await getFormatter({ locale });
  const money = (value: string) =>
    `${format.number(Number(value), { maximumFractionDigits: 0 })} ${p.currency}`;

  const urgent = p.cautions.filter((c) => needsAttention(c.state));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">
          {p.code} — {p.object}
        </h1>
        <p className="mt-1 text-tiny text-muted">
          {p.client}
          {p.wilaya ? ` · ${p.wilaya}` : ""}
          {p.startedOn ? ` · ${t("project.startedOn", { on: p.startedOn })}` : ""}
        </p>
      </div>

      {urgent.length > 0 ? (
        <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[940px] text-tiny leading-relaxed text-critical-ink">
            {t(`project.cautionBanner.${urgent[0]?.state}`, {
              kind: t(`project.caution.${urgent[0]?.kind}`),
              on: urgent[0]?.expiresOn ?? "—",
            })}
          </p>
        </div>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
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
                  {p.progress.situations.map((s) => (
                    <tr key={s.documentId} className="border-b border-line-subtle last:border-0">
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
                      </td>
                    </tr>
                  ))}
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
                        <Badge tone={CREW_TONE[member.state]}>
                          {t(`project.crewState.${member.state}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
                { key: "amount", value: p.amountExcl ? money(p.amountExcl) : "—" },
                { key: "started", value: p.startedOn ?? "—" },
                { key: "end", value: p.contractualEnd ?? "—" },
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
                <dd className="ms-auto text-tiny tabular-nums text-ink">{p.retentionPct} %</dd>
              </div>
              <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                <dt className="text-tiny text-secondary">{t("project.retention.held")}</dt>
                <dd className="ms-auto">
                  <Badge tone={Number(p.progress.money.retentionHeld) > 0 ? "warning" : "neutral"}>
                    {money(p.progress.money.retentionHeld)}
                  </Badge>
                </dd>
              </div>
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

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("project.fromEnquiry")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("project.fromEnquiryWhy")}
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
