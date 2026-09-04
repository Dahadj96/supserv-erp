import { Check, CircleAlert } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { blockingRule } from "@/db/schema/interface";
import { setupState } from "@/domain/setup";
import { Link } from "@/i18n/navigation";

/**
 * Screen 85 — Day one.
 *
 * "Eleven things to set before the first document can be issued", and the
 * sentence that gives the screen its authority: "until the first four rows are
 * done, no invoice can be issued at all."
 *
 * Every row's state is computed (LAW 1). There is no progress table — a step is
 * done when the thing it asks for exists, and it reopens the day that stops
 * being true.
 */
export const dynamic = "force-dynamic";

/** Screen 69 — the four rules that name their source and wait for a person. */
const ACCOUNTANT_RULES = [
  "invoice.stampDutyThreshold",
  "invoice.retentionTreatment",
  "invoice.vatServicesAbroad",
  "proforma.validityPeriod",
] as const;

export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { locale } = await params;
  const { saved } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const state = await setupState();
  const rules = await db.select().from(blockingRule);
  const ruleFor = (code: string) => rules.find((r) => r.code === code);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("setup.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("setup.subtitle")}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/companies">
            <Button variant="ghost">{t("setup.skipForNow")}</Button>
          </Link>
        </div>
      </div>

      <div
        className={`mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 ${
          state.canIssue ? "border-good bg-good-bg" : "border-warning bg-warning-bg"
        }`}
      >
        {state.canIssue ? (
          <Check className="mt-px size-4 shrink-0 text-good-ink" aria-hidden />
        ) : (
          <CircleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
        )}
        <p
          className={`max-w-[900px] text-tiny leading-relaxed ${
            state.canIssue ? "text-good-ink" : "text-warning-ink"
          }`}
        >
          {state.canIssue
            ? t("setup.canIssue")
            : t("setup.cannotIssue", {
                missing: state.missing.map((m) => t(`setup.step.${m}`)).join(", "),
              })}
        </p>
      </div>

      {saved ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("setup.saved")}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("setup.beforeAnything")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("setup.doneOf", { done: state.done, total: state.total })}
              </span>
            </div>

            <table className="w-full border-collapse text-tiny">
              <tbody>
                {state.steps.map((step, i) => (
                  <tr key={step.key} className="border-b border-line-subtle last:border-0">
                    <td className="w-9 py-3 ps-5">
                      <span
                        className={`inline-flex size-5 items-center justify-center rounded-full text-micro font-semibold ${
                          step.blocking ? "bg-ink text-on-ink" : "border border-line text-secondary"
                        }`}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-3 pe-4 text-ink">{t(`setup.step.${step.key}`)}</td>
                    <td className="py-3 pe-4 text-secondary">{t(`setup.why.${step.key}`)}</td>
                    <td className="w-[110px] py-3 pe-5 text-end">
                      {step.done ? (
                        <Badge tone="good">{t("setup.done")}</Badge>
                      ) : step.href ? (
                        <Link href={step.href}>
                          <Button variant={step.blocking ? "primary" : "secondary"} size="small">
                            {t(`setup.verb.${step.verb}`)}
                          </Button>
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("setup.willNotInvent")}</h2>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Panel
                tone="critical"
                title={t("setup.notInvent.identityTitle")}
                body={t("setup.notInvent.identityBody")}
              />
              <Panel
                tone="warning"
                title={t("setup.notInvent.numberingTitle")}
                body={t("setup.notInvent.numberingBody")}
              />
              <Panel
                tone="accent"
                title={t("setup.notInvent.ratesTitle")}
                body={t("setup.notInvent.ratesBody")}
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("setup.readFromLater")}</h2>
            <dl className="mt-3">
              {(
                [
                  "identity",
                  "logo",
                  "vat",
                  "numbering",
                  "bank",
                  "roles",
                  "mailbox",
                  "storage",
                ] as const
              ).map((key) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`setup.step.${key}`)}</dt>
                  <dd className="ms-auto text-end text-tiny text-muted">
                    {t(`setup.readAt.${key}`)}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded-[var(--radius-control)] bg-good-bg p-3">
              <p className="text-tiny font-semibold text-good-ink">{t("setup.typedOnceTitle")}</p>
              <p className="mt-1 text-micro leading-relaxed text-good-ink">
                {t("setup.typedOnceBody")}
              </p>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("setup.fourRules")}</h2>
              <span className="ms-auto text-micro text-muted">{t("setup.screenSixtyNine")}</span>
            </div>
            <dl className="mt-3">
              {ACCOUNTANT_RULES.map((code) => {
                const rule = ruleFor(code);
                return (
                  <div
                    key={code}
                    className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                  >
                    <dt className="text-tiny text-secondary">{t(`setup.rule.${code}`)}</dt>
                    <dd className="ms-auto shrink-0">
                      {rule?.confirmedOn ? (
                        <Badge tone="good">
                          {t("setup.confirmedBy", { who: rule.confirmedBy ?? "—" })}
                        </Badge>
                      ) : (
                        <Badge tone="warning">{t("setup.unconfirmed")}</Badge>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("setup.fourRulesBody")}</p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("setup.emptiestDay")}</h2>
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-[var(--radius-control)] border border-line bg-plane p-3">
                <p className="text-tiny font-semibold text-ink">{t("setup.everyListEmptyTitle")}</p>
                <p className="mt-1 text-micro leading-relaxed text-secondary">
                  {t("setup.everyListEmptyBody")}
                </p>
              </div>
              <div className="rounded-[var(--radius-control)] border border-line bg-plane p-3">
                <p className="text-tiny font-semibold text-ink">{t("setup.noFakeDataTitle")}</p>
                <p className="mt-1 text-micro leading-relaxed text-secondary">
                  {t("setup.noFakeDataBody")}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Panel({
  tone,
  title,
  body,
}: {
  tone: "critical" | "warning" | "accent";
  title: string;
  body: string;
}) {
  const skin = {
    critical: "bg-critical-bg text-critical-ink",
    warning: "bg-warning-bg text-warning-ink",
    accent: "bg-accent-bg text-accent-ink",
  }[tone];

  return (
    <div className={`rounded-[var(--radius-control)] p-3 ${skin}`}>
      <p className="text-tiny font-semibold">{title}</p>
      <p className="mt-1 text-micro leading-relaxed">{body}</p>
    </div>
  );
}
