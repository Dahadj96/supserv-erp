import { CircleAlert, Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ChangeKind, keepsItsPrice, type LineState } from "@/domain/tender/bpu";
import { bpuSources, loadBpuBatch } from "@/domain/tender/bpu-batch";
import { BPU_TARGETS } from "@/domain/tender/bpu-columns";
import { bpu, pendingErratum } from "@/domain/tender/bpu-store";
import { Link } from "@/i18n/navigation";
import {
  applyErratumAction,
  applyLastPricesAction,
  confirmMappingAction,
  discardErratumAction,
  uploadBpuAction,
} from "./actions";

/**
 * Screen 42 — the bordereau des prix, and the erratum.
 *
 * THE BPU IS THE DEAL'S LINES. There is no second table of bordereau rows:
 * `deal_line` already holds the client's own number, their reference, their
 * designation, the quantity and the unit, and screen 06 put them there.
 *
 * The screen prices those lines, and it does it by SHOWING WHAT IS ALREADY
 * KNOWN — what we last paid for the article, what a supplier has quoted this
 * time, how far prices have moved since. "42 lines imported without retyping.
 * 11 of them we have priced before" is the whole argument of the screen.
 *
 * `Our price` is READ from the draft offer and is not editable here. Screen 12
 * sets it, under `offers.margin.view`, and one place to set a price is the only
 * arrangement where two places cannot disagree.
 */
export const dynamic = "force-dynamic";

const LINE_TONE: Record<LineState, BadgeTone> = {
  priced: "good",
  awaitingQuote: "warning",
  noPrice: "critical",
};

const CHANGE_TONE: Record<ChangeKind, BadgeTone> = {
  added: "accent",
  removed: "critical",
  quantityChanged: "warning",
  designationChanged: "serious",
  unitChanged: "serious",
  unchanged: "neutral",
};

