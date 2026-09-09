import { asc, eq, isNull } from "drizzle-orm";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { getSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party, partyRole } from "@/db/schema/party";
import { SUBMISSION_METHODS } from "@/domain/deal/deal";
import { Link } from "@/i18n/navigation";
import { createAction } from "./actions";

/**
 * Screen 06 — a new enquiry.
 *
 * The big box at the bottom is the point of the screen. Somebody has the
 * client's email open in another window; they select the list, paste it, and
 * fourteen lines of valve references stop being an afternoon of retyping.
 *
 * What it does NOT do is read the paste in the browser and show a preview
 * table. That would be a second implementation of `parsePaste` running where it
 * cannot be tested, and the two would disagree on the line that mattered. The
 * lines appear on the enquiry, where they can be checked against the email
 * side by side, and corrected there.
 */
export const dynamic = "force-dynamic";

export default async function NewEnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; client?: string }>;
}) {
  const { locale } = await params;
  const { error, client } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const clients = await db
    .selectDistinct({
      id: party.id,
      legalName: party.legalName,
      tradeName: party.tradeName,
      code: party.code,
    })
    .from(party)
    .leftJoin(partyRole, eq(partyRole.partyId, party.id))
    .where(isNull(party.deletedAt))
    .orderBy(asc(party.legalName));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("deals.newDeal")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("newDeal.subtitle")}</p>
      </div>

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`newDeal.error.${error}`) ? t(`newDeal.error.${error}`) : error}
        </p>
      ) : null}

      {clients.length === 0 ? (
        <div className="mx-4 mt-5 max-w-[640px] rounded-[var(--radius-card)] border border-line bg-surface p-5 md:mx-7">
          <h2 className="text-tiny font-semibold text-ink">{t("newDeal.noClientsTitle")}</h2>
          <p className="mt-1.5 text-tiny leading-relaxed text-secondary">
            {t("newDeal.noClientsBody")}
          </p>
          <Link className="mt-3 inline-block" href="/companies/new">
            <Button variant="primary">{t("newDeal.addCompany")}</Button>
          </Link>
        </div>
      ) : (
        <form
          action={createAction.bind(null, locale)}
          className="mx-4 mt-5 flex max-w-[840px] flex-col gap-4 md:mx-7"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label>
              <span className="text-micro text-secondary">{t("deals.client")}</span>
              <select name="partyId" defaultValue={client ?? ""} className={`${INPUT} mt-1`}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tradeName?.trim() || c.legalName} · {c.code}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-micro text-secondary">{t("deal.reference")}</span>
              <input name="clientReference" placeholder="25/DA/2026" className={`${INPUT} mt-1`} />
              <span className="mt-1 block text-micro text-muted">{t("newDeal.referenceHint")}</span>
            </label>
          </div>

          <label>
            <span className="text-micro text-secondary">{t("deals.subject")}</span>
            <input name="subject" className={`${INPUT} mt-1`} />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label>
              <span className="text-micro text-secondary">{t("deal.clientDeadline")}</span>
              <input type="datetime-local" name="deadlineAt" className={`${INPUT} mt-1`} />
            </label>

            <label>
              <span className="text-micro text-secondary">{t("deal.submissionMethod")}</span>
              <select name="submissionMethod" defaultValue="unknown" className={`${INPUT} mt-1`}>
                {SUBMISSION_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(`deal.method.${method}`)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="text-micro text-secondary">{t("deal.currency")}</span>
              <input name="currency" defaultValue="DZD" className={`${INPUT} mt-1`} />
            </label>
          </div>

          <label>
            <span className="text-micro text-secondary">{t("deal.instructions")}</span>
            <textarea name="clientInstructions" rows={4} className={`${INPUT} mt-1`} />
            <span className="mt-1 block text-micro text-muted">
              {t("newDeal.instructionsHint")}
            </span>
          </label>

          <label>
            <span className="text-micro text-secondary">{t("newDeal.pasteLabel")}</span>
            <textarea
              name="paste"
              rows={10}
              placeholder={t("newDeal.pastePlaceholder")}
              className={`${INPUT} mt-1 font-mono`}
            />
            <span className="mt-1 block text-micro leading-relaxed text-muted">
              {t("newDeal.pasteHint")}
            </span>
          </label>

          <div className="flex items-center gap-3 pb-8">
            <Link href="/deals">
              <Button variant="secondary">{t("common.cancel")}</Button>
            </Link>
            <div className="ms-auto">
              <Button type="submit" variant="primary">
                {t("newDeal.create")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
