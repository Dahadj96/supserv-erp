import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Field, INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { WILAYA_LIST_ID, WilayaList } from "@/components/ui/wilaya-list";
import { getDeal } from "@/domain/deal/deal";
import { RETENTION_BASES } from "@/domain/money";
import { projectCandidates } from "@/domain/project/candidates";
import { contractCandidates } from "@/domain/project/situations";
import { projectForDeal } from "@/domain/project/store";
import { Link } from "@/i18n/navigation";
import { openProjectAction } from "../actions";

/**
 * Screen 15 — open the project.
 *
 * Most of it is already known — the client, the subject, their reference,
 * the order they sent — and is offered to be checked rather than typed. What
 * a person has to READ OFF THE MARCHÉ is the rest: the contract value, the
 * dates, and the retenue de garantie with what it is taken on. That last one
 * is the fact every situation's arithmetic hangs on, and nothing here guesses
 * it.
 */
export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ deal?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { deal: dealId, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  // Reached from the rail rather than from an enquiry: say which enquiries
  // a project could be opened on — the client has said yes and none exists.
  if (!dealId) {
    const candidates = await projectCandidates();
    return (
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
          <h1 className="text-[19px] font-semibold text-ink">{t("projectNew.title")}</h1>
          <p className="mt-1 max-w-[760px] text-tiny leading-relaxed text-muted">
            {t("projectNew.whichEnquiry")}
          </p>
        </div>
        <section className="mx-4 md:mx-7 my-6 max-w-[860px] rounded-[var(--radius-card)] border border-line bg-surface">
          {candidates.length === 0 ? (
            <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
              {t("projectNew.noCandidates")}
            </p>
          ) : (
            <ul>
              {candidates.map((c) => (
                <li
                  key={c.dealId}
                  className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/projects/new?deal=${c.dealId}`}
                      className="text-tiny font-medium text-ink hover:underline"
                    >
                      {c.ref} — {c.subject}
                    </Link>
                    <p className="text-micro text-muted">
                      {c.client} · {t(`documents.kind.${c.latestKind}`)} {c.latestNumber ?? ""}
                      {c.latestOn ? ` · ${c.latestOn}` : ""}
                    </p>
                  </div>
                  <Link href={`/projects/new?deal=${c.dealId}`} className="ms-auto shrink-0">
                    <Button variant="secondary" size="small">
                      {t("deals.project.open")}
                    </Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

  const found = await getDeal(dealId);
  if (!found) notFound();

  const already = await projectForDeal(dealId);
  if (already) hardRedirect(`/${locale}/projects/${already.id}`);

  const candidates = await contractCandidates(dealId);
  const preferred =
    candidates.find((c) => c.kind === "client_order") ??
    candidates.find((c) => c.kind === "quotation") ??
    candidates.find((c) => c.kind === "proforma");

  const { deal, clientName } = found;
  const allowed = can(session.role, "works.issue");
  const amount = (value: string) =>
    Number(value).toLocaleString(locale === "fr" ? "fr-DZ" : "en-GB", {
      maximumFractionDigits: 0,
    });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <p className="text-micro text-muted">
          <Link href={`/deals/${dealId}`} className="hover:underline">
            {deal.ref}
          </Link>{" "}
          · {clientName}
        </p>
        <h1 className="mt-0.5 text-[19px] font-semibold text-ink">{t("projectNew.title")}</h1>
        <p className="mt-1 max-w-[760px] text-tiny leading-relaxed text-muted">
          {t("projectNew.lead")}
        </p>
      </div>

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`projectNew.error.${error}`) ? t(`projectNew.error.${error}`) : error}
        </p>
      ) : null}

      <form
        action={openProjectAction.bind(null, locale)}
        className="max-w-[860px] px-4 md:px-7 py-6"
      >
        <input type="hidden" name="dealId" value={dealId} />
        <WilayaList />

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("projectNew.section.site")}</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field htmlFor="object" label={t("projectNew.f.object")} required>
                <input
                  id="object"
                  name="object"
                  required
                  defaultValue={deal.subject}
                  className={INPUT}
                />
              </Field>
            </div>
            <Field htmlFor="contractRef" label={t("projectNew.f.contractRef")}>
              <input
                id="contractRef"
                name="contractRef"
                defaultValue={deal.clientReference ?? ""}
                className={INPUT}
              />
            </Field>
            <Field
              htmlFor="wilaya"
              label={t("projectNew.f.wilaya")}
              hint={t("projectNew.f.wilayaHint")}
            >
              <input id="wilaya" name="wilaya" list={WILAYA_LIST_ID} className={INPUT} />
            </Field>
          </div>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("projectNew.section.contract")}</h2>
          <p className="mt-1 text-micro leading-relaxed text-muted">
            {t("projectNew.section.contractWhy")}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field
                htmlFor="contractDocumentId"
                label={t("projectNew.f.contract")}
                hint={candidates.length === 0 ? t("projectNew.f.contractNone") : undefined}
              >
                <select
                  id="contractDocumentId"
                  name="contractDocumentId"
                  defaultValue={preferred?.documentId ?? ""}
                  className={INPUT}
                >
                  <option value="">{t("projectNew.f.contractLater")}</option>
                  {candidates.map((c) => (
                    <option key={c.documentId} value={c.documentId}>
                      {t(`documents.kind.${c.kind}`)} {c.number ?? ""} · {c.issuedOn ?? ""} ·{" "}
                      {amount(c.totalExcl)} {deal.currency} HT
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field htmlFor="amountExcl" label={t("projectNew.f.amountExcl")}>
              <input
                id="amountExcl"
                name="amountExcl"
                inputMode="decimal"
                defaultValue={preferred?.totalExcl ?? deal.expectedValue ?? ""}
                className={`${INPUT} text-end tabular-nums`}
              />
            </Field>
            <div />
            <Field htmlFor="startedOn" label={t("projectNew.f.startedOn")}>
              <input id="startedOn" name="startedOn" type="date" className={INPUT} />
            </Field>
            <Field htmlFor="contractualEnd" label={t("projectNew.f.contractualEnd")}>
              <input id="contractualEnd" name="contractualEnd" type="date" className={INPUT} />
            </Field>
          </div>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("projectNew.section.retention")}</h2>
          <p className="mt-1 text-micro leading-relaxed text-muted">
            {t("projectNew.section.retentionWhy")}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field htmlFor="retentionPct" label={t("projectNew.f.retentionPct")}>
              <input
                id="retentionPct"
                name="retentionPct"
                inputMode="decimal"
                defaultValue="5"
                className={`${INPUT} text-end tabular-nums`}
              />
            </Field>
            <Field htmlFor="retentionBase" label={t("projectNew.f.retentionBase")}>
              <select id="retentionBase" name="retentionBase" defaultValue="" className={INPUT}>
                <option value="">{t("projectNew.retentionBase.unsaid")}</option>
                {RETENTION_BASES.map((base) => (
                  <option key={base} value={base}>
                    {t(`projectNew.retentionBase.${base}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="warrantyMonths" label={t("projectNew.f.warrantyMonths")}>
              <input
                id="warrantyMonths"
                name="warrantyMonths"
                inputMode="numeric"
                defaultValue="12"
                className={`${INPUT} text-end tabular-nums`}
              />
            </Field>
          </div>
        </section>

        <div className="mt-5 flex items-center gap-3">
          <p className="text-micro leading-relaxed text-muted">{t("projectNew.footnote")}</p>
          <div className="ms-auto flex items-center gap-2">
            <Link href={`/deals/${dealId}`}>
              <Button variant="secondary">{t("common.cancel")}</Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              disabledReason={allowed ? undefined : t("documents.notAllowed")}
            >
              {t("projectNew.go")}
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}
