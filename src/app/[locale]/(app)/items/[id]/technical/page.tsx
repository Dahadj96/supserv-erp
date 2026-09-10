import { FileWarning } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { itemTechnicalFile, MEDIA_KINDS, PROVENANCES } from "@/domain/item-technical";
import { Link } from "@/i18n/navigation";
import { addMediaAction } from "./actions";

/**
 * Screen 77 — one item's technical file.
 *
 * Screen 78 asks "is THIS enquiry's annexe complete". This asks the other half:
 * what do we hold on this item at all, and where did each piece come from.
 *
 * Both were in the design; only the per-deal one shipped in phase 4, which
 * meant a datasheet gathered for one tender was invisible to the next and got
 * asked for twice.
 *
 * Provenance is on every row rather than inferred. "The supplier sent it" and
 * "we photographed it on a counter in Adrar" are different kinds of evidence,
 * and a client asking where a certificate came from deserves the real answer.
 */
export const dynamic = "force-dynamic";

export default async function ItemTechnicalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ recorded?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { recorded, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const file = await itemTechnicalFile(id);
  if (!file) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-tiny text-muted">{file.item.code}</span>
          <h1 className="text-title font-semibold text-ink">{file.item.designation}</h1>
          {file.hasDatasheet ? null : (
            <Badge tone="warning">{t("itemTechnical.noDatasheet")}</Badge>
          )}
        </div>
        <p className="mt-1 text-tiny text-muted">
          {[file.item.brand, file.item.model].filter(Boolean).join(" · ") ||
            t("itemTechnical.noBrand")}
        </p>
      </div>

      {recorded ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("itemTechnical.recorded")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t(`itemTechnical.error.${error}`)}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("itemTechnical.held")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("itemTechnical.provenanceMatters")}
              </span>
            </div>

            {file.media.length === 0 ? (
              <div className="flex items-start gap-3 p-5">
                <FileWarning className="mt-px size-4 shrink-0 text-muted" aria-hidden />
                <p className="max-w-[620px] text-tiny leading-relaxed text-secondary">
                  {t("itemTechnical.nothingHeld")}
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane">
                    <th className="px-5 py-2 text-start font-medium text-muted">
                      {t("itemTechnical.column.kind")}
                    </th>
                    <th className="px-4 py-2 text-start font-medium text-muted">
                      {t("itemTechnical.column.provenance")}
                    </th>
                    <th className="px-4 py-2 text-start font-medium text-muted">
                      {t("itemTechnical.column.from")}
                    </th>
                    <th className="px-4 py-2 text-start font-medium text-muted">
                      {t("itemTechnical.column.where")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium text-muted">
                      {t("itemTechnical.column.file")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {file.media.map((row) => (
                    <tr key={row.id} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-2.5">
                        <Badge tone={row.mediaKind === "datasheet" ? "good" : "neutral"}>
                          {t.has(`technical.mediaKind.${row.mediaKind}`)
                            ? t(`technical.mediaKind.${row.mediaKind}`)
                            : row.mediaKind}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-secondary">
                        {t.has(`technical.provenance.${row.provenance}`)
                          ? t(`technical.provenance.${row.provenance}`)
                          : row.provenance}
                      </td>
                      <td className="px-4 py-2.5 text-secondary">{row.partyName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-micro text-muted">
                        {row.capturedAtPlace ?? "—"}
                      </td>
                      {/*
                        THE LINK THAT WAS NOT THERE. This table listed what the
                        company held and where it came from, and gave no way to
                        open any of it: the row pointed at a `file_id` in a
                        table that does not exist, and nothing ever wrote one.
                      */}
                      <td className="px-5 py-2.5">
                        <a
                          href={`/api/files/${encodeURIComponent(row.fileId)}`}
                          className="text-tiny text-accent-ink hover:underline"
                        >
                          {row.filename}
                        </a>
                        {row.sizeBytes ? (
                          <span className="ms-2 text-micro text-muted">
                            {Math.max(1, Math.round(row.sizeBytes / 1024))} kB
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/*
              AND THE WAY IN. `item_media` had no insert anywhere in the
              application: screen 78 said "no datasheet" about every item in the
              catalogue, for ever, and a tender asking for a fiche technique had
              nowhere to keep the answer.

              What the file IS and where it came from are asked, never guessed
              from the name or the content type. "This PDF is the manufacturer's
              certificate" is a claim, and a claim needs somebody behind it.
            */}
            <form
              action={addMediaAction.bind(null, locale, id)}
              encType="multipart/form-data"
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-line-subtle px-5 py-4"
            >
              <label className="sm:col-span-2">
                <span className="text-micro text-secondary">{t("itemTechnical.f.file")}</span>
                <input
                  type="file"
                  name="file"
                  required
                  className={`${INPUT} mt-1 file:me-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-chip file:px-2 file:py-1 file:text-micro`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("itemTechnical.column.kind")}</span>
                <select name="mediaKind" defaultValue="datasheet" className={`${INPUT} mt-1`}>
                  {MEDIA_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t.has(`technical.mediaKind.${kind}`)
                        ? t(`technical.mediaKind.${kind}`)
                        : kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-micro text-secondary">
                  {t("itemTechnical.column.provenance")}
                </span>
                <select name="provenance" defaultValue="manufacturer" className={`${INPUT} mt-1`}>
                  {PROVENANCES.map((one) => (
                    <option key={one} value={one}>
                      {t.has(`technical.provenance.${one}`)
                        ? t(`technical.provenance.${one}`)
                        : one}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="text-micro text-secondary">{t("itemTechnical.f.where")}</span>
                <input
                  name="capturedAtPlace"
                  placeholder={t("itemTechnical.f.wherePlaceholder")}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <p className="sm:col-span-2 text-micro leading-relaxed text-muted">
                {t("itemTechnical.f.why")}
              </p>
              <div className="sm:col-span-2 flex">
                <div className="ms-auto">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabledReason={canWrite(session.role) ? undefined : t("documents.notAllowed")}
                  >
                    {t("itemTechnical.f.add")}
                  </Button>
                </div>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("itemTechnical.usedOn")}</h2>
              <span className="ms-auto text-micro text-muted">{t("itemTechnical.usedOnWhy")}</span>
            </div>
            {file.usedOn.length === 0 ? (
              <p className="p-5 text-tiny text-muted">{t("itemTechnical.neverAsked")}</p>
            ) : (
              <ul>
                {file.usedOn.map((row) => (
                  <li
                    key={row.dealId}
                    className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <Link
                      href={`/deals/${row.dealId}/technical`}
                      className="text-tiny text-ink hover:underline"
                    >
                      {row.ref}
                    </Link>
                    <span className="truncate text-micro text-secondary">{row.subject}</span>
                    <span className="ms-auto shrink-0">
                      <Badge tone={row.status === "complete" ? "good" : "warning"}>
                        {t.has(`technical.state.${row.status}`)
                          ? t(`technical.state.${row.status}`)
                          : row.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("itemTechnical.item")}</h2>
            <dl className="mt-3">
              {(
                [
                  ["code", file.item.code],
                  ["kind", file.item.kind],
                  ["unit", file.item.unit ?? "—"],
                  ["brand", file.item.brand ?? "—"],
                  ["model", file.item.model ?? "—"],
                ] as const
              ).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-micro text-muted">{t(`itemTechnical.field.${key}`)}</dt>
                  <dd className="ms-auto text-tiny text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="text-micro leading-relaxed text-muted">{t("itemTechnical.gathering")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
