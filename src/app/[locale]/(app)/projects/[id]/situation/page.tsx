import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { nextSituation } from "@/domain/project/situations";
import { getProject } from "@/domain/project/store";
import { Link } from "@/i18n/navigation";
import { saveSituationAction } from "../actions";

/**
 * Screen 16b — the next situation.
 *
 * The marché's bordereau, one row per price, with what earlier situations
 * already claimed and what is left. The person types ONE column — the
 * quantities of this period — and everything else on the wilaya's form is
 * arithmetic the draft will show. While a draft is open this screen edits it;
 * there is never a second draft, because n° 3 cannot be written before n° 2
 * is issued.
 */
export const dynamic = "force-dynamic";

export default async function NextSituationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [p, next] = await Promise.all([getProject(id), nextSituation(id)]);
  if (!p || !next) notFound();

  const format = await getFormatter({ locale });
  const money = (value: string) => format.number(Number(value), { maximumFractionDigits: 2 });
  const qty = (value: string) => format.number(Number(value), { maximumFractionDigits: 3 });
  const allowed = can(session.role, "works.issue");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <p className="text-micro text-muted">
          <Link href={`/projects/${id}`} className="hover:underline">
            {p.code}
          </Link>{" "}
          · {p.object}
        </p>
        <h1 className="mt-0.5 text-title font-semibold text-ink">
          {t("situation.title", { n: next.sequence })}
        </h1>
        <p className="mt-1 max-w-[760px] text-tiny leading-relaxed text-muted">
          {next.draft ? t("situation.editingDraft") : t("situation.lead")}
        </p>
      </div>

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`situation.error.${error}`) ? t(`situation.error.${error}`) : error}
        </p>
      ) : null}

      {next.blocked ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-warning-ink">
            {t(`situation.blocked.${next.blocked}`)}
          </p>
          <Link className="ms-auto shrink-0" href={`/projects/${id}#terms`}>
            <Button variant="secondary" size="small">
              {t("situation.fixTerms")}
            </Button>
          </Link>
        </div>
      ) : null}

      <form
        action={saveSituationAction.bind(null, locale, id)}
        className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 md:px-7 py-6 2xl:grid-cols-3"
      >
        <section className="rounded-[var(--radius-card)] border border-line bg-surface 2xl:col-span-2">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("situation.bordereau")}</h2>
            <span className="ms-auto text-micro text-muted">
              {next.contract
                ? t("situation.against", {
                    doc: `${t(`documents.kind.${next.contract.kind}`)} ${next.contract.number ?? ""}`,
                  })
                : t("situation.noContractYet")}
            </span>
          </div>

          {next.rows.length === 0 ? (
            <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
              {t("situation.noLines")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">N°</th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("situation.column.designation")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">U</th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("situation.column.contract")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("situation.column.unitPrice")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("situation.column.previous")}
                    </th>
                    <th className="px-3 py-2 text-end font-medium">
                      {t("situation.column.remaining")}
                    </th>
                    <th className="w-[120px] px-3 py-2 text-end font-medium">
                      {t("situation.column.period")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {next.rows.map((row) => {
                    const remaining = Number(row.qty) - Number(row.qtyPrevious);
                    return (
                      <tr key={row.lineId} className="border-b border-line-subtle last:border-0">
                        <td className="px-5 py-2 text-muted">{row.reference ?? row.position}</td>
                        <td className="px-3 py-2 text-ink">{row.designation}</td>
                        <td className="px-3 py-2 text-muted">{row.unit ?? ""}</td>
                        <td className="px-3 py-2 text-end tabular-nums text-secondary">
                          {qty(row.qty)}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums text-secondary">
                          {money(row.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums text-secondary">
                          {qty(row.qtyPrevious)}
                        </td>
                        <td
                          className={`px-3 py-2 text-end tabular-nums ${remaining < 0 ? "text-critical-ink" : "text-secondary"}`}
                        >
                          {qty(String(remaining))}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            name={`qty:${row.lineId}`}
                            inputMode="decimal"
                            defaultValue={
                              next.draft && Number(row.qtyPeriod) > 0 ? row.qtyPeriod : ""
                            }
                            className={`${INPUT} text-end tabular-nums`}
                            aria-label={row.designation ?? ""}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
            {t("situation.previouslyCertified", {
              amount: `${money(next.previouslyCertifiedExcl)} ${p.currency}`,
            })}{" "}
            {t("situation.overContractHint")}
          </p>
        </section>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("situation.period")}</h2>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-micro text-secondary">{t("situation.f.from")}</span>
                <input
                  type="date"
                  name="periodFrom"
                  defaultValue={next.draft?.periodFrom ?? ""}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("situation.f.to")}</span>
                <input
                  type="date"
                  name="periodTo"
                  defaultValue={next.draft?.periodTo ?? ""}
                  className={`${INPUT} mt-1`}
                />
              </label>
            </div>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("situation.f.workDone")}</span>
              <input
                name="workDone"
                defaultValue={next.draft?.workDone ?? ""}
                placeholder={t("situation.f.workDoneHint")}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("situation.f.issuedOn")}</span>
              <input type="date" name="issuedOn" defaultValue={today} className={`${INPUT} mt-1`} />
            </label>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("situation.deductions")}</h2>
            <dl className="mt-3 flex flex-col gap-1.5 text-tiny">
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("situation.retention")}</dt>
                <dd className="ms-auto tabular-nums text-ink">
                  {/* `numeric(6,3)` reads back "5.000", which in French is
                      five thousand to anybody skimming. */}
                  {String(Number(next.retentionPct))} %
                  {next.retentionBase
                    ? ` · ${t(`projectNew.retentionBase.${next.retentionBase}`)}`
                    : ""}
                </dd>
              </div>
            </dl>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("situation.f.advance")}</span>
              <input
                name="advanceRecovered"
                inputMode="decimal"
                defaultValue={
                  next.draft && Number(next.draft.advanceRecovered) > 0
                    ? next.draft.advanceRecovered
                    : ""
                }
                className={`${INPUT} mt-1 text-end tabular-nums`}
              />
            </label>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("situation.f.advanceHint")}
            </p>
          </section>

          <div className="flex items-center gap-3">
            <p className="text-micro leading-relaxed text-muted">{t("situation.createsADraft")}</p>
            <div className="ms-auto">
              <Button
                type="submit"
                variant="primary"
                disabledReason={
                  !allowed
                    ? t("documents.notAllowed")
                    : next.blocked
                      ? t(`situation.blocked.${next.blocked}`)
                      : undefined
                }
              >
                {next.draft ? t("situation.saveDraft") : t("situation.go")}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </main>
  );
}
