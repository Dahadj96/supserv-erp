import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { WILAYA_LIST_ID, WilayaList } from "@/components/ui/wilaya-list";
import { getIdentity } from "@/domain/company";
import { Link } from "@/i18n/navigation";
import { saveCompanyIdentity } from "../actions";
import { Field, INPUT } from "../field";

/**
 * Screen 85, steps 1 and 2 — company identity and the logo.
 *
 * "RC, NIF, NIS and the article d'imposition are typed once, by you, and
 * checked against the paper. Nothing else in the system can be trusted if these
 * are wrong."
 *
 * So the four are marked required, the NIF is checked for fifteen digits, and
 * the hint under each one names the paper it is copied from rather than
 * explaining what the field is.
 */
export const dynamic = "force-dynamic";

export default async function IdentityPage({
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

  const identity = await getIdentity();

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("setup.identityTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("setup.identitySubtitle")}</p>
      </div>

      <form
        action={saveCompanyIdentity.bind(null, locale)}
        className="max-w-[760px] px-4 md:px-7 py-6"
        autoComplete="off"
      >
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
            {t(`setup.error.${error}`)}
          </p>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.legalIdentity")}</h2>
          <p className="mt-1 text-micro leading-relaxed text-muted">{t("setup.decret")}</p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field htmlFor="legalName" label={t("setup.f.legalName")} required>
              <input
                id="legalName"
                name="legalName"
                required
                defaultValue={identity?.legalName ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="tradeName" label={t("setup.f.tradeName")}>
              <input
                id="tradeName"
                name="tradeName"
                defaultValue={identity?.tradeName ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="legalForm" label={t("setup.f.legalForm")}>
              <input
                id="legalForm"
                name="legalForm"
                placeholder="SARL"
                defaultValue={identity?.legalForm ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="capital" label={t("setup.f.capital")}>
              <input
                id="capital"
                name="capital"
                inputMode="decimal"
                defaultValue={identity?.capital ?? ""}
                className={INPUT}
              />
            </Field>

            <Field htmlFor="rc" label="RC" hint={t("setup.h.rc")} required>
              <input
                id="rc"
                name="rc"
                required
                defaultValue={identity?.rc ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="nif" label="NIF" hint={t("setup.h.nif")} required>
              <input
                id="nif"
                name="nif"
                required
                inputMode="numeric"
                defaultValue={identity?.nif ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="nis" label="NIS" hint={t("setup.h.nis")} required>
              <input
                id="nis"
                name="nis"
                required
                defaultValue={identity?.nis ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="ai" label={t("setup.f.ai")} hint={t("setup.h.ai")} required>
              <input
                id="ai"
                name="ai"
                required
                defaultValue={identity?.ai ?? ""}
                className={INPUT}
              />
            </Field>
          </div>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.whereYouAre")}</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-1 md:col-span-2">
              <Field htmlFor="address" label={t("setup.f.address")} required>
                <input
                  id="address"
                  name="address"
                  required
                  defaultValue={identity?.address ?? ""}
                  className={INPUT}
                />
              </Field>
            </div>
            <Field htmlFor="wilaya" label={t("setup.f.wilaya")}>
              <input
                id="wilaya"
                name="wilaya"
                list={WILAYA_LIST_ID}
                defaultValue={identity?.wilaya ?? ""}
                className={INPUT}
              />
              <WilayaList />
            </Field>
            <Field htmlFor="phone" label={t("setup.f.phone")}>
              <input
                id="phone"
                name="phone"
                defaultValue={identity?.phone ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="email" label={t("setup.f.email")}>
              <input
                id="email"
                name="email"
                type="email"
                defaultValue={identity?.email ?? ""}
                className={INPUT}
              />
            </Field>
            <Field htmlFor="website" label={t("setup.f.website")}>
              <input
                id="website"
                name="website"
                defaultValue={identity?.website ?? ""}
                className={INPUT}
              />
            </Field>
          </div>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.logoTitle")}</h2>
          <p className="mt-1 max-w-[600px] text-micro leading-relaxed text-muted">
            {t("setup.logoBody")}
          </p>
          <div className="mt-3 flex items-end gap-4">
            <Field htmlFor="logo" label={t("setup.f.logo")}>
              <input
                id="logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="text-tiny file:me-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-2.5 file:py-1.5 file:text-tiny"
              />
            </Field>
            {identity?.logoPath ? (
              <p className="pb-2 text-micro text-good-ink">{t("setup.logoOnFile")}</p>
            ) : null}
          </div>
        </section>

        <div className="mt-5 flex items-center gap-2">
          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
          <Link href="/setup">
            <Button variant="ghost">{t("common.cancel")}</Button>
          </Link>
        </div>
      </form>
    </main>
  );
}
