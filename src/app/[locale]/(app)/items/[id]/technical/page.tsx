import { FileWarning } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { itemTechnicalFile } from "@/domain/item-technical";
import { Link } from "@/i18n/navigation";

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
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const file = await itemTechnicalFile(id);
  if (!file) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-tiny text-muted">{file.item.code}</span>
          <h1 className="text-[19px] font-semibold text-ink">{file.item.designation}</h1>
          {file.hasDatasheet ? null : (
            <Badge tone="warning">{t("itemTechnical.noDatasheet")}</Badge>
          )}
        </div>
        <p className="mt-1 text-tiny text-muted">
          {[file.item.brand, file.item.model].filter(Boolean).join(" · ") ||
            t("itemTechnical.noBrand")}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
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
                    <th className="px-5 py-2 text-start font-medium text-muted">
                      {t("itemTechnical.column.where")}
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
                      <td className="px-5 py-2.5 text-micro text-muted">
                        {row.capturedAtPlace ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
