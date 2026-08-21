import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listSeries, previewNumber } from "@/domain/company";
import { Link } from "@/i18n/navigation";
import { saveSeries } from "../actions";
import { Field, INPUT } from "../field";

/**
 * Screen 85, step 4 — numbering series.
 *
 * "SUP/2026/0001 or FA-2026-001 — the shape is yours. Once the first document
 * is issued the shape is frozen for the year, because a series with two shapes
 * in it is a series nobody can defend."
 *
 * The pattern is validated for a year token and a counter, and the screen shows
 * what the next number would look like before anything is saved — because the
 * mistake people make here is not typing an invalid pattern, it is typing a
 * valid one that produces a number they did not expect.
 */
export const dynamic = "force-dynamic";

/** The document kinds that need a series before anything can be issued. */
const SUGGESTED = ["invoice", "offer", "delivery_note", "proforma", "credit_note"] as const;

export default async function NumberingPage({
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

  const series = await listSeries();
  const taken = new Set(series.map((s) => s.kind));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("setup.numberingTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("setup.numberingSubtitle")}</p>
      </div>

      <div className="max-w-[860px] px-7 py-6">
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
            {t(`setup.error.${error}`)}
          </p>
        ) : null}
        {saved ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-good-bg px-3 py-2 text-micro text-good-ink">
            {t("setup.seriesAdded")}
          </p>
        ) : null}

        <div className="rounded-[var(--radius-control)] bg-warning-bg px-4 py-3">
          <p className="text-tiny font-semibold text-warning-ink">{t("setup.frozenTitle")}</p>
          <p className="mt-1 max-w-[680px] text-micro leading-relaxed text-warning-ink">
            {t("setup.frozenBody")}
          </p>
        </div>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.seriesSoFar")}</h2>

          {series.length === 0 ? (
            <p className="mt-3 text-micro text-muted">{t("setup.noSeriesYet")}</p>
          ) : (
            <table className="mt-3 w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2 text-start font-medium">{t("setup.f.kind")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.pattern")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.nextNumber")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.reset")}</th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-ink">{s.kind}</td>
                    <td className="py-2 font-mono text-secondary">{s.pattern}</td>
                    <td className="py-2">
                      <Badge tone="neutral">{previewNumber(s.pattern, s.nextValue)}</Badge>
                    </td>
                    <td className="py-2 text-secondary">{t(`setup.reset.${s.reset}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="mt-3 max-w-[680px] text-micro leading-relaxed text-muted">
            {t("setup.reservedAtIssue")}
          </p>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.addSeries")}</h2>

          <form action={saveSeries.bind(null, locale)} className="mt-3">
            <div className="grid grid-cols-3 gap-4">
              <Field htmlFor="kind" label={t("setup.f.kind")} required>
                <select id="kind" name="kind" className={INPUT} defaultValue="">
                  <option value="" disabled>
                    {t("setup.chooseKind")}
                  </option>
                  {SUGGESTED.filter((k) => !taken.has(k)).map((k) => (
                    <option key={k} value={k}>
                      {t(`setup.docKind.${k}`)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                htmlFor="pattern"
                label={t("setup.f.pattern")}
                hint={t("setup.h.pattern")}
                required
              >
                <input
                  id="pattern"
                  name="pattern"
                  required
                  placeholder="SUP/{YYYY}/{####}"
                  className={`${INPUT} font-mono`}
                />
              </Field>

              <Field htmlFor="reset" label={t("setup.f.reset")}>
                <select id="reset" name="reset" defaultValue="yearly" className={INPUT}>
                  <option value="yearly">{t("setup.reset.yearly")}</option>
                  <option value="never">{t("setup.reset.never")}</option>
                </select>
              </Field>
            </div>

            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("setup.patternExamples", {
                a: previewNumber("SUP/{YYYY}/{####}", 1),
                b: previewNumber("FA-{YYYY}-{###}", 1),
              })}
            </p>

            <div className="mt-4 flex items-center gap-2">
              <Button type="submit" variant="primary">
                {t("setup.addSeries")}
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
