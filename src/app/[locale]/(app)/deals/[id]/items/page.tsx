import { CircleAlert, Info } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { getDeal } from "@/domain/deal/deal";
import { sourcesForDeal } from "@/domain/deal/sources";
import { Link } from "@/i18n/navigation";
import { saveLinesAction } from "./actions";
import { LinesEditor } from "./lines-editor";

/**
 * Screen 73 — what the client asked for.
 *
 * This is the first screen of a working day: an email arrives, it becomes an
 * enquiry, and the next question is what is on the list. It was also the first
 * thing that did not work. The list was one textarea of tab-separated text — no
 * way to correct a quantity without editing a monospace blob, no way to delete
 * a line except by deleting its text, and no help at all with the Excel file,
 * the PDF or the Word document the client actually attached, even though the
 * ERP had been reading all three into `intake_page` for weeks.
 *
 * Both halves are fixed here. `sources.ts` introduces the reader to the line
 * table; `lines-editor.tsx` makes the list a list.
 */
export const dynamic = "force-dynamic";

export default async function DealItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; removed?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { saved, removed, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const found = await getDeal(id);
  if (!found) notFound();

  const { deal: row, clientName, lines } = found;
  const sources = await sourcesForDeal(id);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 py-5 md:px-7">
        <nav className="text-tiny text-muted">
          <Link href="/deals" className="hover:underline">
            {t("nav.deals")}
          </Link>
          <span className="px-2">/</span>
          <Link href={`/deals/${id}`} className="hover:underline">
            {row.ref}
          </Link>
        </nav>
        <h1 className="mt-1 text-title font-semibold text-ink">{t("dealItems.title")}</h1>
        <p className="mt-1 text-tiny text-muted">
          {t("dealItems.subtitle", { client: clientName ?? "—", count: lines.length })}
        </p>
      </div>

      {saved ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          {t("dealItems.saved", { count: Number(saved), removed: Number(removed ?? 0) })}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
          {t.has(`dealItems.error.${error}`) ? t(`dealItems.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-6 md:px-7 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LinesEditor
            dealId={id}
            closed={row.lostAt !== null}
            sources={sources}
            action={saveLinesAction.bind(null, locale, id)}
            initial={lines.map((line) => ({
              id: line.id,
              reference: line.reference ?? "",
              designation: line.designation,
              // Postgres hands a numeric back as `12.000`. Trailing zeros are
              // the column's precision, not something the client wrote, and a
              // person looking at their own list should see the number they
              // typed.
              qty: String(Number(line.qty)),
              unit: line.unit ?? "",
              // V0 — set when a person matched the line to the catalogue.
              // Null is normal; the row then says the technical file needs a
              // match first rather than showing a link that goes nowhere.
              itemId: line.itemId ?? null,
            }))}
          />
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
