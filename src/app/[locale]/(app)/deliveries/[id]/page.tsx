import { eq, sql } from "drizzle-orm";
import { Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { peekNumber } from "@/documents/numbering";
import { type LineState, progress, unlocks } from "@/domain/delivery/lines";
import {
  deliveredAgainst,
  deliveryLines,
  detailFor,
  sourceLines,
  sourceOf,
} from "@/domain/delivery/store";
import { Link } from "@/i18n/navigation";
import { saveDetailAction, signAction } from "../actions";

/**
 * Screen 49 — the bon de livraison builder.
 *
 * "A delivery note can be issued without an invoice, and one invoice can cover
 * several delivery notes. The link is kept both ways."
 *
 * The BL is a document like any other: same engine, same numbering series, same
 * PDF. Issuing it happens on screen 18, which is why there is no issue button
 * here — there is one place a number is reserved and this is not it.
 */
export const dynamic = "force-dynamic";

const STATE_TONE: Record<LineState, BadgeTone> = {
  complete: "good",
  completes: "good",
  partial: "warning",
  planned: "accent",
  open: "neutral",
  over: "critical",
};

export default async function DeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; signed?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { saved, signed, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [bl] = await db
    .select({
      id: document.id,
      number: document.number,
      status: document.status,
      issuedOn: document.issuedOn,
      locale: document.locale,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(eq(document.id, id))
    .limit(1);
  if (!bl) notFound();

  const [source] = await sourceOf(id);
  const sources = source ? await sourceLines(source.id) : [];
  const delivered = await deliveredAgainst(sources.map((line) => line.lineId));
  const current = await deliveryLines(id);
  const detail = await detailFor(id);

  // What this BL carries is excluded from "already delivered" whether or not it
  // has been issued — otherwise an issued BL would count its own quantities
  // twice, once in each column.
  const others = bl.number
    ? delivered.filter((line) => !current.some((c) => c.sourceLineId === line.sourceLineId))
    : delivered;

  const p = progress({ sources, delivered: others, current });
  const anythingDelivered = delivered.some((line) => line.issued);
  const u = unlocks({
    progress: p,
    signedCopyOnFile: detail?.signedCopyOnFile ?? null,
    anythingDelivered,
  });

  const preview = await peekNumber("delivery_note", new Date());
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const isDraft = bl.number === null;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">
            {bl.number ?? t("deliveries.draft")}
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {bl.clientName}
            {source?.number ? ` · ${t("deliveries.fromSource", { number: source.number })}` : ""}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {/* One engine, one place a number is reserved. Screen 18. */}
          <Link href={`/documents/${id}`}>
            <Button variant="primary">
              {isDraft ? t("deliveries.readAndIssue") : t("deliveries.openDocument")}
            </Button>
          </Link>
        </div>
      </div>

      <div className="mx-4 mt-4 flex flex-wrap items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3 md:mx-7">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="min-w-0 flex-1 text-tiny leading-relaxed text-accent-ink">
          {t("deliveries.bothWays")}
        </p>
      </div>

      {[saved ? "saved" : null, signed ? "signed" : null].filter(Boolean).map((key) => (
        <p
          key={key}
          className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7"
        >
          {t(`deliveries.${key}`)}
        </p>
      ))}
      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`deliveries.error.${error}`) ? t(`deliveries.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 pb-8 md:grid-cols-3 md:px-7">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("deliveries.linesToDeliver")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("deliveries.remainderFollows")}
              </span>
            </div>

            {sources.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("deliveries.noSource")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">#</th>
                      <th className="py-2 pe-4 text-start font-medium">
                        {t("deliveries.designation")}
                      </th>
                      <th className="py-2 pe-4 text-start font-medium">{t("deliveries.unit")}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t("deliveries.ordered")}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t("deliveries.already")}</th>
                      <th className="py-2 pe-4 text-end font-medium">
                        {t("deliveries.thisDelivery")}
                      </th>
                      <th className="py-2 pe-4 text-end font-medium">
                        {t("deliveries.remaining")}
                      </th>
                      <th className="py-2 pe-5 text-start font-medium">{t("deliveries.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((line) => (
                      <tr key={line.lineId} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-muted">{line.position}</td>
                        <td className="max-w-[260px] truncate py-2.5 pe-4 text-ink">
                          {line.designation ?? "—"}
                        </td>
                        <td className="py-2.5 pe-4 text-muted">{line.unit ?? "—"}</td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                          {line.ordered}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                          {line.alreadyDelivered}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums font-medium text-ink">
                          {line.thisDelivery}
                        </td>
                        <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                          {line.remaining}
                        </td>
                        <td className="py-2.5 pe-5">
                          <Badge tone={STATE_TONE[line.state]}>
                            {t(`deliveries.state.${line.state}`)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("deliveries.packing")}</h2>
              <span className="ms-auto text-micro text-muted">{t("deliveries.printedOnIt")}</span>
            </div>
            <form
              action={saveDetailAction.bind(null, locale, id)}
              className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3"
            >
              <Field label={t("deliveries.packages")} name="packages" value={detail?.packages} />
              <Field
                label={t("deliveries.grossWeight")}
                name="grossWeightKg"
                value={detail?.grossWeightKg}
              />
              <Field label={t("deliveries.volume")} name="volumeM3" value={detail?.volumeM3} />
              <Field label={t("deliveries.carrier")} name="carrier" value={detail?.carrier} />
              <Field label={t("deliveries.vehicle")} name="vehicle" value={detail?.vehicle} />
              <Field label={t("deliveries.driver")} name="driver" value={detail?.driver} />
              <div className="sm:col-span-2">
                <Field
                  label={t("deliveries.address")}
                  name="deliveryAddress"
                  value={detail?.deliveryAddress}
                />
              </div>
              <Field
                label={t("deliveries.siteContact")}
                name="siteContactName"
                value={detail?.siteContactName}
              />
              <div className="sm:col-span-3 flex items-center gap-3">
                <p className="text-micro text-muted">
                  {isDraft ? t("deliveries.editWhileDraft") : t("deliveries.issuedIsFrozen")}
                </p>
                <div className="ms-auto">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabledReason={isDraft ? undefined : t("deliveries.issuedIsFrozen")}
                  >
                    {t("deliveries.save")}
                  </Button>
                </div>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("deliveries.receipt")}</h2>
            </div>

            {detail?.signedCopyOnFile ? (
              <dl className="flex flex-col gap-2 p-5 text-tiny">
                <Row label={t("deliveries.receivedBy")}>
                  <span className="text-ink">{detail.receivedBy ?? "—"}</span>
                </Row>
                <Row label={t("deliveries.receivedOn")}>
                  <span className="text-ink">
                    {detail.receivedOn
                      ? day.format(new Date(`${detail.receivedOn}T00:00:00Z`))
                      : "—"}
                  </span>
                </Row>
                <Row label={t("deliveries.reserves")}>
                  {/* Verbatim. A tidied reserve is evidence of nothing. */}
                  <span className="text-ink">{detail.reserves ?? t("deliveries.noReserves")}</span>
                </Row>
                <Row label={t("deliveries.proof")}>
                  <Badge tone="good">{t("deliveries.onFile")}</Badge>
                </Row>
              </dl>
            ) : (
              <form
                action={signAction.bind(null, locale, id)}
                className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3"
              >
                <label>
                  <span className="text-micro text-secondary">{t("deliveries.receivedBy")}</span>
                  <input name="receivedBy" className={`${INPUT} mt-1`} />
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("deliveries.receivedOn")}</span>
                  <input type="date" name="receivedOn" className={`${INPUT} mt-1`} />
                </label>
                <label>
                  <span className="text-micro text-secondary">{t("deliveries.reserves")}</span>
                  <input name="reserves" className={`${INPUT} mt-1`} />
                </label>
                <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                  <p className="text-micro leading-relaxed text-muted">
                    {t("deliveries.signedOnce")}
                  </p>
                  <div className="ms-auto">
                    <Button
                      type="submit"
                      variant="secondary"
                      disabledReason={isDraft ? t("deliveries.notDispatchedYet") : undefined}
                    >
                      {t("deliveries.recordSigned")}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deliveries.document")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("deliveries.number")}>
                <span className="font-mono text-micro text-ink">
                  {bl.number ?? preview ?? t("deliveries.seriesUnset")}
                </span>
              </Row>
              <Row label={t("deliveries.numberReserved")}>
                {/* Same rule as screen 48. One place reserves a number. */}
                <Badge tone={bl.number ? "good" : "accent"}>
                  {bl.number ? t("deliveries.yes") : t("deliveries.atIssue")}
                </Badge>
              </Row>
              <Row label={t("deliveries.date")}>
                <span className="text-ink">
                  {bl.issuedOn ? day.format(new Date(`${bl.issuedOn}T00:00:00Z`)) : "—"}
                </span>
              </Row>
              <Row label={t("deliveries.language")}>
                <span className="text-ink">{bl.locale.toUpperCase()}</span>
              </Row>
              <Row label={t("deliveries.legalValue")}>
                <Badge tone="good">{t("deliveries.proofOfDelivery")}</Badge>
              </Row>
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deliveries.links")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("deliveries.covers")}>
                {source ? (
                  <Link
                    href={`/documents/${source.id}`}
                    className="font-mono text-micro text-accent-ink hover:underline"
                  >
                    {source.number ?? "—"}
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Row>
              <Row label={t("deliveries.progressLabel")}>
                <span className="text-ink">
                  {t("deliveries.nOfM", { n: p.linesComplete, m: p.linesTotal })}
                </span>
              </Row>
            </dl>
            <div className="mt-3 h-1.5 w-full rounded-full bg-plane">
              <div
                className="h-1.5 rounded-full bg-good"
                style={{ width: `${Math.min(100, Math.max(2, Number(p.pct)))}%` }}
              />
            </div>
            <p className="mt-1 text-micro text-muted">
              {t("deliveries.byQuantity", { pct: p.pct })}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deliveries.unlocks")}</h2>
            <dl className="mt-3 flex flex-col gap-2 text-tiny">
              <Row label={t("deliveries.invoiceDelivered")}>
                <Badge tone={u.invoiceDelivered ? "good" : "neutral"}>
                  {u.invoiceDelivered ? t("deliveries.allowed") : t("deliveries.nothingGoneYet")}
                </Badge>
              </Row>
              <Row label={t("deliveries.invoiceEverything")}>
                <Badge tone={u.invoiceEverything ? "good" : "warning"}>
                  {u.invoiceEverything
                    ? t("deliveries.allowed")
                    : t("deliveries.blockedNOpen", { n: u.linesOpen })}
                </Badge>
              </Row>
              <Row label={t("deliveries.signedProof")}>
                <Badge tone={u.proofMissing ? "warning" : "good"}>
                  {u.proofMissing ? t("deliveries.missing") : t("deliveries.beforeChasing")}
                </Badge>
              </Row>
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-secondary">
              {t("deliveries.whyItMatters")}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="min-w-0 text-secondary">{label}</dt>
      <dd className="ms-auto shrink-0">{children}</dd>
    </div>
  );
}

function Field({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value: string | number | null | undefined;
}) {
  return (
    <label className="block">
      <span className="text-micro text-secondary">{label}</span>
      <input name={name} defaultValue={value ?? ""} className={`${INPUT} mt-1`} />
    </label>
  );
}
