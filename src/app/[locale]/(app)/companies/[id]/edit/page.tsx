import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getParty } from "@/domain/party";
import { updateCompany } from "../../actions";
import { CompanyForm } from "../../company-form";

export const dynamic = "force-dynamic";

export default async function EditCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const company = await getParty(id);
  if (!company) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{company.legalName}</h1>
        <p className="mt-1 text-tiny text-muted">
          {company.code} · {t("company.edit")}
        </p>
      </div>

      <div className="max-w-[900px] px-4 md:px-7 py-6">
        <CompanyForm
          action={updateCompany.bind(null, locale, id)}
          values={company}
          submitLabel={t("common.save")}
          error={error}
        />
      </div>
    </main>
  );
}