type Search = Record<string, string | string[] | undefined>;
const one = (search: Search, key: string): string | null => {
  const value = search[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
};

export default async function BpuPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const search = await searchParams;

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const view = await bpu(id);
  if (!view) notFound();

  const format = await getFormatter({ locale });
  const seesCost = Boolean(session.role && can(session.role, "offers.margin.view"));

  const batchId = one(search, "batch");
  const batch = batchId ? await loadBpuBatch(batchId) : null;
  const erratum = await pendingErratum(id);
  const sources = await bpuSources(id);

  const tab = one(search, "tab") ?? (batch ? "mapping" : "lines");
  const error = one(search, "error");

  const money = (value: string | null) =>
    value === null ? "—" : format.number(Number(value), { maximumFractionDigits: 0 });

  const TABS = [
    { key: "lines", count: view.rows.length },
    { key: "mapping", count: null },
    { key: "erratum", count: view.changedByErratum || null },
    { key: "sources", count: sources.length || null },
  ] as const;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 pt-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-title font-semibold text-ink">
              {t("bpu.title", { n: view.rows.length })}
            </h1>
            <p className="mt-1 text-tiny text-muted">
              {[
                view.clientReference ?? view.ref,
                view.source ? t("bpu.readFrom", { file: view.source }) : null,
                view.changedByErratum
                  ? t("bpu.replacedByErratum", { n: view.changedByErratum })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-2">
            <Link
              href={`/deals/${view.dealId}`}
              className="rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-base text-ink hover:bg-sunken"
            >
              {t("bpu.askSuppliers")}
            </Link>
            {view.draftOfferId ? (
              <Link
                href={`/offers/${view.draftOfferId}/build`}
                className="rounded-[var(--radius-control)] bg-ink px-3.5 py-2 text-base text-on-ink hover:bg-ink-hover"
              >
                {t("bpu.buildOffer")}
              </Link>
            ) : (
              <Button disabledReason={t("bpu.noDraftOffer")}>{t("bpu.buildOffer")}</Button>
            )}
          </div>
        </div>

        <nav className="mt-4 flex gap-5">
          {TABS.map((entry) => (
            <Link
              key={entry.key}
              href={`/tenders/${id}/bpu?tab=${entry.key}${batchId ? `&batch=${batchId}` : ""}`}
              className={`-mb-px border-b-2 pb-2.5 text-tiny ${
                tab === entry.key
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent text-secondary hover:text-ink"
              }`}
            >
              {t(`bpu.tab.${entry.key}`)}
              {entry.count ? (
                <span className="ms-1.5 tabular-nums text-muted">{entry.count}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </div>

      {error ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">{t(`bpu.error.${error}`)}</p>
        </div>
      ) : null}

      {view.rows.length > 0 && view.knownBefore > 0 ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-center gap-3 rounded-[var(--radius-control)] border border-good bg-good-bg px-4 py-3">
          <Info className="size-4 shrink-0 text-good-ink" aria-hidden />
          <p className="max-w-[940px] text-tiny leading-relaxed text-good-ink">
            {t("bpu.banner", { lines: view.rows.length, known: view.knownBefore })}
          </p>
          {seesCost ? (
            <form action={applyLastPricesAction.bind(null, locale, id)} className="ms-auto">
              <button
                type="submit"
                className="shrink-0 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-small text-ink hover:bg-sunken"
              >
                {t("bpu.applyLastPrices")}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          {tab === "lines" ? (
            <LinesCard />
          ) : tab === "mapping" ? (
            <MappingCard />
          ) : tab === "erratum" ? (
            <ErratumCard />
          ) : (
            <SourcesCard />
          )}
        </div>

        <div className="flex flex-col gap-5">
          <ProgressCard />
          {seesCost ? <TotalsCard /> : null}
          {view.drift ? <HistoryCard /> : null}
          {erratum ? <ErratumPanel /> : null}
        </div>
      </div>
    </main>
  );

  /* ------------------------------------------------------------- the lines */

  function LinesCard() {
    if (view === null || view.rows.length === 0) {
      return (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("bpu.empty.title")}</h2>
          <p className="mt-2 max-w-[560px] text-tiny leading-relaxed text-secondary">
            {t("bpu.empty.body")}
          </p>
          <form
            action={uploadBpuAction.bind(null, locale, id)}
            className="mt-4 flex items-center gap-3"
          >
            <input type="hidden" name="kind" value="deal_line" />
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls,.csv"
              required
              className="text-tiny text-secondary file:me-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-small file:text-ink"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-ink px-3.5 py-2 text-base text-on-ink hover:bg-ink-hover"
            >
              {t("bpu.read")}
            </button>
          </form>
        </section>
      );
    }

    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-tiny font-semibold text-ink">{t("bpu.lines.title")}</h2>
          <span className="ms-auto text-micro text-muted">
            {t("bpu.lines.count", { n: view.rows.length })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-tiny">
            <thead>
              <tr className="border-b border-line-subtle text-micro text-muted">
                <th className="px-5 py-2 text-start font-normal">{t("bpu.col.position")}</th>
                <th className="py-2 text-start font-normal">{t("bpu.col.designation")}</th>
                <th className="py-2 text-start font-normal">{t("bpu.col.unit")}</th>
                <th className="py-2 text-end font-normal">{t("bpu.col.qty")}</th>
                {seesCost ? (
                  <>
                    <th className="py-2 text-end font-normal">{t("bpu.col.lastPaid")}</th>
                    <th className="py-2 text-end font-normal">{t("bpu.col.cost")}</th>
                    <th className="py-2 text-end font-normal">{t("bpu.col.margin")}</th>
                  </>
                ) : null}
                <th className="py-2 text-end font-normal">{t("bpu.col.ourPrice")}</th>
                <th className="px-5 py-2 text-end font-normal" />
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.position} className="border-b border-line-subtle last:border-0">
                  <td className="px-5 py-2.5 tabular-nums text-secondary">{row.position}</td>
                  <td className="max-w-[280px] truncate py-2.5 text-ink" title={row.designation}>
                    {row.designation}
                  </td>
                  <td className="py-2.5 text-secondary">{row.unit ?? "—"}</td>
                  <td className="py-2.5 text-end tabular-nums text-ink">
                    {format.number(Number(row.qty), { maximumFractionDigits: 3 })}
                  </td>
                  {seesCost ? (
                    <>
                      <td className="py-2.5 text-end tabular-nums text-muted">
                        {money(row.lastPaid)}
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-secondary">
                        {money(row.cost)}
                      </td>
                      <td className="py-2.5 text-end tabular-nums text-secondary">
                        {row.marginPct === null ? "—" : `${row.marginPct}%`}
                      </td>
                    </>
                  ) : null}
                  <td className="py-2.5 text-end tabular-nums font-medium text-ink">
                    {money(row.ourPrice)}
                  </td>
                  <td className="px-5 py-2.5 text-end">
                    <Badge tone={LINE_TONE[row.state]}>{t(`bpu.state.${row.state}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  /* ------------------------------------------------- the mapping, confirmed */

  function MappingCard() {
    if (!batch) {
      return (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("bpu.mapping.title")}</h2>
          <p className="mt-2 max-w-[560px] text-tiny leading-relaxed text-secondary">
            {t("bpu.mapping.idle")}
          </p>

          <form
            action={uploadBpuAction.bind(null, locale, id)}
            className="mt-4 flex flex-wrap items-center gap-3"
          >
            <input
              type="hidden"
              name="kind"
              value={view && view.rows.length > 0 ? "bpu_erratum" : "deal_line"}
            />
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls,.csv"
              required
              className="text-tiny text-secondary file:me-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-small file:text-ink"
            />
            <button
              type="submit"
              className="rounded-[var(--radius-control)] bg-ink px-3.5 py-2 text-base text-on-ink hover:bg-ink-hover"
            >
              {view && view.rows.length > 0 ? t("bpu.readErratum") : t("bpu.read")}
            </button>
          </form>
        </section>
      );
    }

    return (
      <form action={confirmMappingAction.bind(null, locale, id)}>
        <input type="hidden" name="batchId" value={batch.batchId} />

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("bpu.mapping.title")}</h2>
            <span className="ms-auto text-micro text-muted">{t("bpu.mapping.once")}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
            {batch.headers.map((heading) => (
              <label key={heading} className="block">
                <span className="block text-micro text-muted">{heading}</span>
                <select
                  name={`column:${heading}`}
                  defaultValue={batch.mapping[heading] ?? ""}
                  className="mt-1 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-tiny text-ink"
                >
                  <option value="">{t("bpu.target.ignored")}</option>
                  {BPU_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`bpu.target.${target}`)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="border-t border-line-subtle px-5 py-3.5">
            <p className="text-micro leading-relaxed text-muted">
              {t("bpu.mapping.readFile", {
                file: batch.filename,
                sheet: batch.sheetName ?? "—",
                lines: batch.read.lines.length,
              })}
            </p>
            {batch.read.problems.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {batch.read.problems.slice(0, 8).map((problem) => (
                  <li key={problem.row} className="text-micro text-warning-ink">
                    {t(`bpu.problem.${problem.reason}`, { row: problem.row })}
                  </li>
                ))}
                {batch.read.problems.length > 8 ? (
                  <li className="text-micro text-muted">
                    {t("bpu.problem.more", { n: batch.read.problems.length - 8 })}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t border-line-subtle px-5 py-3.5">
            {batch.kind === "bpu_erratum" ? (
              <label className="flex items-center gap-2 text-micro text-secondary">
                {t("bpu.erratum.receivedOn")}
                <input
                  type="date"
                  name="receivedOn"
                  className="rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-tiny text-ink"
                />
              </label>
            ) : null}
            <button
              type="submit"
              className="ms-auto rounded-[var(--radius-control)] bg-ink px-3.5 py-2 text-base text-on-ink hover:bg-ink-hover"
            >
              {batch.kind === "bpu_erratum"
                ? t("bpu.mapping.fileErratum")
                : t("bpu.mapping.confirm", { n: batch.read.lines.length })}
            </button>
          </div>
        </section>
      </form>
    );
  }

  /* ----------------------------------------------------------- the erratum */

  function ErratumCard() {
    if (!erratum) {
      return (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("bpu.erratum.none")}</h2>
          <p className="mt-2 max-w-[560px] text-tiny leading-relaxed text-secondary">
            {t("bpu.erratum.noneWhy")}
          </p>
        </section>
      );
    }

    const { review } = erratum;

    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-tiny font-semibold text-ink">
            {erratum.receivedOn
              ? t("bpu.erratum.of", { on: erratum.receivedOn })
              : t("bpu.erratum.title")}
          </h2>
          <span className="ms-auto text-micro text-muted">
            {t("bpu.erratum.count", { n: review.material.length })}
          </span>
        </div>

        <p className="border-b border-line-subtle px-5 py-3 text-micro leading-relaxed text-secondary">
          {t("bpu.erratum.explain", {
            repriced: review.summary.repriced,
            losing: review.summary.losesPrice,
          })}
        </p>

        {review.issuedOffers.length > 0 ? (
          <div className="flex items-start gap-3 border-b border-line-subtle bg-critical-bg px-5 py-3">
            <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
            <p className="text-micro leading-relaxed text-critical-ink">
              {t("bpu.erratum.issued", { numbers: review.issuedOffers.join(", ") })}
            </p>
          </div>
        ) : null}

        <ul>
          {review.material.map((change) => (
            <li
              key={change.position}
              className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
            >
              <span className="w-10 shrink-0 tabular-nums text-tiny text-secondary">
                {change.position}
              </span>
              <span className="min-w-0 truncate text-tiny text-ink">
                {change.after?.designation ?? change.before?.designation ?? "—"}
              </span>
              <span className="ms-auto flex shrink-0 items-center gap-2">
                {change.from !== undefined && change.to !== undefined ? (
                  <span className="text-micro tabular-nums text-muted">
                    {change.from} → {change.to}
                  </span>
                ) : null}
                <Badge tone={CHANGE_TONE[change.kind]}>{t(`bpu.change.${change.kind}`)}</Badge>
                {!keepsItsPrice(change.kind) ? (
                  <Badge tone="warning">{t("bpu.change.losesPrice")}</Badge>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        {seesCost ? (
          <div className="border-t border-line-subtle px-5 py-3.5">
            <form
              action={applyErratumAction.bind(null, locale, id)}
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="erratumId" value={erratum.id} />
              <input
                type="text"
                name="reason"
                placeholder={t("bpu.erratum.reason")}
                className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-tiny text-ink"
              />
              {review.issuedOffers.length > 0 ? (
                <label className="flex items-start gap-2 text-micro leading-relaxed text-critical-ink">
                  <input type="checkbox" name="acknowledgeIssued" className="mt-0.5" />
                  {t("bpu.erratum.acknowledge")}
                </label>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-[var(--radius-control)] bg-critical px-3.5 py-2 text-base text-on-ink hover:brightness-95"
                >
                  {t("bpu.erratum.apply")}
                </button>
                <button
                  type="submit"
                  formAction={discardErratumAction.bind(null, locale, id)}
                  className="rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-base text-ink hover:bg-sunken"
                >
                  {t("bpu.erratum.discard")}
                </button>
              </div>
              <p className="text-micro leading-relaxed text-muted">{t("bpu.erratum.detachWhy")}</p>
            </form>
          </div>
        ) : null}
      </section>
    );
  }

  /* ----------------------------------------------------------- the sources */

  function SourcesCard() {
    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-tiny font-semibold text-ink">{t("bpu.sources.title")}</h2>
          <span className="ms-auto text-micro text-muted">{t("bpu.sources.never")}</span>
        </div>

        {sources.length === 0 ? (
          <p className="px-5 py-4 text-tiny text-secondary">{t("bpu.sources.none")}</p>
        ) : (
          <ul>
            {sources.map((source) => (
              <li
                key={source.id}
                className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-tiny text-ink">{source.filename}</p>
                  <p className="mt-0.5 text-micro text-muted">
                    {t("bpu.sources.line", {
                      kind: t(`bpu.sources.kind.${source.becomes}`),
                      total: source.rowsTotal,
                      imported: source.rowsImported,
                      skipped: source.rowsSkipped,
                    })}
                  </p>
                </div>
                <span className="ms-auto shrink-0 text-micro text-muted">
                  {format.dateTime(source.createdAt, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  /* -------------------------------------------------------- the right rail */

  function ProgressCard() {
    const rows = [
      { key: "imported", value: view?.totals.lines ?? 0, tone: "neutral" as BadgeTone },
      { key: "priced", value: view?.totals.priced ?? 0, tone: "good" as BadgeTone },
      {
        key: "awaitingQuote",
        value: view?.totals.awaitingQuote ?? 0,
        tone: "warning" as BadgeTone,
      },
      { key: "noPrice", value: view?.totals.noPrice ?? 0, tone: "critical" as BadgeTone },
      { key: "erratum", value: view?.changedByErratum ?? 0, tone: "serious" as BadgeTone },
    ];

    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("bpu.progress.title")}</h2>
        <dl className="mt-3">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
            >
              <dt className="text-tiny text-secondary">{t(`bpu.progress.${row.key}`)}</dt>
              <dd className="ms-auto">
                <Badge tone={row.value === 0 ? "neutral" : row.tone}>{row.value}</Badge>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  function TotalsCard() {
    const totals = view?.totals;
    if (!totals) return null;

    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-tiny font-semibold text-ink">{t("bpu.totals.title")}</h2>
          <span className="ms-auto text-micro text-muted">{t("bpu.totals.hidden")}</span>
        </div>

        <dl className="mt-3">
          <Row
            label={t("bpu.totals.cost")}
            value={`${money(totals.totalCost)} ${view?.currency}`}
          />
          <Row
            label={t("bpu.totals.excl")}
            value={`${money(totals.totalExcl)} ${view?.currency}`}
          />
          <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
            <dt className="text-tiny text-secondary">{t("bpu.totals.margin")}</dt>
            <dd className="ms-auto">
              <Badge tone={Number(totals.marginAmount) > 0 ? "good" : "neutral"}>
                {money(totals.marginAmount)} {view?.currency}
                {totals.marginPct === null ? "" : ` · ${totals.marginPct}%`}
              </Badge>
            </dd>
          </div>
          {view?.cautionPct ? (
            <Row
              label={t("bpu.totals.caution", { pct: view.cautionPct })}
              value={`${money(totals.caution)} ${view.currency}`}
            />
          ) : null}
        </dl>

        {totals.priced < totals.lines ? (
          <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
            {t("bpu.totals.partial", { priced: totals.priced, lines: totals.lines })}
          </p>
        ) : null}
      </section>
    );
  }

  function HistoryCard() {
    const drift = view?.drift;
    if (!drift) return null;

    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("bpu.history.title")}</h2>
        <dl className="mt-3">
          <Row label={t("bpu.history.known")} value={String(view?.knownBefore ?? 0)} />
          <div className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0">
            <dt className="text-tiny text-secondary">{t("bpu.history.drift")}</dt>
            <dd className="ms-auto">
              <Badge tone={drift.pct > 0 ? "warning" : "good"}>
                {drift.pct > 0 ? "+" : ""}
                {drift.pct}%
              </Badge>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-micro leading-relaxed text-muted">
          {t("bpu.history.why", { lines: drift.lines })}
        </p>
      </section>
    );
  }

  function ErratumPanel() {
    if (!erratum) return null;

    return (
      <section className="rounded-[var(--radius-card)] border border-serious-bg bg-surface p-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-tiny font-semibold text-ink">
            {erratum.receivedOn
              ? t("bpu.erratum.of", { on: erratum.receivedOn })
              : t("bpu.erratum.title")}
          </h2>
          <span className="ms-auto text-micro text-muted">
            {t("bpu.erratum.count", { n: erratum.review.material.length })}
          </span>
        </div>

        <ul className="mt-3 flex flex-col gap-2">
          {erratum.review.material.slice(0, 6).map((change) => (
            <li key={change.position} className="flex items-baseline gap-3">
              <span className="text-tiny text-secondary">
                {t("bpu.erratum.lineIs", {
                  n: change.position,
                  what: t(`bpu.change.${change.kind}`),
                })}
              </span>
              <span className="ms-auto shrink-0">
                <Badge tone={CHANGE_TONE[change.kind]}>
                  {change.from !== undefined && change.to !== undefined
                    ? `${change.from} → ${change.to}`
                    : t(`bpu.change.${change.kind}`)}
                </Badge>
              </span>
            </li>
          ))}
        </ul>

        <Link
          href={`/tenders/${id}/bpu?tab=erratum`}
          className="mt-4 inline-block rounded-[var(--radius-control)] bg-critical px-3.5 py-2 text-base text-on-ink hover:brightness-95"
        >
          {t("bpu.erratum.review")}
        </Link>
      </section>
    );
  }

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0">
        <dt className="text-tiny text-secondary">{label}</dt>
        <dd className="ms-auto tabular-nums text-tiny text-ink">{value}</dd>
      </div>
    );
  }
}
