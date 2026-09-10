import { getTranslations, setRequestLocale } from "next-intl/server";
import { createCompany } from "../actions";
import { CompanyForm } from "../company-form";

/** Screen 22, the empty case — the first thing this system could not do. */
export default async function NewCompanyPage({
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

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("company.newTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("company.newSubtitle")}</p>
      </div>

      <div className="max-w-[900px] px-4 md:px-7 py-6">
        {/*
          CLIENT, ticked. A role is required and none was ticked by default, so
          the commonest possible action - recording the company that just sent
          an enquiry - failed on the field furthest from what the person came
          here to type. It is a checkbox they can see and untick; a supplier is
          two clicks and a supplier who is also a client is what the fieldset
          is for.
        */}
        <CompanyForm
          action={createCompany.bind(null, locale)}
          values={{ roles: ["client"] }}
          submitLabel={t("company.create")}
          error={error}
        />
      </div>
    </main>
  );
}
