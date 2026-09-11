import { Check, FileWarning } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lineToMatch, matchCandidates } from "@/domain/item-technical";
import { Link } from "@/i18n/navigation";
import { createItemFromLineAction, matchLineAction } from "./actions";

/**
 * V0b — the corridor.
 *
 * `deal_line.item_id` has existed since phase 4, its comment says "set when a
 * person matches this line to the catalogue", and **nothing ever set it**:
 * three writes in the codebase and all three write null. So the catalogue could
 * only be populated by a seed script, every article read "0 enquiries" for
 * ever, and V0's link from a line to that article's datasheets could never
 * appear on any line at all. The door was built; this is the way to it.
 *
 * LAW 2 the whole way. Candidates are proposed with the REASON each one is
 * proposed and a person picks. Nothing is auto-matched however exact the code
 * looks, because "P-01" meaning our article and "P-01" meaning the client's own
 * line numbering are the same string — and half the consultations in Adrar
 * number their lines that way.
 */
export const dynamic = "force-dynamic";

export default async function MatchLinePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; lineId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id, lineId } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const line = await lineToMatch(id, lineId);
  if (!line) notFound();

  const candidates = await matchCandidates(lineId);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <PageHeader
        crumb={[
          { label: "SUPSERV", href: "/today" },
          { label: t("nav.deals"), href: "/deals" },
          { label: line.dealRef, href: `/deals/${id}` },
          { label: t("dealItems.title"), href: `/deals/${id}/items` },
          { label: t("match.title") },
        ]}
        title={t("match.title")}
        state={t("match.state", { n: line.position, designation: line.designation })}
        actions={
          <Link href={`/deals/${id}/items`}>
            <Button variant="secondary">{t("match.back")}</Button>
          </Link>
        }
      />

      {error ? (
        <p className="mx-4 mt-4 max-w-[900px] rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`match.error.${error}`) ? t(`match.error.${error}`) : error}
        </p>
      ) : null}

      <div className="mx-4 my-6 flex max-w-[900px] flex-col gap-5 md:mx-7">
        {/* What the client actually wrote. The evidence the choice is made on. */}
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("match.whatTheyWrote")}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              [t("dealItems.column.reference"), line.reference || "—"],
              [t("dealItems.column.designation"), line.designation],
              [t("dealItems.column.qty"), `${Number(line.qty)} ${line.unit ?? ""}`.trim()],
            ].map(([k, v]) => (
              <div key={k} className={k === t("dealItems.column.designation") ? "col-span-2" : ""}>
                <dt className="text-micro text-muted">{k}</dt>
                <dd className="mt-0.5 text-tiny text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {line.matched ? (
          <section className="rounded-[var(--radius-card)] border border-good bg-good-bg p-5">
            <h2 className="text-tiny font-semibold text-good-ink">{t("match.alreadyMatched")}</h2>
            <p className="mt-1.5 text-tiny text-good-ink">
              <span className="font-mono">{line.matched.code}</span> · {line.matched.designation}
            </p>
            <div className="mt-3 flex gap-2">
              <Link href={`/items/${line.matched.id}/technical?deal=${id}`}>
                <Button variant="secondary" size="small">
                  {t("dealItems.technicalFile")}
                </Button>
              </Link>
              <form action={matchLineAction.bind(null, locale, id, lineId)}>
                <input type="hidden" name="itemId" value="" />
                <Button type="submit" variant="secondary" size="small">
                  {t("match.detach")}
                </Button>
              </form>
            </div>
          </section>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("match.candidates")}</h2>
            <span className="ms-auto text-micro text-muted">{t("match.nothingAuto")}</span>
          </div>

          {candidates.length === 0 ? (
            <p className="px-5 py-6 text-tiny text-muted">{t("match.noCandidates")}</p>
          ) : (
            <ul>
              {candidates.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
                >
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-micro text-secondary">{c.code}</span>
                      {c.hasDatasheet ? (
                        <Badge tone="good">{t("match.hasDatasheet")}</Badge>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-micro text-muted"
                          title={t("match.noDatasheetHelp")}
                        >
                          <FileWarning className="size-3.5" aria-hidden />
                          {t("items.noDatasheet")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-tiny text-ink">{c.designation}</div>
                    {/* WHY it is being offered. A candidate with no stated
                        reason is a guess wearing a list's clothes. */}
                    <div className="mt-0.5 text-micro text-muted">
                      {t(`match.way.${c.way}`, { via: c.via ?? "" })}
                    </div>
                  </div>
                  <form action={matchLineAction.bind(null, locale, id, lineId)}>
                    <input type="hidden" name="itemId" value={c.id} />
                    <input type="hidden" name="way" value={c.way} />
                    <Button
                      type="submit"
                      variant="primary"
                      size="small"
                      icon={<Check className="size-4" aria-hidden />}
                    >
                      {t("match.thisIsIt")}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The other answer, and the one that fills an empty catalogue. */}
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("match.newArticle")}</h2>
          <p className="mt-1.5 max-w-[620px] text-micro leading-relaxed text-secondary">
            {t("match.newArticleHelp")}
          </p>
          <form
            action={createItemFromLineAction.bind(null, locale, id, lineId)}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <label>
              <span className="text-micro text-secondary">{t("match.kind")}</span>
              <select name="kind" defaultValue="good" className={`${INPUT} mt-1 w-[160px]`}>
                <option value="good">{t("match.kindGood")}</option>
                <option value="service">{t("match.kindService")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-tiny">
              <input type="checkbox" name="isGeneric" className="size-4" />
              <span title={t("items.genericHelp")}>{t("match.isGeneric")}</span>
            </label>
            <Button type="submit" variant="secondary">
              {t("match.createIt")}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
