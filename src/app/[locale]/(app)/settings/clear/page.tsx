import { CircleAlert, Info } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  planSweep,
  readSweep,
  SWEEP_ORDER,
  type SweepKind,
  type SweepSkip,
  skippedTotal,
  sweepCounts,
  sweepTotal,
} from "@/domain/sweep";
import { Link } from "@/i18n/navigation";
import { clearTestData, previewSweep } from "./actions";

/**
 * Screen 29 → "Clear my test data".
 *
 * A hub row rather than a control on the hub itself: `/settings` shows the
 * live state of every setting and sends you to the page that owns it, and this
 * is the widest thing anybody can do to this database. It gets its own page,
 * its own preview, and a word somebody has to type.
 *
 * It is visible to everybody and refuses out loud to anybody but the Gérant. A
 * permission never hides that a thing exists (screen 79) — somebody who cannot
 * use this still needs to know it is what they are asking their Gérant for.
 */
export const dynamic = "force-dynamic";

/** `datetime-local` wants exactly this, in the reader's own clock. */
function forInput(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export default async function ClearPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ before?: string; error?: string; done?: string }>;
}) {
  const { locale } = await params;
  const { before, error, done } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  const mayClear = Boolean(session?.role && can(session.role, "records.delete"));

  // Midnight this morning. Everything typed while learning is behind it, and
  // nothing done today — which is the work somebody is in the middle of — is.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const cutOff = before ? new Date(before) : null;
  const valid = cutOff !== null && !Number.isNaN(cutOff.getTime());
  const plan = mayClear && valid ? await planSweep(cutOff) : null;
  const doneId = done && /^\d+$/.test(done) ? Number(done) : null;
  const outcome = mayClear && doneId ? await readSweep(doneId) : null;

  const counts = plan ? sweepCounts(plan) : null;
  const total = counts ? sweepTotal(counts) : 0;

  const when = (at: Date) =>
    at.toLocaleString(locale === "fr" ? "fr-DZ" : "en-GB", {
      dateStyle: "long",
      timeStyle: "short",
    });

  /**
   * Written out rather than built from a template literal, so
   * `tests/unit/messages.test.ts` can see every key and a French file missing
   * one fails the build rather than the page.
   */
  const KIND: Record<SweepKind, string> = {
    company: t("bin.kind.company"),
    deal: t("bin.kind.deal"),
    document: t("bin.kind.document"),
    person: t("bin.kind.person"),
  };
  const COUNTED: Record<SweepKind, (n: number) => string> = {
    company: (count) => t("clearData.count.company", { count }),
    deal: (count) => t("clearData.count.deal", { count }),
    document: (count) => t("clearData.count.document", { count }),
    person: (count) => t("clearData.count.person", { count }),
  };
  const SKIPPED: Record<string, (n: number) => string> = {
    "company:issued": (count) => t("clearData.skip.companyIssued", { count }),
    "company:attached": (count) => t("clearData.skip.companyAttached", { count }),
    "deal:issued": (count) => t("clearData.skip.dealIssued", { count }),
    "deal:attached": (count) => t("clearData.skip.dealAttached", { count }),
    "document:issued": (count) => t("clearData.skip.documentIssued", { count }),
    "person:onSite": (count) => t("clearData.skip.personOnSite", { count }),
  };
  const skipLine = (s: SweepSkip) =>
    s.reason === "failed"
      ? t("clearData.skip.failed", { count: s.count, kind: KIND[s.kind] })
      : (SKIPPED[`${s.kind}:${s.reason}`]?.(s.count) ?? "");

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <h1 className="text-title font-semibold text-ink">{t("clearData.title")}</h1>
        <p className="mt-1 text-tiny text-muted">{t("clearData.subtitle")}</p>
      </div>

      <div className="max-w-[900px] px-4 md:px-7 py-6">
        {error ? (
          <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
            {error === "badDate"
              ? t("clearData.error.badDate")
              : error === "notConfirmed"
                ? t("clearData.error.notConfirmed")
                : t("clearData.error.notAllowed")}
          </p>
        ) : null}

        {mayClear ? null : (
          <div className="mb-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
            <CircleAlert className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
            <p className="text-tiny leading-relaxed text-warning-ink">
              {t("clearData.notAllowed")}
            </p>
          </div>
        )}

        {outcome ? (
          <section className="mb-5 rounded-[var(--radius-card)] border border-good bg-good-bg p-5">
            <h2 className="text-tiny font-semibold text-good-ink">{t("clearData.doneTitle")}</h2>
            <p className="mt-1 text-micro leading-relaxed text-good-ink">
              {t("clearData.doneBody", {
                count: sweepTotal(outcome.discarded),
                when: when(outcome.before),
              })}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SWEEP_ORDER.map((kind) => (
                <li key={kind}>
                  <Badge>{COUNTED[kind](outcome.discarded[kind])}</Badge>
                </li>
              ))}
            </ul>
            {outcome.skipped.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {outcome.skipped.map((s) => (
                  <li
                    key={`${s.kind}:${s.reason}`}
                    className="text-micro leading-relaxed text-good-ink"
                  >
                    {skipLine(s)}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4">
              <Link href="/settings/bin">
                <Button variant="secondary">{t("clearData.openBin")}</Button>
              </Link>
            </div>
          </section>
        ) : null}

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <p className="text-tiny leading-relaxed text-secondary">{t("clearData.whatItDoes")}</p>
          <div className="mt-3 flex items-start gap-3 rounded-[var(--radius-control)] border border-line-subtle bg-sunken px-4 py-3">
            <Info className="mt-px size-4 shrink-0 text-muted" aria-hidden />
            <p className="text-micro leading-relaxed text-secondary">
              {t("clearData.neverTouches")}
            </p>
          </div>

          <form action={previewSweep.bind(null, locale)} className="mt-4">
            <label className="block max-w-[320px]">
              <span className="text-micro text-secondary">{t("clearData.cutOff")}</span>
              <input
                type="datetime-local"
                name="before"
                defaultValue={valid && cutOff ? forInput(cutOff) : forInput(midnight)}
                className={`${INPUT} mt-1`}
              />
            </label>
            <p className="mt-1.5 text-micro leading-relaxed text-muted">
              {t("clearData.cutOffHelp")}
            </p>
            <div className="mt-3">
              <Button
                type="submit"
                variant="secondary"
                disabledReason={mayClear ? undefined : t("clearData.notAllowed")}
              >
                {t("clearData.preview")}
              </Button>
            </div>
          </form>
        </section>

        {plan && counts && cutOff ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">
              {t("clearData.previewTitle", { when: when(cutOff) })}
            </h2>

            {total === 0 ? (
              <p className="mt-2 text-micro leading-relaxed text-secondary">
                {t("clearData.previewNothing")}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {SWEEP_ORDER.filter((kind) => counts[kind] > 0).map((kind) => (
                  <li key={kind}>
                    <p className="text-tiny text-ink">{COUNTED[kind](counts[kind])}</p>
                    <p className="mt-0.5 text-micro leading-relaxed text-muted">
                      {plan.take[kind]
                        .slice(0, 5)
                        .map((row) =>
                          kind === "document" && t.has(`documents.kind.${row.label}`)
                            ? t(`documents.kind.${row.label}`)
                            : row.label,
                        )
                        .join(" · ")}
                      {counts[kind] > 5
                        ? ` · ${t("clearData.andMore", { count: counts[kind] - 5 })}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {plan.skipped.length > 0 ? (
              <div className="mt-4 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
                <p className="text-micro font-semibold text-warning-ink">
                  {t("clearData.skippedTitle", { count: skippedTotal(plan.skipped) })}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {plan.skipped.map((s) => (
                    <li
                      key={`${s.kind}:${s.reason}`}
                      className="text-micro leading-relaxed text-warning-ink"
                    >
                      {skipLine(s)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {total === 0 ? null : (
              <form
                action={clearTestData.bind(null, locale)}
                className="mt-5 border-t border-line-subtle pt-4"
              >
                <input type="hidden" name="before" value={cutOff.toISOString()} />
                <p className="text-tiny leading-relaxed text-ink">
                  {t("clearData.confirmBody", { count: total, word: t("clearData.confirmWord") })}
                </p>
                <label className="mt-3 block max-w-[420px]">
                  <span className="text-micro text-secondary">{t("clearData.reason")}</span>
                  <input name="reason" className={`${INPUT} mt-1`} />
                </label>
                <label className="mt-3 block max-w-[240px]">
                  <span className="text-micro text-secondary">
                    {t("clearData.confirmLabel", { word: t("clearData.confirmWord") })}
                  </span>
                  <input
                    name="confirm"
                    autoComplete="off"
                    placeholder={t("clearData.confirmWord")}
                    className={`${INPUT} mt-1`}
                  />
                </label>
                <div className="mt-4">
                  <Button
                    type="submit"
                    variant="danger"
                    disabledReason={mayClear ? undefined : t("clearData.notAllowed")}
                  >
                    {t("clearData.action")}
                  </Button>
                </div>
              </form>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}
