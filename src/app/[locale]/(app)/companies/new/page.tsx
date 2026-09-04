import { getTranslations, setRequestLocale } from "next-intl/server";
import { createCompany } from "../actions";
import { CompanyForm } from "../company-form";

/** Screen 22, the empty case — the first thing this system could not do. */
export default async function NewCompanyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("company.newTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("company.newSubtitle")}</p>
      </div>

      <div className="max-w-[900px] px-4 md:px-7 py-6">
        <CompanyForm action={createCompany.bind(null, locale)} submitLabel={t("company.create")} />
      </div>
    </main>
  );
}
