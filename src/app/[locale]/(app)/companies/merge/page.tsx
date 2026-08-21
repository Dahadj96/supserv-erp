import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  defaultChoices,
  MERGE_FIELDS,
  type MergeField,
  mergePreview,
} from "@/domain/merge-preview";
import { Link } from "@/i18n/navigation";
import { mergeCompanies, notADuplicate } from "../merge-actions";
import { Choice, FieldRow, Kept } from "./field-by-field";

/**
 * Screen 84 — merge duplicates.
 *
 * One screen, four entities eventually; companies first. The three cards on the
 * right are not decoration — they are the answer to the question a person is
 * actually asking before they press Merge: why did you think these were the
 * same, and what will I be unable to undo?
 */
export const dynamic = "force-dynamic";

const FORM_ID = "merge-form";

export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kept?: string; retired?: string }>;
}) {
  const { locale } = await params;
  const { kept: keptId, retired: retiredId } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  if (!keptId || !retiredId) notFound();
  const preview = await mergePreview(keptId, retiredId);
  if (!preview) notFound();

  const { kept, retired, signals, moves } = preview;
  const choices = defaultChoices(kept, retired);

  const show = (value: string | null) => value || "—";
  const lang = (value: string | null) =>
    value === "fr" ? "Français" : value === "en" ? "English" : "—";

  const NOTES: Partial<Record<MergeField, string | null>> = {
    nif: t("merge.note.nif"),
    rc: kept.rc && kept.rc === retired.rc ? t("merge.note.rcIdentical") : null,
    email: t("merge.note.email"),
    paymentTerms: t("merge.note.paymentTerms"),
  };

  const cellValue = (side: typeof kept, field: MergeField) =>
    field === "docLocale" ? lang(side[field]) : show(side[field]);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("merge.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("merge.subtitle")}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/companies/duplicates">
            <Button variant="ghost">{t("merge.showAll")}</Button>
          </Link>
          <Link href={`/companies/merge?kept=${retired.id}&retired=${kept.id}`}>
            <Button variant="ghost">{t("merge.swap")}</Button>
          </Link>
          <form action={notADuplicate.bind(null, locale, kept.id, retired.id)}>
            <Button type="submit" variant="secondary">
              {t("merge.notADuplicate")}
            </Button>
          </form>
          <Button type="submit" form={FORM_ID} variant="primary">
            {t("merge.merge")}
          </Button>
        </div>
      </div>

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("merge.fieldByField")}</h2>
              <span className="ms-auto text-micro text-muted">{t("merge.leftIsKept")}</span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <p className="text-tiny text-ink">
                {kept.code}
                <span className="ms-2 text-micro text-muted">{t("merge.keepThisOne")}</span>
              </p>
              <p className="text-tiny text-muted">
                {retired.code}
                <span className="ms-2 text-micro text-muted">{t("merge.mergeIn")}</span>
              </p>
            </div>

            <form id={FORM_ID} action={mergeCompanies.bind(null, locale, kept.id, retired.id)}>
              <FieldRow label={t("merge.field.legalName")}>
                <Choice
                  field="legalName"
                  side="kept"
                  value={kept.legalName}
                  checked={choices.legalName === "kept"}
                />
                <Choice
                  field="legalName"
                  side="retired"
                  value={retired.legalName}
                  checked={choices.legalName === "retired"}
                />
              </FieldRow>

              <FieldRow label={t("merge.field.aliases")} note={t("merge.note.aliases")}>
                <Kept value={kept.aliases.join(", ") || "—"} />
                <Kept value={retired.aliases.join(", ") || "—"} />
              </FieldRow>

              {MERGE_FIELDS.filter((f) => f !== "legalName").map((field) => (
                <FieldRow key={field} label={t(`merge.field.${field}`)} note={NOTES[field] ?? null}>
                  <Choice
                    field={field}
                    side="kept"
                    value={cellValue(kept, field)}
                    checked={choices[field] === "kept"}
                  />
                  <Choice
                    field={field}
                    side="retired"
                    value={cellValue(retired, field)}
                    checked={choices[field] === "retired"}
                  />
                </FieldRow>
              ))}
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("merge.whatMoves")}</h2>
              <span className="ms-auto text-micro text-muted">{t("merge.nothingDropped")}</span>
            </div>

            {moves.length === 0 ? (
              <p className="max-w-[560px] text-micro leading-relaxed text-muted">
                {t("merge.nothingAttached")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle text-micro text-muted">
                    <th className="py-2 text-start font-medium">{t("merge.what")}</th>
                    <th className="py-2 text-end font-medium">{kept.code}</th>
                    <th className="py-2 text-end font-medium">{retired.code}</th>
                    <th className="py-2 text-end font-medium">{t("merge.afterColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((row) => (
                    <tr key={row.key} className="border-b border-line-subtle last:border-0">
                      <td className="py-2 text-ink">
                        {t.has(`merge.moves.${row.key}`)
                          ? t(`merge.moves.${row.key}`)
                          : row.key.split(".").pop()}
                      </td>
                      <td className="py-2 text-end text-secondary">{row.kept}</td>
                      <td className="py-2 text-end text-secondary">{row.retired}</td>
                      <td className="py-2 text-end text-ink">{row.after}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 text-ink">{t("merge.moves.aliases")}</td>
                    <td className="py-2 text-end text-secondary">{kept.aliases.length}</td>
                    <td className="py-2 text-end text-secondary">{retired.aliases.length}</td>
                    <td className="py-2 text-end text-ink">{preview.aliasesAfter}</td>
                  </tr>
                </tbody>
              </table>
            )}

            <p className="mt-3 max-w-[620px] text-micro leading-relaxed text-muted">
              {t("merge.auditNote")}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("merge.howFound")}</h2>
            <dl className="mt-3">
              {signals.map((signal) => (
                <div
                  key={signal.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`merge.signal.${signal.key}`)}</dt>
                  <dd
                    className={`ms-auto text-end text-tiny ${signal.matched ? "text-ink" : "text-muted"}`}
                  >
                    {signal.detail ??
                      (signal.matched ? t(`merge.signalYes.${signal.key}`) : t("merge.signalNo"))}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-plane p-3">
              <p className="text-tiny font-semibold text-ink">{t("merge.suggestedTitle")}</p>
              <p className="mt-1 text-micro leading-relaxed text-secondary">
                {t("merge.suggestedBody")}
              </p>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("merge.afterTitle")}</h2>
            <dl className="mt-3">
              {(
                [
                  ["kept", kept.code],
                  ["retired", retired.code],
                  ["oldLinks", t("merge.after.oldLinksValue", { code: kept.code })],
                  ["oldReference", t("merge.after.oldReferenceValue")],
                  ["reversible", t("merge.after.reversibleValue", { days: 30 })],
                  ["logged", t("merge.after.loggedValue")],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="shrink-0 text-tiny text-secondary">{t(`merge.after.${key}`)}</dt>
                  <dd className="ms-auto text-end text-tiny text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded-[var(--radius-control)] bg-good-bg p-3">
              <p className="text-tiny font-semibold text-good-ink">{t("merge.notADeleteTitle")}</p>
              <p className="mt-1 text-micro leading-relaxed text-good-ink">
                {t("merge.notADeleteBody", { code: retired.code })}
              </p>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("merge.fourPlacesTitle")}</h2>
            <dl className="mt-3">
              {(["companies", "contacts", "items", "people"] as const).map((key) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="shrink-0 text-tiny text-secondary">{t(`merge.entity.${key}`)}</dt>
                  <dd className="ms-auto text-end text-tiny text-muted">
                    {t(`merge.fourPlaces.${key}`)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("merge.fourPlacesBody")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
