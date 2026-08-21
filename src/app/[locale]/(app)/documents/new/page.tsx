import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { setupState } from "@/domain/setup";
import { Link } from "@/i18n/navigation";
import { createDraftInvoice } from "./actions";
import { type ClientOption, InvoiceForm } from "./invoice-form";

/**
 * Screen 72 — New invoice, by the one route that has data behind it today.
 *
 * The screen the design draws starts from an order and carries twelve fields
 * over from it: "most of this is already known · check it rather than type it".
 * Orders arrive in phase 5. Until they do, this is the fourth chip on that
 * screen — "Nothing — enter it myself" — and the other three say why they are
 * grey rather than pretending to work.
 */
export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
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

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const allowed = mayIssue(session.role, "invoice");
  const setup = await setupState();

  const rows = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      docLocale: party.docLocale,
      nif: party.nif,
    })
    .from(party)
    .where(liveParty)
    .orderBy(party.legalName);

  const clients: ClientOption[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    legalName: r.legalName,
    docLocale: r.docLocale,
    hasNif: Boolean(r.nif),
  }));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("newInvoice.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("newInvoice.subtitle")}</p>
        </div>
      </div>

      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`newInvoice.error.${error}`) ? t(`newInvoice.error.${error}`) : error}
        </p>
      ) : null}

      {/* Day one does not stop you drafting. It stops you issuing — and saying so
          here is kinder than letting somebody type an invoice and find out at the
          last step. */}
      {setup.canIssue ? null : (
        <div className="mx-7 mt-4 flex items-center gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
          <p className="text-tiny leading-relaxed text-warning-ink">
            {t("newInvoice.setupWarning", {
              missing: setup.missing.map((m) => t(`setup.step.${m}`)).join(", "),
            })}
          </p>
          <Link className="ms-auto shrink-0" href="/setup">
            <Button variant="secondary" size="small">
              {t("newInvoice.goToSetup")}
            </Button>
          </Link>
        </div>
      )}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        {!allowed ? (
          <section className="col-span-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="text-tiny text-ink">{t("newInvoice.error.notAllowed")}</p>
          </section>
        ) : clients.length === 0 ? (
          <section className="col-span-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <p className="text-tiny text-ink">{t("newInvoice.noClientsYet")}</p>
            <Link className="mt-3 inline-block" href="/companies/new">
              <Button variant="primary" size="small">
                {t("newInvoice.addCompany")}
              </Button>
            </Link>
          </section>
        ) : (
          <>
            <InvoiceForm
              clients={clients}
              today={new Date().toISOString().slice(0, 10)}
              action={createDraftInvoice.bind(null, locale)}
            />

            <aside className="flex flex-col gap-5">
              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.whenYouSave")}</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {(["draft", "number", "preview", "issue"] as const).map((key) => (
                    <li key={key} className="text-micro leading-relaxed text-secondary">
                      {t(`newInvoice.saveStep.${key}`)}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.notHereYet")}</h2>
                <p className="mt-2 text-micro leading-relaxed text-muted">
                  {t("newInvoice.notHereYetBody")}
                </p>
              </section>
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
