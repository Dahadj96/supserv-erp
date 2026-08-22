import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Field, INPUT } from "@/app/[locale]/(app)/setup/field";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { listTypes } from "@/domain/document-types";
import { setupState } from "@/domain/setup";
import { Link } from "@/i18n/navigation";
import { createDraft } from "./actions";

/**
 * Screen 72 — New document.
 *
 * The design starts this from an order and carries twelve fields across from
 * it: "most of this is already known · check it rather than type it". Orders
 * arrive in phase 5, so this is that screen's fourth chip — "Nothing, enter it
 * myself" — and the other three say why they are grey rather than pretending.
 *
 * It asks three things and stops: what kind, for whom, and what date. The lines
 * belong to the builder, which is the only place that writes them.
 */
export const dynamic = "force-dynamic";

export default async function NewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; kind?: string }>;
}) {
  const { locale } = await params;
  const { error, kind } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const setup = await setupState();
  const types = await listTypes();

  // Kinds this person may actually issue. A catalogue nobody has written down
  // leaves only the invoice, which is the one the permission map has always
  // known about — so the screen works before screen 50 is ever opened.
  const offered = (types.length > 0 ? types.filter((type) => type.active) : [{ kind: "invoice" }])
    .map((type) => type.kind)
    .filter((k) => mayIssue(session.role, k));

  const clients = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      docLocale: party.docLocale,
    })
    .from(party)
    .where(liveParty)
    .orderBy(party.legalName);

  const kindName = (k: string) => (t.has(`docTypes.kind.${k}`) ? t(`docTypes.kind.${k}`) : k);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("newDoc.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("newDoc.subtitle")}</p>
      </div>

      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`newDoc.error.${error}`) ? t(`newDoc.error.${error}`) : error}
        </p>
      ) : null}

      {setup.canIssue ? null : (
        <div className="mx-7 mt-4 flex items-center gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
          <p className="text-tiny leading-relaxed text-warning-ink">
            {t("newDoc.setupWarning", {
              missing: setup.missing.map((m) => t(`setup.step.${m}`)).join(", "),
            })}
          </p>
          <Link className="ms-auto shrink-0" href="/setup">
            <Button variant="secondary" size="small">
              {t("newDoc.goToSetup")}
            </Button>
          </Link>
        </div>
      )}

      <div className="grid max-w-[1100px] grid-cols-3 items-start gap-5 px-7 py-6">
        {offered.length === 0 ? (
          <section className="col-span-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="text-tiny text-ink">{t("newDoc.error.notAllowed")}</p>
          </section>
        ) : clients.length === 0 ? (
          <section className="col-span-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="text-tiny text-ink">{t("newDoc.noClientsYet")}</p>
            <Link className="mt-3 inline-block" href="/companies/new">
              <Button variant="primary" size="small">
                {t("newDoc.addCompany")}
              </Button>
            </Link>
          </section>
        ) : (
          <>
            <form
              action={createDraft.bind(null, locale)}
              className="col-span-2 flex flex-col gap-5"
            >
              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-tiny font-semibold text-ink">{t("newDoc.whatKind")}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {offered.map((k, index) => (
                    <label key={k} className="cursor-pointer">
                      <input
                        type="radio"
                        name="kind"
                        value={k}
                        defaultChecked={kind ? kind === k : index === 0}
                        className="peer sr-only"
                      />
                      <span className="inline-flex rounded-[var(--radius-pill)] bg-chip px-2.5 py-1 text-micro font-medium text-secondary peer-checked:bg-ink peer-checked:text-on-ink">
                        {kindName(k)}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2.5 text-micro leading-relaxed text-muted">
                  {t("newDoc.kindHint")}
                </p>
              </section>

              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <div className="grid grid-cols-2 gap-4">
                  <Field htmlFor="partyId" label={t("newDoc.counterparty")} required>
                    <select id="partyId" name="partyId" required className={INPUT}>
                      <option value="">{t("newDoc.pickCounterparty")}</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.legalName} ({c.docLocale.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field htmlFor="issuedOn" label={t("newDoc.date")} hint={t("newDoc.dateHint")}>
                    <input
                      id="issuedOn"
                      name="issuedOn"
                      type="date"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className={INPUT}
                    />
                  </Field>
                </div>
                <p className="mt-3 text-micro leading-relaxed text-muted">
                  {t("newDoc.languageFromClient")}
                </p>
              </section>

              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary">
                  {t("newDoc.create")}
                </Button>
                <p className="text-micro text-muted">{t("newDoc.thenLines")}</p>
              </div>
            </form>

            <aside className="flex flex-col gap-5">
              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-tiny font-semibold text-ink">{t("newDoc.startFrom")}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-[var(--radius-pill)] bg-ink px-2.5 py-1 text-micro font-medium text-on-ink">
                    {t("newDoc.start.myself")}
                  </span>
                  {(["order", "offer", "situation"] as const).map((key) => (
                    <span
                      key={key}
                      title={t("newDoc.start.laterReason")}
                      className="cursor-not-allowed rounded-[var(--radius-pill)] bg-inactive px-2.5 py-1 text-micro font-medium text-disabled"
                    >
                      {t(`newDoc.start.${key}`)}
                    </span>
                  ))}
                </div>
                <p className="mt-2.5 text-micro leading-relaxed text-muted">
                  {t("newDoc.start.laterReason")}
                </p>
              </section>

              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-tiny font-semibold text-ink">{t("newDoc.whenYouSave")}</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {(["draft", "number", "lines", "issue"] as const).map((key) => (
                    <li key={key} className="text-micro leading-relaxed text-secondary">
                      {t(`newDoc.saveStep.${key}`)}
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
