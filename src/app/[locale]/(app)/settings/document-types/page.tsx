import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FAMILIES, listTypes, SEED_TYPES, type TypeRow } from "@/domain/document-types";
import { Link } from "@/i18n/navigation";
import { seedTypesAction, toggleTypeAction } from "./actions";

/**
 * Screen 50 — Document types and numbering.
 *
 * "These are the document types used across the Algerian market, not one
 * client's way of working. A client that wants something different gets a
 * template, never a new structure."
 *
 * Two departures from the frame, both deliberate:
 *
 *   · It is grouped by family. The subtitle on the mockup says "4 families" and
 *     then draws one flat table of nineteen rows; eighteen rows of paperwork
 *     with no seam in them is a list nobody reads twice.
 *   · The series pattern is shown but not edited here. `numbering_series` owns
 *     it, day one sets it, and a second field writing the same value is a
 *     second answer to what the next invoice number will be.
 */
export const dynamic = "force-dynamic";

const LEGAL_TONE: Record<string, BadgeTone> = {
  accounting: "critical",
  contractual: "critical",
  commitment: "accent",
  proof: "accent",
  evidence: "accent",
  information: "neutral",
  internal: "neutral",
  declaration: "neutral",
  correspondence: "neutral",
  none: "neutral",
};

export default async function DocumentTypesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ written?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { written, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);
  const mayEdit = Boolean(session.role && can(session.role, "settings.company"));

  const types = await listTypes();
  const suggested = new Map(SEED_TYPES.map((s) => [s.kind, s.pattern]));
  const byFamily = FAMILIES.map((family) => ({
    family,
    rows: types.filter((r) => r.family === family),
  })).filter((group) => group.rows.length > 0);

  const withSeries = types.filter((r) => r.pattern).length;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("docTypes.title")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("docTypes.subtitle", { types: types.length, families: byFamily.length })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/setup/numbering">
            <Button variant="secondary">{t("docTypes.setUpSeries")}</Button>
          </Link>
        </div>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("docTypes.banner")}
        </p>
      </div>

      {written ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("docTypes.written", { count: Number(written) })}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`docTypes.error.${error}`) ? t(`docTypes.error.${error}`) : error}
        </p>
      ) : null}

      {types.length === 0 ? (
        <div className="mx-4 md:mx-7 mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <p className="max-w-[720px] text-tiny leading-relaxed text-ink">{t("docTypes.empty")}</p>
          {mayEdit ? (
            <form action={seedTypesAction.bind(null, locale)} className="mt-3">
              <Button type="submit" variant="primary" size="small">
                {t("docTypes.writeThemDown")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="flex max-w-[1400px] flex-col gap-5 px-4 md:px-7 py-6">
          <p className="text-micro text-muted">
            {t("docTypes.seriesCount", { with: withSeries, total: types.length })}
          </p>

          {byFamily.map((group) => (
            <section
              key={group.family}
              className="rounded-[var(--radius-card)] border border-line bg-surface"
            >
              <h2 className="border-b border-line-subtle px-5 py-3.5 text-tiny font-semibold text-ink">
                {t(`docTypes.family.${group.family}`)}
              </h2>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="border-b border-line-subtle text-micro text-muted">
                      <th className="py-2.5 ps-5 text-start font-medium">
                        {t("docTypes.col.document")}
                      </th>
                      <th className="w-[190px] py-2.5 pe-4 text-start font-medium">
                        {t("docTypes.col.series")}
                      </th>
                      <th className="w-[150px] py-2.5 pe-4 text-start font-medium">
                        {t("docTypes.col.legal")}
                      </th>
                      <th className="w-[150px] py-2.5 pe-4 text-start font-medium">
                        {t("docTypes.col.numbering")}
                      </th>
                      <th className="py-2.5 pe-4 text-start font-medium">
                        {t("docTypes.col.becomes")}
                      </th>
                      <th className="w-[110px] py-2.5 pe-4 text-start font-medium">
                        {t("docTypes.col.languages")}
                      </th>
                      <th className="w-[120px] py-2.5 pe-5 text-start font-medium">
                        {t("docTypes.col.active")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <Row
                        key={row.kind}
                        row={row}
                        suggested={suggested.get(row.kind) ?? null}
                        locale={locale}
                        mayEdit={mayEdit}
                        t={t}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("docTypes.neverChange")}</h2>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(
                [
                  "reservedOnIssue",
                  "neverReused",
                  "neverEdited",
                  "proformaNeverPaid",
                  "resets",
                ] as const
              ).map((key) => (
                <li key={key} className="text-micro leading-relaxed text-secondary">
                  <span className="font-medium text-ink">{t(`docTypes.never.${key}.what`)}</span>
                  {" — "}
                  {t(`docTypes.never.${key}.detail`)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

function Row({
  row,
  suggested,
  locale,
  mayEdit,
  t,
}: {
  row: TypeRow;
  suggested: string | null;
  locale: string;
  mayEdit: boolean;
  t: T;
}) {
  const name = (kind: string) =>
    t.has(`docTypes.kind.${kind}`) ? t(`docTypes.kind.${kind}`) : kind;

  return (
    <tr className={`border-b border-line-subtle last:border-0 ${row.active ? "" : "opacity-60"}`}>
      <td className="py-2.5 ps-5 text-ink">{name(row.kind)}</td>

      <td className="py-2.5 pe-4">
        {row.numbering === "clientReference" ? (
          <span className="text-micro text-muted">{t("docTypes.theirNumber")}</span>
        ) : row.pattern ? (
          <span className="font-mono text-micro text-ink">{row.pattern}</span>
        ) : (
          <span className="text-micro text-muted">
            {suggested ? t("docTypes.suggested", { pattern: suggested }) : "—"}
          </span>
        )}
        {row.nextValue !== null ? (
          <span className="ms-2 text-micro text-muted">
            {t("docTypes.next", { value: row.nextValue })}
          </span>
        ) : null}
      </td>

      <td className="py-2.5 pe-4">
        <Badge tone={LEGAL_TONE[row.legalValue] ?? "neutral"}>
          {t(`docTypes.legal.${row.legalValue}`)}
        </Badge>
      </td>

      <td className="py-2.5 pe-4 text-micro text-secondary">
        {t(`docTypes.numbering.${row.numbering}`)}
      </td>

      <td className="py-2.5 pe-4 text-micro text-secondary">
        {row.convertsTo.length === 0 ? "—" : row.convertsTo.map(name).join(", ")}
      </td>

      <td className="py-2.5 pe-4 text-micro uppercase text-muted">{row.languages.join(" · ")}</td>

      <td className="py-2.5 pe-5">
        {mayEdit ? (
          <form action={toggleTypeAction.bind(null, locale)}>
            <input type="hidden" name="kind" value={row.kind} />
            <input type="hidden" name="active" value={String(!row.active)} />
            <button
              type="submit"
              className={`rounded-[var(--radius-pill)] px-2 py-0.5 text-micro font-semibold ${
                row.active
                  ? "bg-good-bg text-good-ink hover:brightness-95"
                  : "bg-chip text-secondary hover:bg-sunken"
              }`}
            >
              {row.active ? t("docTypes.on") : t("docTypes.off")}
            </button>
          </form>
        ) : (
          <Badge tone={row.active ? "good" : "neutral"}>
            {row.active ? t("docTypes.on") : t("docTypes.off")}
          </Badge>
        )}
      </td>
    </tr>
  );
}
