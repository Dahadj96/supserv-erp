import { AlertCircle, Check, X } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { nextStepFor, REQUIREMENTS } from "@/domain/deal/technical";
import { technicalFile } from "@/domain/deal/technical-store";
import { Link } from "@/i18n/navigation";
import { clearNotApplicableAction, markNotApplicableAction, setRequirementAction } from "./actions";

/**
 * Screen 78 — the technical file.
 *
 * Two rules run the whole screen, and both are about not crying wolf:
 *
 *   "Not applicable" is a real answer, and it is NOT the same as "we could not
 *   find it". Boulonnerie has no datasheet because none exists; a 120W
 *   amplifier without one is a gap. In a completeness column they look
 *   identical.
 *
 *   A gap only BLOCKS when the client asked. When they did not, the same gap is
 *   worth seeing here and worth nothing on the offer.
 */
export const dynamic = "force-dynamic";

const STATE_TONE = {
  complete: "good",
  notApplicable: "neutral",
  datasheetMissing: "warning",
  nothingFound: "critical",
  noSupplierYet: "critical",
} as const;

export default async function TechnicalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; marked?: string }>;
}) {
  const { locale, id } = await params;
  const { error, marked } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const file = await technicalFile(id);
  if (!file) notFound();

  const { coverage, verdict, states, requirement } = file;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">
            {t("technical.title", { ref: file.deal.ref })}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {file.deal.clientName} ·{" "}
            {t("technical.summary", {
              items: coverage.items,
              complete: coverage.complete,
              missing: coverage.missing,
              na: coverage.notApplicable,
            })}
          </p>
        </div>
        <Link className="ms-auto" href={`/deals/${id}`}>
          <Button variant="secondary">{t("prices.backToDeal")}</Button>
        </Link>
      </div>

      {verdict.blocksSubmission ? (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">
            {t("technical.blockedBanner", {
              client: file.deal.clientName,
              n: verdict.gaps.length,
            })}
          </p>
        </div>
      ) : null}

      {marked ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          {t("technical.marked")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`technical.error.${error}`) ? t(`technical.error.${error}`) : error}
        </p>
      ) : null}

      <div className="mx-4 mt-5 flex flex-wrap items-center gap-2 md:mx-7">
        <span className="text-tiny text-secondary">{t("technical.didTheyAsk")}</span>
        {REQUIREMENTS.map((value) => (
          <form key={value} action={setRequirementAction.bind(null, locale, id)}>
            <input type="hidden" name="requirement" value={value} />
            <button
              type="submit"
              aria-pressed={requirement === value}
              className={`rounded-full border px-3.5 py-1.5 text-tiny ${
                requirement === value
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-secondary hover:border-line-strong"
              }`}
            >
              {t(`technical.requirement.${value}`)}
            </button>
          </form>
        ))}
        <span className="ms-auto text-micro text-muted">{t("technical.whenRequired")}</span>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 md:grid-cols-3 md:px-7 md:py-6">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("technical.itemByItem")}</h2>
              <span className="ms-auto text-micro text-muted">{t("technical.kinds")}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">#</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("prices.item")}</th>
                    <th className="py-2 pe-4 text-center font-medium">{t("technical.fiche")}</th>
                    <th className="py-2 pe-4 text-center font-medium">{t("technical.photo")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("technical.whereFrom")}</th>
                    <th className="py-2 pe-5 text-start font-medium">{t("sourcing.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {file.items.map((row) => {
                    const state = states.get(row.dealLineId) ?? "nothingFound";
                    const hasDatasheet = row.media.some((m) => m.kind === "datasheet");
                    const hasPhoto = row.media.some((m) => m.kind === "photo");
                    const sources = [...new Set(row.media.map((m) => m.provenance))];
                    return (
                      <tr key={row.dealLineId} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-muted">{file.order.get(row.dealLineId)}</td>
                        <td className="max-w-[240px] truncate py-2.5 pe-4 text-ink">
                          {row.designation}
                        </td>
                        <td className="py-2.5 pe-4 text-center">
                          {hasDatasheet ? (
                            <Check className="inline size-4 text-good-ink" aria-hidden />
                          ) : (
                            <X className="inline size-4 text-muted" aria-hidden />
                          )}
                        </td>
                        <td className="py-2.5 pe-4 text-center">
                          {hasPhoto ? (
                            <Check className="inline size-4 text-good-ink" aria-hidden />
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pe-4 text-muted">
                          {sources.length === 0
                            ? "—"
                            : sources.map((s) => t(`technical.provenance.${s}`)).join(" · ")}
                        </td>
                        <td className="py-2.5 pe-5">
                          <Badge tone={STATE_TONE[state]}>{t(`technical.state.${state}`)}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/*
            The heading the frame gives its own card, because it is the rule the
            whole screen turns on.
          */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("technical.naIsReal")}</h2>
              <span className="ms-auto text-micro text-muted">{t("technical.naIsNotFailure")}</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["notApplicable", "nothingFound"] as const).map((key) => (
                <div
                  key={key}
                  className="rounded-[var(--radius-control)] border border-line bg-plane p-4"
                >
                  <p className="text-tiny font-medium text-ink">{t(`technical.state.${key}`)}</p>
                  <p className="mt-1 text-micro leading-relaxed text-secondary">
                    {t(`technical.explain.${key}`)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("technical.markOne")}</h2>
            <p className="mt-1.5 text-micro leading-relaxed text-muted">
              {t("technical.markOneHint")}
            </p>
            <form
              action={markNotApplicableAction.bind(null, locale, id)}
              className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              <label className="sm:col-span-1">
                <span className="text-micro text-secondary">{t("prices.item")}</span>
                <select name="dealLineId" className={`${INPUT} mt-1`}>
                  {file.items.map((row) => (
                    <option key={row.dealLineId} value={row.dealLineId}>
                      {file.order.get(row.dealLineId)} — {row.designation}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="text-micro text-secondary">{t("technical.reason")}</span>
                <input
                  name="reason"
                  placeholder={t("technical.reasonPlaceholder")}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <div className="sm:col-span-3 flex justify-end">
                <Button type="submit" variant="secondary">
                  {t("technical.markIt")}
                </Button>
              </div>
            </form>

            {file.items.some((i) => i.notApplicableReason) ? (
              <ul className="mt-4 flex flex-col gap-2 border-t border-line-subtle pt-3">
                {file.items
                  .filter((i) => i.notApplicableReason)
                  .map((row) => (
                    <li key={row.dealLineId} className="flex items-baseline gap-3 text-tiny">
                      <span className="min-w-0 truncate text-ink">{row.designation}</span>
                      <span className="min-w-0 truncate text-micro text-muted">
                        {row.notApplicableReason}
                      </span>
                      <form
                        action={clearNotApplicableAction.bind(null, locale, id)}
                        className="ms-auto shrink-0"
                      >
                        <input type="hidden" name="itemId" value={row.itemId ?? ""} />
                        <button
                          type="submit"
                          className="text-micro text-accent-ink hover:underline"
                        >
                          {t("technical.undo")}
                        </button>
                      </form>
                    </li>
                  ))}
              </ul>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("technical.annexe")}</h2>
              <span className="ms-auto text-micro text-muted">{t("technical.annexeHow")}</span>
            </div>

            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-tiny sm:grid-cols-4">
              {(
                [
                  ["pages", t("technical.nPages", { n: verdict.pages })],
                  ["language", file.deal.docLocale.toUpperCase()],
                  ["includes", t("technical.kinds")],
                  ["coverPage", t("technical.coverPageValue")],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-micro text-secondary">{t(`technical.annexeField.${key}`)}</dt>
                  <dd className="mt-0.5 text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            {/*
              LAW 3 on screen. The annexe is not a folder of loose PDFs emailed
              alongside the offer — it is one document, numbered, in the client's
              language, produced by the same engine as everything else.
            */}
            <p className="mt-3 text-micro leading-relaxed text-secondary">
              {t("technical.annexeIsOneDocument")}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Badge
                tone={
                  verdict.blocksSubmission ? "critical" : verdict.buildable ? "good" : "neutral"
                }
              >
                {verdict.blocksSubmission
                  ? t("technical.blockedN", { n: verdict.gaps.length })
                  : verdict.buildable
                    ? t("technical.readyToBuild")
                    : t("technical.nothingToBuild")}
              </Badge>
              <div className="ms-auto">
                {/*
                  Greyed with a reason, never hidden. Screen 80 asks for a reason
                  on every disabled control; the document engine's annexe
                  renderer is phase 6.
                */}
                <Button variant="primary" disabledReason={t("rules.comingInPhase", { phase: 6 })}>
                  {t("technical.buildAnnexe")}
                </Button>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("prices.coverage")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              {(
                [
                  ["items", coverage.items, "neutral"],
                  ["complete", coverage.complete, "good"],
                  ["notApplicable", coverage.notApplicable, "neutral"],
                  ["missing", coverage.missing, coverage.missing > 0 ? "critical" : "good"],
                ] as const
              ).map(([key, value, tone]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`technical.coverageRow.${key}`)}</dt>
                  <dd className="ms-auto">
                    <Badge tone={tone}>{value}</Badge>
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 text-micro uppercase tracking-wide text-muted">
              {t("technical.whereTheyCameFrom")}
            </p>
            <dl className="mt-2 flex flex-col gap-1.5 text-micro">
              {(
                [
                  ["fromSupplier", coverage.fromSupplier],
                  ["fromManufacturer", coverage.fromManufacturer],
                  ["ourPhotos", coverage.ourPhotos],
                  ["fromClient", coverage.fromClient],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`technical.coverageRow.${key}`)}</dt>
                  <dd className="ms-auto tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {verdict.gaps.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface">
              <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">
                  {t("technical.theMissing", { n: verdict.gaps.length })}
                </h2>
              </div>
              <ul className="flex flex-col">
                {verdict.gaps.map((gap) => (
                  <li
                    key={gap.dealLineId}
                    className="flex items-center gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-tiny text-ink">
                      {gap.designation}
                    </span>
                    {/*
                      The action differs by state, which is the point of having
                      states rather than a boolean. Chasing a supplier for a file
                      is a different job from finding a supplier at all.
                    */}
                    <Badge tone={gap.state === "noSupplierYet" ? "critical" : "warning"}>
                      {t(`technical.nextStep.${nextStepFor(gap.state)}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("technical.howFilesArrive")}</h2>
              <span className="ms-auto text-micro text-muted">{t("technical.sameePlace")}</span>
            </div>
            <ul className="mt-3 flex flex-col gap-2">
              {(
                [
                  ["supplierPdf", "good"],
                  ["supplierPhoto", "good"],
                  ["youPhotograph", "good"],
                  ["clientSends", "accent"],
                  ["makerSite", "warning"],
                  ["nobodyHas", "neutral"],
                ] as const
              ).map(([key, tone]) => (
                <li key={key} className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 text-tiny text-ink">
                    {t(`technical.arrive.${key}.what`)}
                  </p>
                  <span className="shrink-0">
                    <Badge tone={tone}>{t(`technical.arrive.${key}.state`)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
