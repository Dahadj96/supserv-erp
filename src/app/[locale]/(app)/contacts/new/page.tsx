import { asc } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { Link } from "@/i18n/navigation";
import { newContact } from "../actions";

/** Screen 76 — a name, a job, and the company they work for. Nothing else. */
export const dynamic = "force-dynamic";

const INPUT =
  "h-[34px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-tiny outline-none focus:border-ink";

function Field({
  htmlFor,
  label,
  hint,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-micro font-medium text-secondary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-micro text-muted">{hint}</p> : null}
    </div>
  );
}

export default async function NewContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; company?: string }>;
}) {
  const { locale } = await params;
  const { error, company } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const companies = await db
    .select({ id: party.id, code: party.code, legalName: party.legalName })
    .from(party)
    .where(liveParty)
    .orderBy(asc(party.legalName))
    .limit(500);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("contacts.newTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("contacts.newSubtitle")}</p>
      </div>

      <form
        action={newContact.bind(null, locale)}
        className="max-w-[560px] px-4 md:px-7 py-6"
        autoComplete="off"
      >
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
            {t(`contacts.error.${error}`)}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <Field htmlFor="fullName" label={t("contacts.name")}>
            <input id="fullName" name="fullName" required className={INPUT} />
          </Field>

          <Field htmlFor="job" label={t("contacts.job")} hint={t("contacts.jobHint")}>
            <input id="job" name="job" required className={INPUT} />
          </Field>

          <Field htmlFor="companyId" label={t("contacts.company")}>
            <select
              id="companyId"
              name="companyId"
              required
              defaultValue={company ?? ""}
              className={INPUT}
            >
              <option value="" disabled>
                {t("contacts.chooseCompany")}
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName} — {c.code}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field htmlFor="email" label={t("contacts.email")}>
              <input id="email" name="email" type="email" className={INPUT} />
            </Field>
            <Field htmlFor="phone" label={t("contacts.phone")}>
              <input id="phone" name="phone" className={INPUT} />
            </Field>
          </div>

          <Field htmlFor="prefers" label={t("contacts.prefers")} hint={t("contacts.prefersHint")}>
            <select id="prefers" name="prefers" defaultValue="" className={INPUT}>
              <option value="">{t("contacts.prefersUnknown")}</option>
              <option value="email">{t("contacts.prefersValue.email")}</option>
              <option value="phone">{t("contacts.prefersValue.phone")}</option>
              <option value="whatsapp">{t("contacts.prefersValue.whatsapp")}</option>
            </select>
          </Field>
        </div>

        <p className="mt-4 text-micro leading-relaxed text-muted">{t("contacts.newVerifyNote")}</p>

        <div className="mt-5 flex items-center gap-2">
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
          <Link href="/contacts">
            <Button variant="ghost">{t("common.cancel")}</Button>
          </Link>
        </div>
      </form>
    </main>
  );
}
