import { Check, CircleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { recentCounterPrices } from "@/domain/deal/price-store";
import { capturePriceAction } from "./actions";

/**
 * Screen 74 — at the counter, writing down a price. Phone job #2.
 *
 * Designed at 390, not shrunk to it. Four fields a man can fill standing up
 * with one hand: what it is, what it costs, who said so, where. Everything
 * else has a default that is right nine times in ten — the price is TTC and
 * verbal, because that is what a shelf and a counter are.
 *
 * There is no enquiry here on purpose. A price found in a shop in Adrar is
 * worth keeping whether or not a consultation is open, and it reaches the
 * offer builder anyway: `priceHistory` matches on the wording.
 */
export const dynamic = "force-dynamic";

export default async function CapturePricePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { saved, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const recent = await recentCounterPrices();
  const format = await getFormatter({ locale });
  const allowed = canWrite(session.role);
  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <h1 className="text-title font-semibold text-ink">{t("counterPrice.title")}</h1>
        <p className="mt-1 max-w-[640px] text-tiny leading-relaxed text-muted">
          {t("counterPrice.lead")}
        </p>
      </div>

      {saved ? (
        <p className="mx-4 mt-4 flex items-center gap-2 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink md:mx-7">
          <Check className="size-4 shrink-0" aria-hidden />
          {t("counterPrice.saved")}
        </p>
      ) : null}

      {error ? (
        <p className="mx-4 mt-4 flex items-center gap-2 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          {t.has(`counterPrice.error.${error}`) ? t(`counterPrice.error.${error}`) : error}
        </p>
      ) : null}

      <form
        action={capturePriceAction.bind(null, locale)}
        className="mx-4 my-5 max-w-[560px] rounded-[var(--radius-card)] border border-line bg-surface p-4 md:mx-7 md:p-5"
      >
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="text-tiny font-medium text-secondary">
              {t("counterPrice.f.designation")}
            </span>
            <input
              name="designation"
              required
              autoComplete="off"
              placeholder={t("counterPrice.f.designationHint")}
              // 44px: a thumb, not a mouse pointer.
              className={`${INPUT} mt-1.5 h-[44px] text-base`}
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-tiny font-medium text-secondary">
                {t("counterPrice.f.price")}
              </span>
              <input
                name="price"
                required
                // `decimal` puts the number pad up with a comma on it.
                inputMode="decimal"
                placeholder="0,00"
                className={`${INPUT} mt-1.5 h-[44px] text-end text-base tabular-nums`}
              />
            </label>
            <label className="block">
              <span className="text-tiny font-medium text-secondary">
                {t("counterPrice.f.supplier")}
              </span>
              <input
                name="supplierName"
                required
                autoComplete="off"
                placeholder={t("counterPrice.f.supplierHint")}
                className={`${INPUT} mt-1.5 h-[44px] text-base`}
              />
            </label>
          </div>

          {/*
            Two ticks, both defaulted to what a counter actually is: the number
            on the shelf includes VAT, and nobody handed you a paper. Unticking
            them is the exception, which is why they are worded as the
            exception.
          */}
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-plane p-3">
            <label className="flex min-h-[36px] items-center gap-3">
              <input name="incl" type="checkbox" defaultChecked className="size-6 accent-ink" />
              <span className="text-tiny text-ink">{t("counterPrice.f.incl")}</span>
            </label>
            <label className="flex min-h-[36px] items-center gap-3">
              <input name="written" type="checkbox" className="size-6 accent-ink" />
              <span className="text-tiny text-ink">{t("counterPrice.f.written")}</span>
            </label>
            <p className="text-micro leading-relaxed text-muted">{t("counterPrice.f.verbalWhy")}</p>
          </div>

          <details className="rounded-[var(--radius-control)] border border-line-subtle">
            <summary className="cursor-pointer px-3 py-2.5 text-tiny text-secondary">
              {t("counterPrice.more")}
            </summary>
            <div className="flex flex-col gap-4 px-3 pb-3">
              <label className="block">
                <span className="text-tiny font-medium text-secondary">
                  {t("counterPrice.f.place")}
                </span>
                <input
                  name="capturedPlace"
                  autoComplete="off"
                  placeholder={t("counterPrice.f.placeHint")}
                  className={`${INPUT} mt-1.5 h-[44px] text-base`}
                />
              </label>
              <label className="block">
                <span className="text-tiny font-medium text-secondary">
                  {t("counterPrice.f.from")}
                </span>
                <input
                  name="capturedFrom"
                  autoComplete="off"
                  placeholder={t("counterPrice.f.fromHint")}
                  className={`${INPUT} mt-1.5 h-[44px] text-base`}
                />
              </label>
              <label className="block">
                <span className="text-tiny font-medium text-secondary">
                  {t("counterPrice.f.validUntil")}
                </span>
                <input
                  name="validUntil"
                  type="date"
                  className={`${INPUT} mt-1.5 h-[44px] text-base`}
                />
              </label>
            </div>
          </details>

          <Button
            type="submit"
            variant="primary"
            disabledReason={allowed ? undefined : t("documents.notAllowed")}
          >
            {t("counterPrice.go")}
          </Button>
        </div>
      </form>

      {recent.length > 0 ? (
        <section className="mx-4 mb-6 max-w-[560px] rounded-[var(--radius-card)] border border-line bg-surface md:mx-7">
          <h2 className="border-b border-line-subtle px-4 py-3 text-tiny font-semibold text-ink">
            {t("counterPrice.recent")}
          </h2>
          <ul>
            {recent.map((row) => (
              <li key={row.id} className="border-b border-line-subtle px-4 py-3 last:border-0">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-tiny text-ink">
                    {row.designation}
                  </span>
                  <span className="shrink-0 text-tiny font-medium tabular-nums text-ink">
                    {format.number(Number(row.price), { maximumFractionDigits: 2 })} {row.currency}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted">
                  <span>{row.supplier ?? "—"}</span>
                  {row.capturedPlace ? <span>· {row.capturedPlace}</span> : null}
                  <span>· {when.format(row.capturedAt)}</span>
                  <span>· {row.isExclVat ? t("counterPrice.ht") : t("counterPrice.ttc")}</span>
                  {row.isVerbal ? <Badge tone="warning">{t("counterPrice.verbal")}</Badge> : null}
                </p>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-subtle px-4 py-3 text-micro leading-relaxed text-muted">
            {t("counterPrice.footnote")}
          </p>
        </section>
      ) : null}
    </main>
  );
}
