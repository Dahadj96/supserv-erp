import { Info, Lock } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { countProfile, type ProfileRule, profile, STRUCTURAL } from "@/domain/compliance-profile";
import { Link } from "@/i18n/navigation";
import { confirmRuleAction, seedRulesAction, unconfirmRuleAction } from "./actions";

/**
 * Screen 69 — the compliance profile.
 *
 * Everything in this system that refuses to do something points here. Day one
 * links here for the four rules waiting on the accountant; screen 18 links here
 * from a red row; `check()` reads the same table. Until now the link was a 404,
 * which meant the promise the whole design makes — "an unconfirmed rule warns,
 * and the day somebody confirms it, it refuses" — had no second half.
 *
 * The design draws this table read-only and puts confirmation somewhere else.
 * There is no somewhere else, so the confirmation sits on the row: a name, a
 * date, and an audit entry naming which of our people wrote it down.
 */
export const dynamic = "force-dynamic";

const TONE: Record<string, BadgeTone> = {
  blocks: "critical",
  warns: "warning",
  always: "good",
};

export default async function CompliancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    error?: string;
    confirmed?: string;
    unconfirmed?: string;
    seeded?: string;
  }>;
}) {
  const { locale } = await params;
  const { error, confirmed, unconfirmed, seeded } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const mayConfirm = Boolean(session.role && can(session.role, "settings.company"));
  const rules = await profile();
  const counts = countProfile(rules);
  const today = new Date().toISOString().slice(0, 10);

  const label = (rule: ProfileRule) => (t.has(rule.messageKey) ? t(rule.messageKey) : rule.code);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("compliance.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("compliance.subtitle")}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <a href={`/${locale}/settings/compliance/one-pager`} target="_blank" rel="noreferrer">
            <Button variant="secondary">{t("compliance.export")}</Button>
          </a>
        </div>
      </div>

      <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("compliance.banner")}
        </p>
      </div>

      {confirmed ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("compliance.nowBlocks")}
        </p>
      ) : null}
      {unconfirmed ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-warning-bg px-4 py-2.5 text-tiny text-warning-ink">
          {t("compliance.nowWarns")}
        </p>
      ) : null}
      {seeded ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("compliance.seeded")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`compliance.error.${error}`) ? t(`compliance.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("compliance.activeProfile")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("compliance.ruleCount", {
                  total: counts.total,
                  confirmed: counts.confirmed,
                  unconfirmed: counts.unconfirmed,
                })}
              </span>
            </div>

            {rules.length === 0 ? (
              <div className="p-6">
                <p className="text-tiny text-ink">{t("compliance.noRulesYet")}</p>
                <form action={seedRulesAction.bind(null, locale)} className="mt-3">
                  <Button type="submit" variant="primary" size="small">
                    {t("compliance.writeThemDown")}
                  </Button>
                </form>
              </div>
            ) : (
              <ul>
                {rules.map((rule) => (
                  <li key={rule.code} className="border-b border-line-subtle p-5 last:border-0">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-tiny text-ink">{label(rule)}</p>
                        <p className="mt-0.5 text-micro text-muted">
                          {t("compliance.statedSource", {
                            source: rule.authority ?? t("compliance.noSource"),
                          })}
                        </p>
                        <p className="mt-0.5 text-micro text-muted">
                          {rule.confirmedOn
                            ? rule.selfEvident
                              ? t("compliance.confirmedByItself", { on: rule.confirmedOn })
                              : t("compliance.confirmedBy", {
                                  who: rule.confirmedBy ?? "—",
                                  on: rule.confirmedOn,
                                })
                            : t("compliance.notConfirmed")}
                        </p>
                      </div>
                      <span className="ms-auto shrink-0">
                        <Badge tone={TONE[rule.enforcement] ?? "neutral"}>
                          {t(`compliance.enforcement.${rule.enforcement}`)}
                        </Badge>
                      </span>
                    </div>

                    {!mayConfirm ? null : rule.selfEvident ? (
                      <p className="mt-3 flex items-center gap-1.5 text-micro text-muted">
                        <Lock className="size-3.5" aria-hidden />
                        {t("compliance.decreeConfirmsItself")}
                      </p>
                    ) : rule.confirmedOn ? (
                      <form
                        action={unconfirmRuleAction.bind(null, locale)}
                        className="mt-3 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="code" value={rule.code} />
                        <label className="flex-1">
                          <span className="text-micro text-secondary">
                            {t("compliance.whyTakeItBack")}
                          </span>
                          <input
                            name="reason"
                            className={`${INPUT} mt-1`}
                            placeholder={t("compliance.whyTakeItBackHint")}
                          />
                        </label>
                        <Button type="submit" variant="secondary" size="small">
                          {t("compliance.unconfirm")}
                        </Button>
                      </form>
                    ) : (
                      <form
                        action={confirmRuleAction.bind(null, locale)}
                        className="mt-3 flex flex-wrap items-end gap-2 rounded-[var(--radius-control)] bg-plane p-3"
                      >
                        <input type="hidden" name="code" value={rule.code} />
                        <label className="flex-1">
                          <span className="text-micro text-secondary">
                            {t("compliance.whoSaidSo")}
                          </span>
                          <input
                            name="who"
                            required
                            className={`${INPUT} mt-1`}
                            placeholder={t("compliance.whoSaidSoHint")}
                          />
                        </label>
                        <label className="w-[150px]">
                          <span className="text-micro text-secondary">{t("compliance.on")}</span>
                          <input
                            name="on"
                            type="date"
                            defaultValue={today}
                            className={`${INPUT} mt-1`}
                          />
                        </label>
                        <Button type="submit" variant="primary" size="small">
                          {t("compliance.confirmIt")}
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("compliance.structural")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("compliance.structuralWhat")}
              </span>
            </div>
            <ul>
              {STRUCTURAL.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-tiny text-ink">{t(`compliance.built.${item.key}`)}</p>
                    <p className="mt-0.5 text-micro text-muted">{item.where}</p>
                  </div>
                  <span className="ms-auto shrink-0">
                    <Badge tone="good">{t("compliance.enforcement.always")}</Badge>
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("compliance.structuralWhy")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("compliance.principle")}</h2>
              <span className="ms-auto text-micro text-muted">{t("compliance.principleWhy")}</span>
            </div>
            <p className="mt-3 border-s-2 border-ink ps-3 text-tiny font-medium leading-relaxed text-ink">
              {t("compliance.principleQuote")}
            </p>
            <p className="mt-3 text-micro leading-relaxed text-secondary">
              {t("compliance.principleBody")}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {(["nif", "mentions", "stamp"] as const).map((key) => (
                <div key={key} className="rounded-[var(--radius-control)] border border-line p-3">
                  <p className="text-micro text-muted">
                    <span className="me-2 font-semibold text-critical-ink">
                      {t("compliance.was")}
                    </span>
                    {t(`compliance.wasNow.${key}.was`)}
                  </p>
                  <p className="mt-1.5 text-micro text-ink">
                    <span className="me-2 font-semibold text-good-ink">{t("compliance.now")}</span>
                    {t(`compliance.wasNow.${key}.now`)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("compliance.status")}</h2>
            <dl className="mt-3">
              {(
                [
                  ["rules", counts.total],
                  ["confirmed", counts.confirmed],
                  ["unconfirmed", counts.unconfirmed],
                  ["blocks", counts.blocks],
                  ["warns", counts.warns],
                  ["structural", counts.structural],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`compliance.count.${key}`)}</dt>
                  <dd className="ms-auto text-tiny tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("compliance.whatToDo")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {t("compliance.whatToDoBody")}
            </p>
            <a
              className="mt-3 inline-block"
              href={`/${locale}/settings/compliance/one-pager`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="primary" size="small">
                {t("compliance.exportOnePager")}
              </Button>
            </a>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("compliance.reversible")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">
              {t("compliance.reversibleBody")}
            </p>
            <Link
              className="mt-3 inline-block text-micro font-medium text-accent-ink"
              href="/setup"
            >
              {t("compliance.seeDayOne")}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
