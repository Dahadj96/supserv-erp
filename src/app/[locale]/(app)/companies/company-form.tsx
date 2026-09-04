import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WILAYA_LIST_ID, WilayaList } from "@/components/ui/wilaya-list";
import { PARTY_ROLES } from "@/domain/party";

type Values = {
  legalName?: string | null;
  tradeName?: string | null;
  roles?: string[];
  nif?: string | null;
  nis?: string | null;
  rc?: string | null;
  ai?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  wilaya?: string | null;
  docLocale?: string | null;
  emailLocale?: string | null;
  currency?: string | null;
  paymentTerms?: string | null;
};

/** `htmlFor` rather than wrapping: an explicit association survives refactors. */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-micro font-medium text-secondary">
        {label}
      </label>
      {children}
      {hint ? <span className="text-micro text-muted">{hint}</span> : null}
    </div>
  );
}

const input =
  "h-[34px] rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-tiny text-ink outline-none focus:border-ink";

export async function CompanyForm({
  action,
  values = {},
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  values?: Values;
  submitLabel: string;
}) {
  const t = await getTranslations();
  const roles = values.roles ?? [];

  return (
    <form action={action} className="flex flex-col gap-5">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("company.identity")}</h2>
        <p className="mt-1 text-micro text-secondary">{t("company.identityHelp")}</p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field htmlFor="legalName" label={t("companies.legalName")}>
            <input
              id="legalName"
              name="legalName"
              required
              defaultValue={values.legalName ?? ""}
              className={input}
            />
          </Field>
          <Field
            htmlFor="tradeName"
            label={t("company.tradeName")}
            hint={t("company.tradeNameHint")}
          >
            <input
              id="tradeName"
              name="tradeName"
              defaultValue={values.tradeName ?? ""}
              className={input}
            />
          </Field>
        </div>

        <fieldset className="mt-4">
          <legend className="text-micro font-medium text-secondary">{t("company.roles")}</legend>
          <p className="mb-1.5 text-micro text-muted">{t("company.rolesHint")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {PARTY_ROLES.map((role) => (
              <label key={role} className="inline-flex items-center gap-2 text-tiny text-ink">
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  defaultChecked={roles.includes(role)}
                  className="size-[15px] appearance-none rounded-[4px] border border-line-strong bg-surface checked:border-ink checked:bg-ink"
                />
                {t(`company.role.${role}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("company.legalIdentity")}</h2>
        <p className="mt-1 max-w-[620px] text-micro leading-relaxed text-secondary">
          {t("company.legalIdentityHelp")}
        </p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field htmlFor="nif" label="NIF" hint={t("company.nifHint")}>
            <input
              id="nif"
              name="nif"
              inputMode="numeric"
              defaultValue={values.nif ?? ""}
              className={input}
            />
          </Field>
          <Field htmlFor="nis" label="NIS">
            <input id="nis" name="nis" defaultValue={values.nis ?? ""} className={input} />
          </Field>
          <Field htmlFor="rc" label="RC">
            <input id="rc" name="rc" defaultValue={values.rc ?? ""} className={input} />
          </Field>
          <Field htmlFor="ai" label="AI">
            <input id="ai" name="ai" defaultValue={values.ai ?? ""} className={input} />
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("company.reaching")}</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field htmlFor="email" label={t("company.email")}>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={values.email ?? ""}
              className={input}
            />
          </Field>
          <Field htmlFor="phone" label={t("company.phone")}>
            <input id="phone" name="phone" defaultValue={values.phone ?? ""} className={input} />
          </Field>
          <Field htmlFor="address" label={t("company.address")}>
            <input
              id="address"
              name="address"
              defaultValue={values.address ?? ""}
              className={input}
            />
          </Field>
          <Field htmlFor="wilaya" label={t("companies.wilaya")}>
            <input
              id="wilaya"
              name="wilaya"
              list={WILAYA_LIST_ID}
              defaultValue={values.wilaya ?? ""}
              className={input}
            />
            <WilayaList />
          </Field>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("company.dealing")}</h2>
        <p className="mt-1 max-w-[620px] text-micro leading-relaxed text-secondary">
          {t("company.docLocaleHelp")}
        </p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field htmlFor="docLocale" label={t("companies.docLocale")}>
            <select
              id="docLocale"
              name="docLocale"
              defaultValue={values.docLocale ?? "fr"}
              className={input}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field htmlFor="emailLocale" label={t("company.emailLocale")}>
            <select
              id="emailLocale"
              name="emailLocale"
              defaultValue={values.emailLocale ?? "fr"}
              className={input}
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field htmlFor="currency" label={t("company.currency")}>
            <input
              id="currency"
              name="currency"
              defaultValue={values.currency ?? "DZD"}
              className={input}
            />
          </Field>
          <Field htmlFor="paymentTerms" label={t("company.paymentTerms")}>
            <input
              id="paymentTerms"
              name="paymentTerms"
              defaultValue={values.paymentTerms ?? ""}
              className={input}
            />
          </Field>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
