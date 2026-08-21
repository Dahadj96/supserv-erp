import { Check, CircleAlert, CircleX, Minus } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ChecklistRow, checklist, summarise } from "@/documents/checklist";
import { NotRenderable, render } from "@/documents/engine";
import { setupState } from "@/domain/setup";
import { Link } from "@/i18n/navigation";
import { issueDocument } from "./actions";

/**
 * Screen 18 — the document, and the ten things we checked before offering to
 * issue it.
 *
 * The preview on the left is not a drawing of the document: it is the document,
 * served by the one renderer through /api/documents/[id]/pdf. A second renderer
 * that produced a nice HTML approximation would drift from the PDF the client
 * receives, and the whole point of this screen is that what you see is what
 * they get.
 */
export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ issued?: string; error?: string; rule?: string }>;
}) {
  const { locale, id } = await params;
  const { issued, error, rule } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  let doc: Awaited<ReturnType<typeof render>>;
  try {
    doc = await render({ documentId: id, purpose: "preview", actorId: session.userId });
  } catch (thrown) {
    if (thrown instanceof NotRenderable) notFound();
    throw thrown;
  }

  const rows = checklist(doc);
  const summary = summarise(rows);
  const setup = await setupState();
  const allowed = mayIssue(session.role, doc.kind);

  // LAW 5 first, then who you are, then day one, then the rules. The order is
  // the order the refusals actually happen in, so the reason on the button is
  // the reason the action would give.
  const blockedRow = rows.find((r) => r.state === "block");
  const disabledReason = doc.number
    ? t("documents.alreadyIssued")
    : !allowed
      ? t("documents.notAllowed")
      : !setup.canIssue
        ? t("documents.setupIncomplete", {
            missing: setup.missing.map((m) => t(`setup.step.${m}`)).join(", "),
          })
        : blockedRow
          ? rowLabel(t, blockedRow)
          : undefined;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <p className="text-micro text-muted">
            {t.has(`documents.kind.${doc.kind}`) ? t(`documents.kind.${doc.kind}`) : doc.kind}
          </p>
          <h1 className="mt-0.5 text-[19px] font-semibold text-ink">
            {doc.number ?? t("documents.draft")}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {t("documents.forClient", { client: doc.counterparty.legalName })}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          <a href={`/api/documents/${id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="secondary">{t("documents.downloadPdf")}</Button>
          </a>
          <Button variant="secondary" disabledReason={t("documents.sendUnavailable")}>
            {t("documents.sendByEmail")}
          </Button>
          <form action={issueDocument.bind(null, locale, id)}>
            <Button type="submit" variant="primary" disabledReason={disabledReason}>
              {t("documents.issue")}
            </Button>
          </form>
        </div>
      </div>

      {issued ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("documents.issuedOk", { number: doc.number ?? "" })}
        </p>
      ) : null}

      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`documents.error.${error}`) ? t(`documents.error.${error}`) : error}
          {rule && t.has(`rules.${rule}`) ? ` — ${t(`rules.${rule}`)}` : null}
        </p>
      ) : null}

      {blockedRow ? (
        <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleX className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-critical-ink">
            {t("documents.cannotIssueBecause", { reason: rowLabel(t, blockedRow) })}{" "}
            {provenance(t, blockedRow)}
          </p>
          {blockedRow.fixRoute ? (
            <Link className="ms-auto shrink-0" href={blockedRow.fixRoute}>
              <Button variant="secondary" size="small">
                {t("documents.fixIt")}
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <section className="col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
          {/* A4 is 1:1.414. The object element gives us the browser's own PDF
              viewer, which is the closest thing to what the client will open. */}
          <object
            data={`/api/documents/${id}/pdf`}
            type="application/pdf"
            className="h-[900px] w-full rounded-[var(--radius-control)] bg-plane"
            aria-label={t("documents.previewLabel")}
          >
            <p className="p-6 text-tiny text-secondary">
              {t("documents.previewUnavailable")}{" "}
              <a className="font-medium text-accent-ink" href={`/api/documents/${id}/pdf`}>
                {t("documents.downloadPdf")}
              </a>
            </p>
          </object>
        </section>

        <div className="flex flex-col gap-5">
          <BeforeIssuing rows={rows} summary={summary} t={t} />
          <Output doc={doc} t={t} />
        </div>
      </div>
    </main>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

/** The row's own words. A rule that fails says why; a fact says what we hold. */
function rowLabel(t: T, row: ChecklistRow): string {
  const key = `checklist.row.${row.key}`;
  return t.has(key) ? t(key) : row.key;
}

function rowDetail(t: T, row: ChecklistRow): string {
  if (row.value) return row.value;
  if (row.noteKey) {
    const key = `checklist.note.${row.noteKey}`;
    if (t.has(key)) return t(key);
    const asRule = `rules.${row.noteKey.replace(/^fail\./, "")}`;
    if (t.has(asRule)) return t(asRule);
  }
  return "";
}

/** Screen 69's promise, restated on every row that has an author. */
function provenance(t: T, row: ChecklistRow): string {
  if (!row.authority) return "";
  if (row.confirmedBy && row.confirmedOn) {
    return t("documents.ruleConfirmed", {
      authority: row.authority,
      who: row.confirmedBy,
      on: row.confirmedOn,
    });
  }
  return t("documents.ruleUnconfirmed", { authority: row.authority });
}

const ICON = {
  pass: <Check className="mt-px size-4 shrink-0 text-good-ink" aria-hidden />,
  warn: <CircleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />,
  block: <CircleX className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />,
  note: <Minus className="mt-px size-4 shrink-0 text-muted" aria-hidden />,
};

const DETAIL_TONE = {
  pass: "text-muted",
  warn: "text-warning-ink",
  block: "text-critical-ink",
  note: "text-muted",
};

function BeforeIssuing({
  rows,
  summary,
  t,
}: {
  rows: ChecklistRow[];
  summary: { blockers: number; warnings: number };
  t: T;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className="text-tiny font-semibold text-ink">{t("checklist.title")}</h2>
        <span className="ms-auto text-micro text-muted">
          {t("checklist.summary", { blockers: summary.blockers, warnings: summary.warnings })}
        </span>
      </div>

      <ul>
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-start gap-2.5 border-b border-line-subtle px-5 py-2.5 last:border-0"
          >
            {ICON[row.state]}
            <div className="min-w-0">
              <p className="text-tiny text-ink">{rowLabel(t, row)}</p>
              <p className={`truncate text-micro ${DETAIL_TONE[row.state]}`}>{rowDetail(t, row)}</p>
              {row.authority ? (
                <p className="mt-0.5 text-micro text-muted">{provenance(t, row)}</p>
              ) : null}
            </div>
            {row.state !== "pass" && row.fixRoute ? (
              <Link className="ms-auto shrink-0" href={row.fixRoute}>
                <Button variant="ghost" size="small">
                  {t("documents.fixIt")}
                </Button>
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
        {t("checklist.footnote")}
      </p>
    </section>
  );
}

function Output({ doc, t }: { doc: Awaited<ReturnType<typeof render>>; t: T }) {
  const fields: [string, string][] = [
    ["language", doc.locale.toUpperCase()],
    ["currency", "DZD"],
    ["template", doc.template],
    ["issuedOn", doc.issuedOn],
  ];

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-tiny font-semibold text-ink">{t("documents.output")}</h2>
        <Badge tone={doc.number ? "good" : "neutral"}>
          {doc.number ? t("documents.stateIssued") : t("documents.stateDraft")}
        </Badge>
      </div>

      <dl className="mt-3">
        {fields.map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
          >
            <dt className="text-tiny text-secondary">{t(`documents.field.${key}`)}</dt>
            <dd className="ms-auto min-w-0 truncate text-end text-tiny text-muted">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 rounded-[var(--radius-control)] bg-accent-bg p-3 text-micro leading-relaxed text-accent-ink">
        {t("documents.localeFromClient")}
      </p>
    </section>
  );
}
