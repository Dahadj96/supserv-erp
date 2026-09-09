import { desc } from "drizzle-orm";
import { Info } from "lucide-react";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { intakeDossier } from "@/db/schema/dossier";
import { Link } from "@/i18n/navigation";
import { uploadDossier } from "./[id]/review/actions";

/**
 * Screen 39 — Dossier intake.
 *
 * A PDF goes in, its text comes out, and fields are proposed against the pages
 * they came from. Nothing is decided here: reading a document is not the same
 * as believing it, and screen 40 is where the second thing happens.
 */
export const dynamic = "force-dynamic";

export default async function DossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();
  const format = await getFormatter();

  const recent = await db
    .select()
    .from(intakeDossier)
    .orderBy(desc(intakeDossier.createdAt))
    .limit(20);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("dossier.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("dossier.subtitle")}</p>
      </div>

      <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <div className="max-w-[860px]">
          <p className="text-tiny leading-relaxed text-accent-ink">{t("dossier.textLayerFirst")}</p>
          {/* What "page 3" means depends on what was read, and a citation is
              only worth something if the reader knows what it points at. */}
          <p className="mt-1.5 text-micro leading-relaxed text-accent-ink">
            {t("dossier.sheetsNotPages")}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t(`dossier.error.${error}`)}
        </p>
      ) : null}

      <div className="max-w-[1000px] px-4 md:px-7 py-6">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("dossier.readOne")}</h2>
          <form action={uploadDossier.bind(null, locale)} className="mt-3 flex items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-micro font-medium text-secondary">{t("dossier.file")}</span>
              <input
                type="file"
                name="file"
                /* The three kinds `ingestDocument` can read. A file picker's
                   filter is a convenience and not a guard — the action refuses
                   anything else by name, whatever the browser let through. */
                accept=".pdf,.docx,.xlsx,.xlsm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
                className="text-tiny file:me-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-2.5 file:py-1.5 file:text-tiny"
              />
            </label>
            <Button type="submit" variant="primary">
              {t("dossier.read")}
            </Button>
          </form>
        </section>

        {recent.length > 0 ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("dossier.recent")}</h2>
            <table className="mt-3 w-full border-collapse text-tiny">
              <tbody>
                {recent.map((d) => (
                  <tr key={d.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-ink">{d.filename}</td>
                    <td className="py-2 text-secondary">{t("dossier.nPages", { n: d.pages })}</td>
                    <td className="py-2">
                      {((d.unreadPages as number[]) ?? []).length > 0 ? (
                        <Badge tone="warning">{t("review.partiallyRead")}</Badge>
                      ) : (
                        <Badge tone="good">{t("review.textLayer")}</Badge>
                      )}
                    </td>
                    <td className="py-2 text-secondary">
                      {format.dateTime(d.createdAt, { day: "2-digit", month: "short" })}
                    </td>
                    <td className="py-2 text-end">
                      <Link href={`/inbox/dossier/${d.id}/review`}>
                        <Button variant="secondary" size="small">
                          {t("dossier.review")}
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </main>
  );
}
