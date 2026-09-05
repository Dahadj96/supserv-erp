import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listSeries, previewNumber, SERIES_KINDS, suggestedPattern } from "@/domain/company";
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

/*
  THE KINDS COME FROM THE CATALOGUE, and they were five names typed here.

  One of the five — "offer" — is not a kind this ERP has: the catalogue calls a
  devis `quotation`. So a Gérant could finish day one having created a series
  nothing would ever use. And the ones missing mattered more than the one that
  was wrong: `final_account` and `retention_release` — the décompte that closes
  a marché and the paper that asks for the retenue de garantie back — could not
  be created here at all, so a company doing marchés publics met the refusal on
  the day it needed the document, and had to be told which other screen to go
  to.

  `SERIES_KINDS` is every kind whose catalogue entry carries a pattern, which
  is exactly the set that takes a number of ours. A kind that carries the
  counterparty's — a bon de commande client, an avenant, a supplier invoice —
  is not offered, because a series for one of those allocates a number nothing
  ever prints.
*/

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
  const remaining = SERIES_KINDS.filter((k) => !taken.has(k));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("setup.numberingTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("setup.numberingSubtitle")}</p>
      </div>

      <div className="max-w-[860px] px-4 md:px-7 py-6">
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
                    {/* The label, not `final_account`: this table is read by
                        the person who has to recognise the document. */}
                    <td className="py-2 text-ink">
                      {t.has(`docTypes.kind.${s.kind}`) ? t(`docTypes.kind.${s.kind}`) : s.kind}
                    </td>
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

          {/* Every kind has one. An empty select with a submit button beside it
              is a form that can only fail. */}
          {remaining.length === 0 ? (
            <p className="mt-3 max-w-[680px] text-micro leading-relaxed text-muted">
              {t("setup.everyKindHasOne")}
            </p>
          ) : (
            <form action={saveSeries.bind(null, locale)} className="mt-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field htmlFor="kind" label={t("setup.f.kind")} required>
                  <select id="kind" name="kind" className={INPUT} defaultValue="">
                    <option value="" disabled>
                      {t("setup.chooseKind")}
                    </option>
                    {remaining.map((k) => (
                      <option key={k} value={k}>
                        {t.has(`docTypes.kind.${k}`) ? t(`docTypes.kind.${k}`) : k}
                        {suggestedPattern(k) ? ` — ${suggestedPattern(k)}` : ""}
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
          )}

          {remaining.length === 0 ? (
            <div className="mt-4">
              <Link href="/setup">
                <Button variant="ghost">{t("setup.backToDayOne")}</Button>
              </Link>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
