import { eq, sql } from "drizzle-orm";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { mayDeliverAgainst, progress } from "@/domain/delivery/lines";
import { coveredAgainst, sourceLines } from "@/domain/delivery/store";
import { Link } from "@/i18n/navigation";
import { startDeliveryAction } from "../actions";

/**
 * Screen 49, step one — how much of each line is going out this time.
 *
 * The quantity offered defaults to what is REMAINING, not to what was ordered.
 * Defaulting to the ordered quantity is how a second delivery note quietly
 * re-delivers everything the first one already took out, and the arithmetic
 * that catches it (`over`) only catches it afterwards.
 */
export const dynamic = "force-dynamic";

export default async function NewDeliveryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { source, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);
  if (!source) notFound();

  const [doc] = await db
    .select({
      id: document.id,
      number: document.number,
      kind: document.kind,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .where(eq(document.id, source))
    .limit(1);
  if (!doc) notFound();

  /*
    THE KIND IS ASKED HERE TOO, and it was asked nowhere.

    The button on screen 18 was the only gate: this page took whatever id was
    in the query string, so `?source=<a bon de livraison>` opened the form and
    `startDelivery` — which checked only that the source was issued — made a BL
    against a BL. The rule lives in one place now and all three ask it.

    A sentence rather than `notFound()`: the person got here from a link, and
    "this page does not exist" is not what happened.
  */
  if (!mayDeliverAgainst(doc.kind)) {
    return (
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-[720px] px-4 md:px-7 py-8">
          <h1 className="text-[19px] font-semibold text-ink">{t("deliveries.recordTitle")}</h1>
          <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-4 py-3 text-tiny leading-relaxed text-warning-ink">
            {t("deliveries.notDeliverable", {
              kind: t.has(`docTypes.kind.${doc.kind}`) ? t(`docTypes.kind.${doc.kind}`) : doc.kind,
            })}
          </p>
          <div className="mt-4">
            <Link href={`/documents/${doc.id}`}>
              <Button variant="secondary">{t("deliveries.openDocument")}</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const sources = await sourceLines(doc.id);
  const delivered = await coveredAgainst(sources.map((line) => line.lineId));
  const p = progress({ sources, delivered });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-ink">{t("deliveries.recordTitle")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {doc.clientName} · {doc.number ?? t("deliveries.draft")}
          </p>
        </div>
        <div className="ms-auto">
          <Link href={`/documents/${doc.id}`} className="text-tiny text-secondary hover:underline">
            {t("deliveries.cancel")}
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`deliveries.error.${error}`) ? t(`deliveries.error.${error}`) : error}
        </p>
      ) : null}

      <div className="max-w-[1000px] px-4 py-5 md:px-7">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("deliveries.linesToDeliver")}</h2>
            <span className="ms-auto text-micro text-muted">
              {t("deliveries.defaultsToRemaining")}
            </span>
          </div>

          <form action={startDeliveryAction.bind(null, locale, doc.id)}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">#</th>
                    <th className="py-2 pe-4 text-start font-medium">
                      {t("deliveries.designation")}
                    </th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deliveries.ordered")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deliveries.already")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deliveries.remaining")}</th>
                    <th className="py-2 pe-5 text-end font-medium">
                      {t("deliveries.thisDelivery")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map((line) => (
                    <tr key={line.lineId} className="border-t border-line-subtle">
                      <td className="py-2.5 ps-5 text-muted">{line.position}</td>
                      <td className="max-w-[280px] truncate py-2.5 pe-4 text-ink">
                        {line.designation ?? "—"}
                        {line.unit ? (
                          <span className="ms-1.5 text-micro text-muted">{line.unit}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                        {line.ordered}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-secondary">
                        {line.alreadyDelivered}
                      </td>
                      <td className="py-2.5 pe-4 text-end">
                        <Badge tone={Number(line.remaining) > 0 ? "warning" : "good"}>
                          {line.remaining}
                        </Badge>
                      </td>
                      <td className="py-2.5 pe-5 text-end">
                        <input
                          name={`qty:${line.lineId}`}
                          inputMode="decimal"
                          defaultValue={line.remaining}
                          className={`${INPUT} w-24 text-end tabular-nums`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-4 border-t border-line-subtle px-5 py-4">
              <label>
                <span className="text-micro text-secondary">{t("deliveries.date")}</span>
                <input
                  type="date"
                  name="deliverOn"
                  defaultValue={today}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <p className="min-w-0 flex-1 text-micro leading-relaxed text-muted">
                {t("deliveries.createsADraft")}
              </p>
              <Button type="submit" variant="primary">
                {t("deliveries.create")}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
