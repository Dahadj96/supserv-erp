import { and, eq, sql } from "drizzle-orm";
import { Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { companyIdentity } from "@/db/schema/company";
import { document, documentLine } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { check } from "@/documents/compliance";
import {
  type CarryState,
  CHAIN,
  carryOver,
  chainOf,
  targetsFor,
  undecided,
} from "@/documents/conversion";
import { chainFor } from "@/documents/convert";
import { peekNumber } from "@/documents/numbering";
import { formatMoney } from "@/domain/money";
import { Link } from "@/i18n/navigation";
import { convertAction } from "./actions";

/**
 * Screen 48 — Convert a proforma into a facture.
 *
 * "The proforma is never replaced. It stays on file, linked to the facture, and
 * its number is not reused."
 *
 * The one departure from the frame is the Number row. It shows what the
 * facture's number will LOOK like and says it is not reserved, because
 * `reserveNumber` runs inside the transaction that issues a document — see the
 * note at the top of `src/documents/conversion.ts`.
 */
export const dynamic = "force-dynamic";

const CARRY_TONE: Record<CarryState, BadgeTone> = {
  unchanged: "good",
  changes: "accent",
  toDecide: "warning",
};

/** 30 days, the frame's own default. Editable before anything is created. */
const DEFAULT_TERMS_DAYS = 30;

export default async function ConvertPage({
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

  const [source] = await db
    .select({
      id: document.id,
      kind: document.kind,
      number: document.number,
      status: document.status,
      issuedOn: document.issuedOn,
      currency: document.currency,
      totals: document.totals,
      partyId: document.partyId,
      settlement: document.settlement,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(eq(document.id, id))
    .limit(1);
  if (!source) notFound();

  const targets = targetsFor(source.kind);
  const target = targets[0] ?? "invoice";

  const [counts] = await db
    .select({
      items: sql<number>`count(*) filter (where ${documentLine.lineKind} = 'item' and not ${documentLine.isOption})::int`,
      options: sql<number>`count(*) filter (where ${documentLine.isOption})::int`,
      sections: sql<number>`count(*) filter (where ${documentLine.lineKind} = 'section')::int`,
    })
    .from(documentLine)
    .where(and(eq(documentLine.documentId, id)));

  const [company] = await db.select().from(companyIdentity).limit(1);
  const [counterparty] = await db.select().from(party).where(eq(party.id, source.partyId)).limit(1);

  const totals = (source.totals ?? {}) as { totalExcl?: string; totalIncl?: string };
  const totalExcl = totals.totalExcl ?? "0";

  // The checks that will apply to the FACTURE, not to the proforma. That is the
  // point of doing them here: the NIF has to be fixed before the invoice
  // exists, not discovered on the screen where it is issued.
  const findings = await check({
    kind: target,
    company: company ?? null,
    counterparty: counterparty ?? null,
    total: Number(totals.totalIncl ?? "0"),
    // The proforma may already say how it will be settled; the facture made
    // from it inherits that. Nought duty here: the facture is a new draft and
    // `saveDraft` will put the figure on it.
    settlementInCash: source.settlement === "especes",
    stampDuty: 0,
  });
  const blockers = findings.filter((f) => f.severity === "block");
  const passing = findings.filter((f) => f.severity === "pass");

  const today = new Date();
  const invoiceDate = today.toISOString().slice(0, 10);
  const dueDate = new Date(today.getTime() + DEFAULT_TERMS_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = carryOver({
    source: {
      kind: source.kind,
      number: source.number,
      issuedOn: source.issuedOn ? new Date(`${source.issuedOn}T00:00:00Z`) : null,
      lines: counts?.items ?? 0,
      options: counts?.options ?? 0,
      sections: counts?.sections ?? 0,
      totalExcl,
      clientName: source.clientName,
    },
    target,
    decisions: {
      invoiceDate: today,
      dueDate: new Date(`${dueDate}T00:00:00Z`),
      // The form posts these; until it does, they are the open questions the
      // amber rows name.
      deliveryNote: "skip",
      deliveryDate: null,
      paymentMethod: null,
      paymentMethodWas: null,
    },
    mentions: { passing: passing.length, total: findings.length, blockers: blockers.length },
  });

  const links = await chainFor(id);
  const preview = await peekNumber(target, today);
  const chain = chainOf({
    present: {
      [source.kind]: source.number,
      ...(links.from ? { [links.from.kind]: links.from.number } : {}),
    },
    target,
    generating: [],
  });

  const money = (amount: string) =>
    formatMoney(amount, { locale, currency: source.currency ?? "DZD" });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const cell: Partial<Record<(typeof rows)[number]["key"], [string, string]>> = {
    lines: [
      t("convert.value.nLines", { n: counts?.items ?? 0, total: money(totalExcl) }),
      t("convert.value.unchanged"),
    ],
    lots: [t("convert.value.nLots", { n: counts?.sections ?? 0 }), t("convert.value.unchanged")],
    options: [
      t("convert.value.nOptions", { n: counts?.options ?? 0 }),
      (counts?.options ?? 0) > 0 ? t("convert.value.optionsRemoved") : t("convert.value.none"),
    ],
    client: [source.clientName, t("convert.value.unchanged")],
    kind: [
      t.has(`documents.kind.${source.kind}`) ? t(`documents.kind.${source.kind}`) : source.kind,
      t.has(`documents.kind.${target}`) ? t(`documents.kind.${target}`) : target,
    ],
    number: [source.number ?? "—", preview ?? t("convert.value.seriesUnset")],
    date: [
      source.issuedOn ? day.format(new Date(`${source.issuedOn}T00:00:00Z`)) : "—",
      day.format(today),
    ],
    legalValue: [t("convert.value.noLegalValue"), t("convert.value.accountingDocument")],
    mentions: [
      t("convert.value.mentionsFrom"),
      blockers.length > 0
        ? t("convert.value.mentionsBlocked", { n: blockers.length })
        : t("convert.value.mentionsComplete", { n: passing.length, total: findings.length }),
    ],
    deliveryNote: ["—", t("convert.value.deliveryNoteLater")],
    deliveryDate: ["—", t("convert.value.toEnter")],
    paymentMethod: ["—", t("convert.value.confirm")],
  };

  const open = undecided(rows);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {t("convert.title", {
              number: source.number ?? "—",
              kind: t.has(`documents.kind.${target}`) ? t(`documents.kind.${target}`) : target,
            })}
          </h1>
          <p className="mt-1 text-tiny text-muted">{source.clientName}</p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Link href={`/documents/${id}`} className="text-tiny text-secondary hover:underline">
            {t("convert.cancel")}
          </Link>
        </div>
      </div>

      <div className="mx-4 mt-4 flex flex-wrap items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3 md:mx-7">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="min-w-0 flex-1 text-tiny leading-relaxed text-accent-ink">
          {t("convert.neverReplaced")}
        </p>
      </div>

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`convert.error.${error}`) ? t(`convert.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("convert.chain")}</h2>
              <span className="ms-auto text-micro text-muted">{t("convert.ownNumber")}</span>
            </div>
            <div className="flex flex-wrap gap-2 p-5">
              {chain.map((step) => (
                <div
                  key={step.step}
                  className={`min-w-[130px] rounded-[var(--radius-control)] border px-3 py-2 ${
                    step.state === "current"
                      ? "border-warning bg-warning-bg"
                      : step.state === "done"
                        ? "border-line bg-surface"
                        : "border-line-subtle bg-plane"
                  }`}
                >
                  <p className="text-micro font-medium text-ink">
                    {t(`convert.step.${step.step}`)}
                  </p>
                  <p className="mt-0.5 font-mono text-micro text-muted">
                    {step.number ??
                      (step.state === "current"
                        ? t("convert.toCreate")
                        : step.state === "planned"
                          ? t("convert.toGenerate")
                          : "—")}
                  </p>
                </div>
              ))}
            </div>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("convert.chainNote")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("convert.whatCarries")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("convert.nOpen", { n: open.length })}
              </span>
            </div>
            <table className="w-full border-collapse text-tiny">
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-line-subtle last:border-0">
                    <td className="w-[1%] py-2.5 ps-5 pe-3">
                      <Badge tone={CARRY_TONE[row.state]}>{t(`convert.state.${row.state}`)}</Badge>
                    </td>
                    <td className="py-2.5 pe-4 text-ink">{t(`convert.row.${row.key}`)}</td>
                    <td className="py-2.5 pe-4 text-muted">{cell[row.key]?.[0] ?? "—"}</td>
                    <td className="py-2.5 pe-5 text-secondary">{cell[row.key]?.[1] ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("convert.decisions")}</h2>
            <form
              action={convertAction.bind(null, locale, id)}
              className="mt-3 flex flex-col gap-3"
            >
              <input type="hidden" name="target" value={target} />
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="text-micro text-secondary">{t("convert.invoiceDate")}</span>
                  <input
                    type="date"
                    name="invoiceDate"
                    defaultValue={invoiceDate}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("convert.dueDate")}</span>
                  <input
                    type="date"
                    name="dueDate"
                    defaultValue={dueDate}
                    className={`${INPUT} mt-1`}
                  />
                </label>
              </div>
              <label>
                <span className="text-micro text-secondary">{t("convert.paymentMethod")}</span>
                <input
                  name="paymentMethod"
                  defaultValue={t("convert.termsDefault", { n: DEFAULT_TERMS_DAYS })}
                  className={`${INPUT} mt-1`}
                />
              </label>
              {/*
                The frame promises "If the client settles in cash, stamp duty is
                added automatically." Nobody has confirmed the threshold or the
                rate, so nothing is added automatically and the screen says so
                rather than quietly computing a figure on a rule it was never
                given. Screen 19 carries the same sentence.
              */}
              <p className="text-micro leading-relaxed text-muted">{t("convert.stampDutyNote")}</p>

              <div className="flex items-center gap-3">
                <p className="text-micro text-muted">{t("convert.createsADraft")}</p>
                <div className="ms-auto">
                  <Button type="submit" variant="primary">
                    {t("convert.create")}
                  </Button>
                </div>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("convert.checks")}</h2>
              <span className="ms-auto text-micro text-muted">
                {blockers.length > 0
                  ? t("convert.nToFix", { n: blockers.length })
                  : t("convert.allClear")}
              </span>
            </div>
            <ul className="mt-3 flex flex-col gap-2 text-tiny">
              {findings.map((finding) => (
                <li key={finding.code} className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 text-secondary">
                    {t.has(`rules.${finding.code}`) ? t(`rules.${finding.code}`) : finding.code}
                  </span>
                  <Badge
                    tone={
                      finding.severity === "block"
                        ? "critical"
                        : finding.severity === "warn"
                          ? "warning"
                          : "good"
                    }
                  >
                    {t(`convert.severity.${finding.severity}`)}
                  </Badge>
                </li>
              ))}
              {findings.length === 0 ? (
                <li className="text-muted">{t("convert.noRules")}</li>
              ) : null}
            </ul>
            {blockers[0]?.fixRoute ? (
              <Link
                href={blockers[0].fixRoute}
                className="mt-3 inline-block text-micro text-accent-ink hover:underline"
              >
                {t("convert.fixIt")}
              </Link>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("convert.rules")}</h2>
              <span className="ms-auto text-micro text-muted">{t("convert.sameForEveryone")}</span>
            </div>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Rule label={t("convert.rule.kept")}>
                <Badge tone="good">{t("convert.rule.always")}</Badge>
              </Rule>
              <Rule label={t("convert.rule.numberReuse")}>
                <Badge tone="good">{t("convert.rule.never")}</Badge>
              </Rule>
              <Rule label={t("convert.rule.newSeries")}>
                <span className="font-mono text-micro text-ink">
                  {preview ?? t("convert.value.seriesUnset")}
                </span>
              </Rule>
              <Rule label={t("convert.rule.numberWhen")}>
                {/* Not here. At issue, inside the transaction that reserves it. */}
                <Badge tone="accent">{t("convert.rule.atIssue")}</Badge>
              </Rule>
              <Rule label={t("convert.rule.editable")}>
                <Badge tone="warning">{t("convert.rule.creditNoteOnly")}</Badge>
              </Rule>
              <Rule label={t("convert.rule.allowed")}>
                <span className="text-secondary">
                  {CHAIN.filter((step) => targetsFor(step).includes(target))
                    .map((step) => t(`convert.step.${step}`))
                    .join(", ")}
                </span>
              </Rule>
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}

function Rule({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="min-w-0 text-secondary">{label}</dt>
      <dd className="ms-auto shrink-0">{children}</dd>
    </div>
  );
}
