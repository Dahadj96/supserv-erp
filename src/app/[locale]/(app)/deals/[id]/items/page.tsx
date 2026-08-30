import { CircleAlert, Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDeal } from "@/domain/deal/deal";
import { Link } from "@/i18n/navigation";
import { replaceLinesAction } from "./actions";

/**
 * Screen 73 — the item list builder.
 *
 * This was a real hole rather than route drift. Lines could be pasted when an
 * enquiry was CREATED (screen 06) and never again — so a quantity read wrong
 * from an email, or a line the client added in a second message, could not be
 * corrected without deleting the enquiry and starting over.
 *
 * REPLACE, not merge, and `replaceLines` explains why: the person is looking at
 * a table they have checked against the client's email, and merging would leave
 * rows from an earlier paste that are not on the screen they approved. The
 * first anyone would know is an offer with fifteen lines where the client asked
 * for fourteen.
 *
 * The current lines are shown in the box, in the format the parser reads, so
 * "edit one quantity" is editing one number rather than retyping the list.
 */
export const dynamic = "force-dynamic";

export default async function DealItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { saved, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const found = await getDeal(id);
  if (!found) notFound();

  const { deal: row, clientName, lines } = found;

  /**
   * The lines as text the parser will read back identically.
   *
   * Tab-separated, because that is the shape `readTabs` handles without
   * guessing — round-tripping through the format with the fewest assumptions
   * means editing one cell cannot silently re-interpret the other three.
   */
  const asText = lines
    .map((line) => [line.reference ?? "", line.designation, line.qty, line.unit ?? ""].join("\t"))
    .join("\n");

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <nav className="text-tiny text-muted">
          <Link href="/deals" className="hover:underline">
            {t("nav.deals")}
          </Link>
          <span className="px-2">/</span>
          <Link href={`/deals/${id}`} className="hover:underline">
            {row.ref}
          </Link>
        </nav>
        <h1 className="mt-1 text-[19px] font-semibold text-ink">{t("dealItems.title")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("dealItems.subtitle", { client: clientName ?? "—", count: lines.length })}
        </p>
      </div>

      {saved ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("dealItems.saved", { count: Number(saved) })}
        </p>
      ) : null}
      {error ? (
        <p className="mx-7 mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          {t.has(`dealItems.error.${error}`) ? t(`dealItems.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("dealItems.current")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("dealItems.lineCount", { count: lines.length })}
              </span>
            </div>

            {lines.length === 0 ? (
              <p className="p-5 text-tiny text-muted">{t("dealItems.noLines")}</p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane">
                    <th className="w-[40px] px-5 py-2 text-start font-medium text-muted">#</th>
                    <th className="px-4 py-2 text-start font-medium text-muted">
                      {t("dealItems.column.reference")}
                    </th>
                    <th className="px-4 py-2 text-start font-medium text-muted">
                      {t("dealItems.column.designation")}
                    </th>
                    <th className="px-4 py-2 text-end font-medium text-muted">
                      {t("dealItems.column.qty")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium text-muted">
                      {t("dealItems.column.unit")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-2 tabular-nums text-muted">{line.position}</td>
                      <td className="px-4 py-2 font-mono text-micro text-secondary">
                        {line.reference ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-ink">{line.designation}</td>
                      <td className="px-4 py-2 text-end tabular-nums text-secondary">{line.qty}</td>
                      <td className="px-5 py-2 text-secondary">{line.unit ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("dealItems.replace")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("dealItems.replaceNotMerge")}
              </span>
            </div>
            <form action={replaceLinesAction.bind(null, locale, id)} className="p-5">
              <label className="text-micro text-secondary" htmlFor="paste">
                {t("dealItems.pasteLabel")}
              </label>
              <textarea
                id="paste"
                name="paste"
                rows={12}
                defaultValue={asText}
                className={`${INPUT} mt-1 h-auto py-2 font-mono text-micro`}
              />
              <div className="mt-3 flex items-center gap-3">
                <Button type="submit" variant="primary" size="small">
                  {t("dealItems.save")}
                </Button>
                <Link href={`/deals/${id}`} className="text-tiny text-secondary hover:underline">
                  {t("common.cancel")}
                </Link>
              </div>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              <Info className="mt-px size-4 shrink-0 text-muted" aria-hidden />
              <p className="text-micro leading-relaxed text-secondary">
                {t("dealItems.howItReads")}
              </p>
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("dealItems.whatItAffects")}</h2>
            <p className="mt-3 text-micro leading-relaxed text-secondary">
              {t("dealItems.affects")}
            </p>
            {row.lostAt ? (
              <p className="mt-3">
                <Badge tone="critical">{t("dealItems.closed")}</Badge>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
