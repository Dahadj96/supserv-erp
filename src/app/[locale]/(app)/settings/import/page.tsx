import { Check, CircleAlert, Info, X } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadBatch, recentBatches } from "@/domain/import/batch";
import type { ProblemKey } from "@/domain/import/clean";
import { mappedCount } from "@/domain/import/columns";
import { UNDO_DAYS } from "@/domain/import/run";
import { commitBatch, undoBatch, uploadForPreview } from "./actions";

/**
 * Screen 62 — Move in.
 *
 * "Your Excel files and OneDrive folders stay exactly where they are. This
 * copies what is useful into the system and tells you what it could not read."
 *
 * The screen discovers files in OneDrive. That needs Graph Files.Read scoped to
 * one site — the same conversation as the mailbox, and not yet had — so this
 * takes an upload instead and says so. What happens after the file arrives is
 * the same either way.
 */
export const dynamic = "force-dynamic";

const PROBLEM_ORDER: ProblemKey[] = [
  "duplicates",
  "noName",
  "missingNif",
  "badNif",
  "unreadableRows",
];

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    batch?: string;
    error?: string;
    imported?: string;
    undone?: string;
    kept?: string;
  }>;
}) {
  const { locale } = await params;
  const { batch: batchId, error, imported, undone, kept } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();
  const format = await getFormatter();

  const batch = batchId ? await loadBatch(batchId) : null;
  const history = await recentBatches();
  const counts = batch ? mappedCount(batch.mapping) : null;

  const step = batch ? (batch.status === "imported" ? 4 : 3) : 1;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{t("moveIn.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("moveIn.subtitle")}</p>
        </div>
      </div>

      <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-good bg-good-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-good-ink" aria-hidden />
        <p className="text-tiny leading-relaxed text-good-ink">{t("moveIn.filesStay")}</p>
      </div>

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t(`moveIn.error.${error}`)}
        </p>
      ) : null}
      {imported ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("moveIn.imported", { count: Number(imported), days: UNDO_DAYS })}
        </p>
      ) : null}
      {undone ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("moveIn.undone", { count: Number(undone), kept: Number(kept ?? 0) })}
        </p>
      ) : null}

      <div className="flex items-center gap-2 px-4 md:px-7 pt-5">
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={`rounded-[var(--radius-control)] px-3 py-1.5 text-tiny ${
              n === step
                ? "bg-ink font-medium text-on-ink"
                : "border border-line bg-surface text-muted"
            }`}
          >
            <span className="me-1.5 text-micro">{n}</span>
            {t(`moveIn.step.${n}`)}
          </span>
        ))}
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          {!batch ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("moveIn.chooseTitle")}</h2>
              <p className="mt-1 max-w-[620px] text-micro leading-relaxed text-muted">
                {t("moveIn.chooseBody")}
              </p>
              <form
                action={uploadForPreview.bind(null, locale)}
                className="mt-4 flex items-end gap-3"
              >
                <label className="flex flex-col gap-1">
                  <span className="text-micro font-medium text-secondary">{t("moveIn.file")}</span>
                  <input
                    type="file"
                    name="file"
                    accept=".xlsx,.xlsm"
                    required
                    className="text-tiny file:me-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-2.5 file:py-1.5 file:text-tiny"
                  />
                </label>
                <Button type="submit" variant="primary">
                  {t("moveIn.readIt")}
                </Button>
              </form>
              <p className="mt-3 max-w-[620px] text-micro leading-relaxed text-muted">
                {t("moveIn.oneDriveLater")}
              </p>
            </section>
          ) : (
            <>
              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <div className="mb-3 flex items-baseline gap-3">
                  <h2 className="text-tiny font-semibold text-ink">
                    {t("moveIn.checkColumns", { file: batch.filename })}
                  </h2>
                  <span className="ms-auto text-micro text-muted">
                    {t("moveIn.mappedOf", {
                      mapped: counts?.mapped ?? 0,
                      total: counts?.total ?? 0,
                    })}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                  {batch.headers.map((header) => {
                    const target = batch.mapping[header];
                    return (
                      <div key={header} className="flex items-center gap-2 py-1 text-tiny">
                        {target ? (
                          <Check className="size-3.5 shrink-0 text-good" aria-hidden />
                        ) : (
                          <X className="size-3.5 shrink-0 text-muted" aria-hidden />
                        )}
                        <span className={target ? "text-ink" : "text-muted"}>{header}</span>
                        <span className="ms-auto text-micro text-muted">
                          → {target ? t(`moveIn.target.${target}`) : t("moveIn.ignored")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-tiny font-semibold text-ink">{t("moveIn.previewTitle")}</h2>
                <dl className="mt-3">
                  <Line
                    label={t("moveIn.becomes")}
                    value={t(`moveIn.becomesValue.${batch.becomes}`)}
                  />
                  <Line
                    label={t("moveIn.rowsRead")}
                    value={String(
                      batch.prepared.parties.length +
                        batch.prepared.people.length +
                        batch.prepared.skipped.length,
                    )}
                  />
                  <Line
                    label={t("moveIn.willCreate")}
                    value={String(batch.prepared.parties.length + batch.prepared.people.length)}
                  />
                  {batch.prepared.skipped.length > 0 ? (
                    <Line
                      label={t("moveIn.skippedRows")}
                      value={batch.prepared.skipped.map((s) => s.rowNumber).join(", ")}
                    />
                  ) : null}
                </dl>

                {batch.status !== "imported" ? (
                  <form
                    action={commitBatch.bind(null, locale, batch.id)}
                    className="mt-4 flex items-end gap-3"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="text-micro font-medium text-secondary">
                        {t("moveIn.theseAre")}
                      </span>
                      <select
                        name="role"
                        defaultValue="client"
                        className="h-[34px] rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-tiny outline-none focus:border-ink"
                      >
                        <option value="client">{t("company.role.client")}</option>
                        <option value="supplier">{t("company.role.supplier")}</option>
                      </select>
                    </label>
                    <Button type="submit" variant="primary">
                      {t("moveIn.importNow", {
                        count: batch.prepared.parties.length + batch.prepared.people.length,
                      })}
                    </Button>
                  </form>
                ) : (
                  <p className="mt-4 text-micro text-muted">{t("moveIn.alreadyImported")}</p>
                )}
              </section>
            </>
          )}

          {history.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("moveIn.historyTitle")}</h2>
              <table className="mt-3 w-full border-collapse text-tiny">
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-line-subtle last:border-0">
                      <td className="py-2 text-ink">{h.filename}</td>
                      <td className="py-2 text-secondary">
                        {format.dateTime(h.createdAt, { day: "2-digit", month: "short" })}
                      </td>
                      <td className="py-2">
                        <Badge tone={h.undoneAt ? "neutral" : h.importedAt ? "good" : "warning"}>
                          {t(
                            h.undoneAt
                              ? "moveIn.statusUndone"
                              : h.importedAt
                                ? "moveIn.statusImported"
                                : "moveIn.statusPreviewed",
                          )}
                        </Badge>
                      </td>
                      <td className="py-2 text-end">
                        {h.importedAt && !h.undoneAt ? (
                          <form action={undoBatch.bind(null, locale, h.id)}>
                            <Button type="submit" variant="secondary" size="small">
                              {t("moveIn.undo")}
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          {batch ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-tiny font-semibold text-ink">{t("moveIn.problemsTitle")}</h2>
                <span className="ms-auto text-micro text-muted">
                  {t("moveIn.handledNotHidden")}
                </span>
              </div>
              <dl className="mt-3">
                {PROBLEM_ORDER.filter((key) => (batch.prepared.problems[key] ?? 0) > 0).map(
                  (key) => (
                    <div
                      key={key}
                      className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                    >
                      <dt className="text-tiny text-secondary">{t(`moveIn.problem.${key}`)}</dt>
                      <dd className="ms-auto shrink-0">
                        <Badge tone="warning">
                          {t(`moveIn.problemAction.${key}`, {
                            n: batch.prepared.problems[key] ?? 0,
                          })}
                        </Badge>
                      </dd>
                    </div>
                  ),
                )}
                {PROBLEM_ORDER.every((key) => !batch.prepared.problems[key]) ? (
                  <p className="text-micro text-muted">{t("moveIn.noProblems")}</p>
                ) : null}
              </dl>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("moveIn.safeTitle")}</h2>
            <dl className="mt-3">
              <Safe label={t("moveIn.safe.deleted")} value={t("moveIn.never")} />
              <Safe label={t("moveIn.safe.moved")} value={t("moveIn.never")} />
              <Safe label={t("moveIn.safe.changed")} value={t("moveIn.never")} />
              <Safe
                label={t("moveIn.safe.undo")}
                value={t("moveIn.withinDays", { days: UNDO_DAYS })}
              />
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("moveIn.keepUsingExcel")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
              <div>
                <h2 className="text-tiny font-semibold text-ink">
                  {t("moveIn.onlyWhatFitsTitle")}
                </h2>
                <p className="mt-1 text-micro leading-relaxed text-secondary">
                  {t("moveIn.onlyWhatFitsBody")}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0">
      <dt className="text-tiny text-secondary">{label}</dt>
      <dd className="ms-auto text-tiny text-ink">{value}</dd>
    </div>
  );
}

function Safe({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0">
      <dt className="text-tiny text-secondary">{label}</dt>
      <dd className="ms-auto shrink-0">
        <Badge tone="good">{value}</Badge>
      </dd>
    </div>
  );
}
