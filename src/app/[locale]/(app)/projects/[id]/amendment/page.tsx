import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { nextAmendment } from "@/domain/project/situations";
import { getProject } from "@/domain/project/store";
import { Link } from "@/i18n/navigation";
import { saveAmendmentAction } from "../actions";

/**
 * Screen 16c — the avenant.
 *
 * The marché's bordereau as it stands after every avenant already issued, and
 * two empty columns: the quantity this avenant makes of the line, and the
 * price. Blank means untouched, which is what nearly every line is — an
 * avenant that moves two quantities out of forty should cost two numbers to
 * record, not forty.
 *
 * Underneath, the prix nouveaux: prices the avenant introduces, which point at
 * no line of the marché and are appended to the bordereau.
 *
 * It is its own screen and not the builder for the same reason a situation is.
 * The builder saves the lines as typed and keeps no memory of which line of
 * the marché each one answers; an avenant that has forgotten that is not an
 * avenant, it is a second bordereau.
 */
export const dynamic = "force-dynamic";

/** Enough blank rows to record a normal avenant without thinking about rows. */
const NEW_PRICE_ROWS = 4;

export default async function AmendmentPage({
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

  const [p, next] = await Promise.all([getProject(id), nextAmendment(id)]);
  if (!p || !next) notFound();

  const format = await getFormatter({ locale });
  const money = (value: string) => format.number(Number(value), { maximumFractionDigits: 2 });
  const qty = (value: string) => format.number(Number(value), { maximumFractionDigits: 3 });
  const allowed = can(session.role, "offers.issue");
  const today = new Date().toISOString().slice(0, 10);
  const already = next.contract?.amendments.length ?? 0;

  const blank = Math.max(NEW_PRICE_ROWS - next.additions.length, 1);
  const newPriceRows = [...next.additions, ...Array.from({ length: blank }, () => null)];

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
          {t("amendment.title")}
          {already > 0 ? (
            <span className="ms-2 text-tiny font-normal text-muted">
              {t("amendment.count", { n: already })}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 max-w-[760px] text-tiny leading-relaxed text-muted">
          {next.draft ? t("amendment.editingDraft") : t("amendment.lead")}
        </p>
      </div>

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`amendment.error.${error}`) ? t(`amendment.error.${error}`) : error}
        </p>
      ) : null}

      {next.blocked ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-warning-ink">
            {t(`amendment.blocked.${next.blocked}`)}
          </p>
          <Link className="ms-auto shrink-0" href={`/projects/${id}#terms`}>
            <Button variant="secondary" size="small">
              {t("situation.fixTerms")}
            </Button>
          </Link>
        </div>
      ) : null}

      <form
        action={saveAmendmentAction.bind(null, locale, id)}
        className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 md:px-7 py-6 2xl:grid-cols-3"
      >
        <div className="flex flex-col gap-5 2xl:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("amendment.bordereau")}</h2>
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
                      <th className="w-[120px] px-3 py-2 text-end font-medium">
                        {t("amendment.column.newQty")}
                      </th>
                      <th className="w-[130px] px-3 py-2 text-end font-medium">
                        {t("amendment.column.newPrice")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {next.rows.map((row) => (
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
                        <td className="px-3 py-1.5">
                          <input
                            name={`newQty:${row.lineId}`}
                            inputMode="decimal"
                            defaultValue={row.newQty ?? ""}
                            placeholder={qty(row.qty)}
                            className={`${INPUT} text-end tabular-nums`}
                            aria-label={`${row.designation ?? ""} — ${t("amendment.column.newQty")}`}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            name={`newPrice:${row.lineId}`}
                            inputMode="decimal"
                            defaultValue={row.newUnitPrice ?? ""}
                            placeholder={money(row.unitPrice)}
                            className={`${INPUT} text-end tabular-nums`}
                            aria-label={`${row.designation ?? ""} — ${t("amendment.column.newPrice")}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("amendment.untouchedHint")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("amendment.newPrices")}</h2>
              <p className="mt-1 text-micro leading-relaxed text-muted">
                {t("amendment.newPricesHint")}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    {/* The column is the cell's padding plus the field: 130
                        and 104 leave 90px and 80px of input, which is a price
                        reference and a unit and not one character less. */}
                    <th className="w-[130px] px-5 py-2 text-start font-medium">N°</th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("situation.column.designation")}
                    </th>
                    <th className="w-[104px] px-3 py-2 text-start font-medium">U</th>
                    <th className="w-[110px] px-3 py-2 text-end font-medium">
                      {t("amendment.column.qty")}
                    </th>
                    <th className="w-[130px] px-3 py-2 text-end font-medium">
                      {t("situation.column.unitPrice")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {newPriceRows.map((row, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the row IS its index, and the field names carry it
                    <tr key={index} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-1.5">
                        <input
                          name={`add.reference.${index}`}
                          defaultValue={row?.reference ?? ""}
                          className={INPUT}
                          // A code — "3.1" — not a sentence. Screen widths are
                          // measured, and this says which rule to measure by.
                          data-short="true"
                          aria-label={t("amendment.add.reference")}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          name={`add.designation.${index}`}
                          defaultValue={row?.designation ?? ""}
                          placeholder={t("amendment.add.designationHint")}
                          className={INPUT}
                          aria-label={t("situation.column.designation")}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          name={`add.unit.${index}`}
                          defaultValue={row?.unit ?? ""}
                          className={INPUT}
                          data-short="true"
                          aria-label="U"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          name={`add.qty.${index}`}
                          inputMode="decimal"
                          defaultValue={row?.qty ?? ""}
                          className={`${INPUT} text-end tabular-nums`}
                          aria-label={t("amendment.column.qty")}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          name={`add.unitPrice.${index}`}
                          inputMode="decimal"
                          defaultValue={row?.unitPrice ?? ""}
                          className={`${INPUT} text-end tabular-nums`}
                          aria-label={t("situation.column.unitPrice")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("amendment.identity")}</h2>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("amendment.theirNumber")}</span>
              <input
                name="theirNumber"
                defaultValue={next.draft?.theirNumber ?? ""}
                placeholder={t("amendment.theirNumberHint")}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("amendment.signedOn")}</span>
              <input
                type="date"
                name="signedOn"
                defaultValue={next.draft?.signedOn ?? today}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("amendment.reason")}</span>
              <input
                name="reason"
                defaultValue={next.draft?.reason ?? ""}
                placeholder={t("amendment.reasonHint")}
                className={`${INPUT} mt-1`}
              />
            </label>
            <dl className="mt-4 flex flex-col gap-1.5 border-t border-line-subtle pt-3 text-tiny">
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("amendment.contractNow")}</dt>
                <dd className="ms-auto tabular-nums text-ink">
                  {money(next.contractExcl)} {p.currency}
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-secondary">{t("amendment.deadlineNow")}</dt>
                <dd className="ms-auto tabular-nums text-ink">{next.deadline ?? "—"}</dd>
              </div>
            </dl>
          </section>

          {/*
            An avenant de prolongation de délai carries no price at all, which
            is why this is its own card and not a line in the table: it is the
            whole of some avenants and absent from most.
          */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("amendment.delai")}</h2>
            <label className="mt-3 block">
              <span className="text-micro text-secondary">{t("amendment.newDeadline")}</span>
              <input
                type="date"
                name="newContractualEnd"
                defaultValue={next.draft?.newContractualEnd ?? ""}
                className={`${INPUT} mt-1`}
              />
            </label>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("amendment.newDeadlineWhy")}
            </p>
          </section>

          <div className="flex items-center gap-3">
            <p className="text-micro leading-relaxed text-muted">{t("amendment.createsADraft")}</p>
            <div className="ms-auto">
              <Button
                type="submit"
                variant="primary"
                disabledReason={
                  !allowed
                    ? t("documents.notAllowed")
                    : next.blocked
                      ? t(`amendment.blocked.${next.blocked}`)
                      : undefined
                }
              >
                {next.draft ? t("amendment.saveDraft") : t("amendment.go")}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </main>
  );
}
