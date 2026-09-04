import { CircleAlert, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { complianceStatus } from "@/domain/control/compliance-status";
import { Link } from "@/i18n/navigation";

/**
 * Screen 27 — Compliance.
 *
 * Screen 69 is the profile: which rules exist and who confirmed each. This is
 * what those rules are doing to the company today, and the half nobody can see
 * anywhere else is the second panel: drafts failing a rule that NOBODY HAS
 * CONFIRMED, and which therefore sail through.
 *
 * That is not a bug. An unconfirmed rule warns and lets you proceed, because
 * the software must not assert a law on its own authority — screen 69's whole
 * argument. But the cost of that decision is a quiet exposure, and this is
 * where it stops being quiet.
 */
export const dynamic = "force-dynamic";

export default async function CompliancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const status = await complianceStatus();

  /** A rule's sentence, by its own message key. Never the code. */
  const ruleText = (key: string) => (t.has(key) ? t(key) : key);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("complianceNow.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("complianceNow.subtitle", {
              confirmed: status.confirmedCount,
              unconfirmed: status.unconfirmedCount,
            })}
          </p>
        </div>
        <div className="ms-auto">
          <Link href="/settings/compliance">
            <Button variant="secondary">{t("complianceNow.theProfile")}</Button>
          </Link>
        </div>
      </div>

      {status.setup.canIssue ? null : (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <div>
            <p className="max-w-[900px] text-tiny leading-relaxed text-critical-ink">
              {t("complianceNow.cannotIssue", {
                missing: status.setup.missing.map((m) => t(`setup.step.${m}`)).join(", "),
              })}
            </p>
            <Link href="/setup" className="mt-1 inline-block text-tiny text-critical-ink underline">
              {t("complianceNow.finishDayOne")}
            </Link>
          </div>
        </div>
      )}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("complianceNow.drafts.title")}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {t("complianceNow.drafts.checked", { count: status.draftsChecked })}
              </span>
            </div>

            {status.drafts.length === 0 ? (
              <p className="p-5 text-tiny leading-relaxed text-secondary">
                {status.draftsChecked === 0
                  ? t("complianceNow.drafts.none")
                  : t("complianceNow.drafts.allClear", { count: status.draftsChecked })}
              </p>
            ) : (
              <ul>
                {status.drafts.map((draft) => (
                  <li
                    key={draft.documentId}
                    className="border-b border-line-subtle p-5 last:border-0"
                  >
                    <div className="flex items-baseline gap-3">
                      <Link
                        href={`/documents/${draft.documentId}`}
                        className="text-tiny text-ink hover:underline"
                      >
                        {t.has(`docTypes.kind.${draft.kind}`)
                          ? t(`docTypes.kind.${draft.kind}`)
                          : draft.kind}
                      </Link>
                      <span className="text-micro text-muted">
                        {draft.counterparty ?? t("complianceNow.noCounterparty")}
                      </span>
                      <span className="ms-auto">
                        <Badge tone={draft.worst === "block" ? "critical" : "warning"}>
                          {draft.worst === "block"
                            ? t("complianceNow.wouldBeRefused")
                            : t("complianceNow.wouldGoThrough")}
                        </Badge>
                      </span>
                    </div>

                    <ul className="mt-2 flex flex-col gap-1.5">
                      {draft.failing.map((finding) => (
                        <li key={finding.code} className="flex items-start gap-2">
                          {finding.severity === "block" ? (
                            <CircleAlert
                              className="mt-px size-3.5 shrink-0 text-critical-ink"
                              aria-hidden
                            />
                          ) : (
                            <TriangleAlert
                              className="mt-px size-3.5 shrink-0 text-warning-ink"
                              aria-hidden
                            />
                          )}
                          <span className="text-micro leading-relaxed text-secondary">
                            {ruleText(`rules.${finding.code}`)}
                            {finding.authority ? (
                              <span className="text-muted"> · {finding.authority}</span>
                            ) : null}
                            {finding.severity === "warn" ? (
                              <span className="text-muted">
                                {" "}
                                · {t("complianceNow.nobodyConfirmed")}
                              </span>
                            ) : null}
                          </span>
                          {finding.fixRoute ? (
                            <Link
                              href={finding.fixRoute}
                              className="ms-auto shrink-0 text-micro text-accent-ink hover:underline"
                            >
                              {t("complianceNow.fix")}
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("complianceNow.drafts.cashCaveat")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("complianceNow.nif.title")}</h2>
              <span className="ms-auto text-micro text-muted">{t("complianceNow.nif.why")}</span>
            </div>

            {status.clientsWithoutNif.length === 0 ? (
              <p className="p-5 text-tiny text-secondary">{t("complianceNow.nif.none")}</p>
            ) : (
              <ul>
                {status.clientsWithoutNif.map((client) => (
                  <li
                    key={client.id}
                    className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <Link
                      href={`/companies/${client.id}`}
                      className="text-tiny text-ink hover:underline"
                    >
                      {client.legalName}
                    </Link>
                    <span className="font-mono text-micro text-muted">{client.code}</span>
                    {client.issued > 0 ? (
                      <span className="ms-auto">
                        <Badge tone="critical">
                          {t("complianceNow.nif.alreadyIssued", { count: client.issued })}
                        </Badge>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("complianceNow.rules.title")}</h2>
            </div>
            <ul>
              {status.rules.map((rule) => (
                <li
                  key={rule.code}
                  className="border-b border-line-subtle px-5 py-2.5 last:border-0"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-micro leading-relaxed text-ink">
                      {ruleText(rule.messageKey)}
                    </span>
                    <span className="ms-auto shrink-0">
                      <Badge tone={rule.enforcement === "blocks" ? "good" : "warning"}>
                        {t(`complianceNow.enforcement.${rule.enforcement}`)}
                      </Badge>
                    </span>
                  </div>
                  <p className="mt-0.5 text-micro text-muted">
                    {rule.confirmedBy
                      ? t("complianceNow.confirmedBy", {
                          who: rule.confirmedBy,
                          on: rule.confirmedOn ?? "",
                        })
                      : t("complianceNow.notConfirmed")}
                  </p>
                </li>
              ))}
            </ul>
            <div className="border-t border-line-subtle px-5 py-3">
              <Link
                href="/settings/compliance"
                className="text-micro text-accent-ink hover:underline"
              >
                {t("complianceNow.confirmThem")}
              </Link>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <ShieldCheck className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">
                {t("complianceNow.structural.title")}
              </h2>
            </div>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("complianceNow.structural.what")}
            </p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {status.structural.map((item) => (
                <li key={item.key} className="text-micro leading-relaxed text-secondary">
                  · {t(`compliance.built.${item.key}`)}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              <Info className="mt-px size-4 shrink-0 text-muted" aria-hidden />
              <p className="text-micro leading-relaxed text-secondary">
                {t("complianceNow.notALawyer")}
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
