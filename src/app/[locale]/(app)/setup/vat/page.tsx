import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listVatRates } from "@/domain/company";
import { Link } from "@/i18n/navigation";
import { saveVatRate } from "../actions";
import { Field, INPUT } from "../field";

/**
 * Screen 85, step 3 — TVA rates.
 *
 * "19% and 9% are today's figures, entered as rules with a start date. When
 * they change you add a new rate rather than editing the old one, so last
 * year's invoices still recompute correctly."
 *
 * There is therefore no edit button on this screen, and that is the feature.
 * Adding a rate closes its predecessor; the old row keeps its dates and every
 * document issued under it keeps its arithmetic.
 */
export const dynamic = "force-dynamic";

export default async function VatPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { locale } = await params;
  const { error, saved } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();
  const format = await getFormatter();

  const rates = await listVatRates();
  const today = new Date().toISOString().slice(0, 10);
  const day = (d: string) =>
    format.dateTime(new Date(d), { day: "2-digit", month: "short", year: "numeric" });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("setup.vatTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("setup.vatSubtitle")}</p>
      </div>

      <div className="max-w-[860px] px-7 py-6">
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
            {t("setup.error.rateInvalid")}
          </p>
        ) : null}
        {saved ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-good-bg px-3 py-2 text-micro text-good-ink">
            {t("setup.rateAdded")}
          </p>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.ratesInForce")}</h2>

          {rates.length === 0 ? (
            <p className="mt-3 text-micro text-muted">{t("setup.noRatesYet")}</p>
          ) : (
            <table className="mt-3 w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2 text-start font-medium">{t("setup.f.rate")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.kind")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.startsOn")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.endsOn")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.authority")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-ink">{Number(r.rate)} %</td>
                    <td className="py-2">
                      <Badge tone={r.endsOn ? "neutral" : "good"}>
                        {t(`setup.vatKind.${r.kind}`)}
                      </Badge>
                    </td>
                    <td className="py-2 text-secondary">{day(r.startsOn)}</td>
                    <td className="py-2 text-secondary">
                      {r.endsOn ? day(r.endsOn) : t("setup.stillInForce")}
                    </td>
                    <td className="py-2 text-muted">{r.authority ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="mt-3 max-w-[640px] text-micro leading-relaxed text-muted">
            {t("setup.noEditButton")}
          </p>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.addRate")}</h2>
          <form action={saveVatRate.bind(null, locale)} className="mt-3">
            <div className="grid grid-cols-4 gap-4">
              <Field htmlFor="rate" label={t("setup.f.rate")} required>
                <input
                  id="rate"
                  name="rate"
                  required
                  inputMode="decimal"
                  placeholder="19"
                  className={INPUT}
                />
              </Field>
              <Field htmlFor="kind" label={t("setup.f.kind")} required>
                <select id="kind" name="kind" defaultValue="normal" className={INPUT}>
                  <option value="normal">{t("setup.vatKind.normal")}</option>
                  <option value="reduced">{t("setup.vatKind.reduced")}</option>
                  <option value="exempt">{t("setup.vatKind.exempt")}</option>
                </select>
              </Field>
              <Field htmlFor="startsOn" label={t("setup.f.startsOn")} required>
                <input
                  id="startsOn"
                  name="startsOn"
                  type="date"
                  required
                  defaultValue={today}
                  className={INPUT}
                />
              </Field>
              <Field
                htmlFor="authority"
                label={t("setup.f.authority")}
                hint={t("setup.h.authority")}
              >
                <input
                  id="authority"
                  name="authority"
                  placeholder="loi de finances"
                  className={INPUT}
                />
              </Field>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button type="submit" variant="primary">
                {t("setup.addRate")}
              </Button>
              <Link href="/setup">
                <Button variant="ghost">{t("setup.backToDayOne")}</Button>
              </Link>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
