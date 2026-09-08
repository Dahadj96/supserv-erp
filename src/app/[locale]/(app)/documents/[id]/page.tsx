import { Check, CircleAlert, CircleX, Minus } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ChecklistRow, checklist, summarise } from "@/documents/checklist";
import { targetsFor } from "@/documents/conversion";
import { NotRenderable, render } from "@/documents/engine";
import { mayDeliverAgainst } from "@/domain/delivery/lines";
import { deliveryNotesFor } from "@/domain/delivery/store";
import { setupState } from "@/domain/setup";
import { Link } from "@/i18n/navigation";
import { fileIssuedDocument, issueDocument } from "./actions";

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

/*
  What goods can be delivered against is `DELIVERABLE_KINDS` in
  `src/domain/delivery/lines.ts`, and it was a second list typed here that left
  out `client_order` — the client's own bon de commande, the one document that
  IS their agreement. The button was missing on exactly the kind the rest of
  the module says deliveries should hang off.
*/

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{
    issued?: string;
    filed?: string;
    converted?: string;
    error?: string;
    rule?: string;
  }>;
}) {
  const { locale, id } = await params;
  const { issued, filed, converted, error, rule } = await searchParams;
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
  // Whether anything has actually been delivered against this document, which
  // is what decides if "invoice what is delivered" is a sentence that means
  // anything here.
  const notes = doc.issued ? await deliveryNotesFor(id) : [];
  const setup = await setupState();
  const allowed = mayIssue(session.role, doc.kind);

  // LAW 5 first, then who you are, then day one, then the rules. The order is
  // the order the refusals actually happen in, so the reason on the button is
  // the reason the action would give.
  const blockedRow = rows.find((r) => r.state === "block");
  const disabledReason = doc.issued
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
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <p className="text-micro text-muted">
            {t.has(`documents.kind.${doc.kind}`) ? t(`documents.kind.${doc.kind}`) : doc.kind}
          </p>
          <h1 className="mt-0.5 text-[19px] font-semibold text-ink">
            {doc.number ?? (doc.issued ? t("documents.stateIssued") : t("documents.draft"))}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {t("documents.forClient", { client: doc.counterparty.legalName })}
          </p>
        </div>

        <div className="ms-auto flex items-center gap-2">
          {/* A draft can still be changed; an issued document cannot, and the
              way to say so is not to offer the door. */}
          {doc.issued ? null : (
            <Link
              href={
                // A situation's quantities are edited against the marché on
                // the project's own screen; the builder would lose the link.
                doc.situation
                  ? `/projects/${doc.situation.projectId}/situation`
                  : // An avenant, likewise, is written against the bordereau
                    // it changes and not in the builder.
                    doc.amendment?.projectId
                    ? `/projects/${doc.amendment.projectId}/amendment`
                    : `/documents/${id}/edit`
              }
            >
              <Button variant="secondary">{t("documents.edit")}</Button>
            </Link>
          )}
          {/* Screen 48. Offered only on an issued document that may become
              something else — converting a draft is just editing it. */}
          {doc.issued && !doc.situation && targetsFor(doc.kind).length > 0 ? (
            <Link href={`/documents/${id}/convert`}>
              <Button variant="secondary">{t("documents.convert")}</Button>
            </Link>
          ) : null}
          {/* Screen 49. Goods can only be delivered against something the
              client has actually agreed to, and a BL cannot deliver a BL. */}
          {doc.issued && !doc.situation && mayDeliverAgainst(doc.kind) ? (
            <Link href={`/deliveries/new?source=${id}`}>
              <Button variant="secondary">{t("documents.recordDelivery")}</Button>
            </Link>
          ) : null}
          {/*
            Screen 72. Offered only once something has actually been delivered
            against this document — "invoice what is delivered" is a route to
            cash, and offering it when nothing has gone out is offering to
            invoice a client for goods still in the warehouse. The whole-document
            case is Convert, above.
          */}
          {doc.issued && notes.length > 0 && doc.kind !== "invoice" ? (
            <Link href={`/invoices/new?source=${id}`}>
              <Button variant="secondary">{t("documents.invoiceDelivered")}</Button>
            </Link>
          ) : null}
          <a href={`/api/documents/${id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="secondary">{t("documents.downloadPdf")}</Button>
          </a>
          <Button variant="secondary" disabledReason={t("documents.sendUnavailable")}>
            {t("documents.sendByEmail")}
          </Button>
          {doc.issued ? (
            allowed ? (
              <form action={fileIssuedDocument.bind(null, locale, id)}>
                <Button type="submit" variant="secondary">
                  {t("documents.fileAgain")}
                </Button>
              </form>
            ) : null
          ) : (
            <form action={issueDocument.bind(null, locale, id)}>
              <Button type="submit" variant="primary" disabledReason={disabledReason}>
                {t("documents.issue")}
              </Button>
            </form>
          )}
        </div>
      </div>

      {issued ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("documents.issuedOk", { number: doc.number ?? "" })}
        </p>
      ) : null}

      {filed ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("documents.filedOk")}
        </p>
      ) : null}

      {converted ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-accent-bg px-4 py-2.5 text-tiny text-accent-ink">
          {t("documents.convertedOk")}
        </p>
      ) : null}

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`documents.error.${error}`) ? t(`documents.error.${error}`) : error}
          {rule && t.has(`rules.${rule}`) ? ` — ${t(`rules.${rule}`)}` : null}
        </p>
      ) : null}

      {blockedRow ? (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
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

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
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
          {doc.situation ? <SituationPanel s={doc.situation} t={t} /> : null}
          {doc.amendment ? <AmendmentPanel a={doc.amendment} t={t} /> : null}
          <BeforeIssuing rows={rows} summary={summary} t={t} />
          <Output doc={doc} t={t} />
        </div>
      </div>
    </main>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Where a situation stands with the client. The document says what was
 * claimed; the project says whether the paper has gone and come back signed,
 * and those two dates are recorded on screen 16.
 */
function SituationPanel({
  s,
  t,
}: {
  s: NonNullable<Awaited<ReturnType<typeof render>>["situation"]>;
  t: T;
}) {
  const rows: [string, string][] = [
    ["project", `${s.projectCode} — ${s.object}`],
    // Same as the printed form: the marché and the avenants it was raised on.
    [
      "contract",
      s.amendmentRef ? `${s.contractRef ?? "—"} + ${s.amendmentRef}` : (s.contractRef ?? "—"),
    ],
    ["period", s.period ?? "—"],
    ["cumul", s.cumulExcl],
    ["percent", s.percentOfContract === null ? "—" : `${s.percentOfContract} %`],
    ["submitted", s.submittedOn ?? "—"],
    ["approved", s.approvedOn ? `${s.approvedOn}${s.approvedBy ? ` · ${s.approvedBy}` : ""}` : "—"],
  ];
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-tiny font-semibold text-ink">
          {t("documents.situation.title", { n: s.sequence })}
        </h2>
        <Link
          href={`/projects/${s.projectId}`}
          className="ms-auto text-micro text-accent-ink hover:underline"
        >
          {t("documents.situation.toProject")}
        </Link>
      </div>
      <dl className="mt-3">
        {rows.map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline gap-3 border-b border-line-subtle py-1.5 last:border-0"
          >
            <dt className="shrink-0 text-micro text-secondary">
              {t(`documents.situation.${key}`)}
            </dt>
            <dd className="ms-auto text-end text-tiny text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-micro leading-relaxed text-muted">{t("documents.situation.why")}</p>
    </section>
  );
}

/**
 * What this avenant does to the marché.
 *
 * Its own total is the value of the prices it moves, which is not a figure
 * anybody asks about. These three are.
 */
function AmendmentPanel({
  a,
  t,
}: {
  a: NonNullable<Awaited<ReturnType<typeof render>>["amendment"]>;
  t: T;
}) {
  const rows: [string, string][] = [
    ["contract", a.contractNumber ?? "—"],
    ["before", a.contractBeforeExcl],
    ["incidence", a.incidenceExcl],
    ["after", a.contractAfterExcl],
    ["touched", t("documents.amendment.touchedValue", { changed: a.changed, added: a.added })],
  ];
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-tiny font-semibold text-ink">{t("documents.amendment.title")}</h2>
        {a.projectId ? (
          <Link
            href={`/projects/${a.projectId}`}
            className="ms-auto text-micro text-accent-ink hover:underline"
          >
            {t("documents.situation.toProject")}
          </Link>
        ) : null}
      </div>
      <dl className="mt-3">
        {rows.map(([key, value]) => (
          <div
            key={key}
            className="flex items-baseline gap-3 border-b border-line-subtle py-1.5 last:border-0"
          >
            <dt className="shrink-0 text-micro text-secondary">
              {t(`documents.amendment.${key}`)}
            </dt>
            <dd className="ms-auto text-end text-tiny text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-micro leading-relaxed text-muted">{t("documents.amendment.why")}</p>
    </section>
  );
}

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
        <Badge tone={doc.issued ? "good" : "neutral"}>
          {doc.issued ? t("documents.stateIssued") : t("documents.stateDraft")}
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
