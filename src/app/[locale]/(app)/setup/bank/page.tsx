import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listBankAccounts } from "@/domain/company";
import { Link } from "@/i18n/navigation";
import { saveBank } from "../actions";
import { Field, INPUT } from "../field";

/**
 * Screen 85, step 5 — bank accounts and RIB.
 *
 * "Printed on the invoice as the domiciliation." An Algerian invoice carries
 * the bank and the twenty-digit RIB the client should pay into, and a wrong
 * digit there is a payment that goes somewhere else.
 */
export const dynamic = "force-dynamic";

export default async function BankPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { locale } = await params;
  const { error, saved } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const accounts = await listBankAccounts();

  /** Grouped four by four, which is how a RIB is printed and checked. */
  const grouped = (rib: string) => rib.replace(/(\d{4})(?=\d)/g, "$1 ");

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">{t("setup.bankTitle")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("setup.bankSubtitle")}</p>
      </div>

      <div className="max-w-[860px] px-7 py-6">
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
            {t(`setup.error.${error}`)}
          </p>
        ) : null}
        {saved ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-good-bg px-3 py-2 text-micro text-good-ink">
            {t("setup.bankAdded")}
          </p>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.accountsSoFar")}</h2>

          {accounts.length === 0 ? (
            <p className="mt-3 text-micro text-muted">{t("setup.noAccountsYet")}</p>
          ) : (
            <table className="mt-3 w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2 text-start font-medium">{t("setup.f.bankName")}</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.agency")}</th>
                  <th className="py-2 text-start font-medium">RIB</th>
                  <th className="py-2 text-start font-medium">{t("setup.f.currency")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-ink">{a.bankName}</td>
                    <td className="py-2 text-secondary">{a.agency ?? "—"}</td>
                    <td className="py-2 font-mono text-secondary">{grouped(a.rib)}</td>
                    <td className="py-2 text-secondary">{a.currency}</td>
                    <td className="py-2 text-end">
                      {a.isDefault ? <Badge tone="good">{t("setup.defaultAccount")}</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("setup.addAccount")}</h2>
          <form action={saveBank.bind(null, locale)} className="mt-3">
            <div className="grid grid-cols-2 gap-4">
              <Field htmlFor="bankName" label={t("setup.f.bankName")} required>
                <input id="bankName" name="bankName" required className={INPUT} />
              </Field>
              <Field htmlFor="agency" label={t("setup.f.agency")}>
                <input id="agency" name="agency" className={INPUT} />
              </Field>
              <div className="col-span-2">
                <Field htmlFor="rib" label="RIB" hint={t("setup.h.rib")} required>
                  <input
                    id="rib"
                    name="rib"
                    required
                    inputMode="numeric"
                    placeholder="0000 0000 0000 0000 0000"
                    className={`${INPUT} font-mono`}
                  />
                </Field>
              </div>
              <Field htmlFor="iban" label="IBAN">
                <input id="iban" name="iban" className={`${INPUT} font-mono`} />
              </Field>
              <Field htmlFor="swift" label="SWIFT / BIC">
                <input id="swift" name="swift" className={`${INPUT} font-mono`} />
              </Field>
              <Field htmlFor="currency" label={t("setup.f.currency")}>
                <select id="currency" name="currency" defaultValue="DZD" className={INPUT}>
                  <option value="DZD">DZD</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </Field>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Button type="submit" variant="primary">
                {t("setup.addAccount")}
              </Button>
              <Link href="/setup">
                <Button variant="ghost">{t("setup.backToDayOne")}</Button>
              </Link>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
