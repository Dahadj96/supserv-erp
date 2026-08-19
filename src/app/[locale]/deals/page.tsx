import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { RulePopover } from "@/components/ui/rule-popover";
import { evaluate, isBlocked, SEED_RULES } from "@/domain/rules";

/**
 * Screen 05 — Deals. Phase 0 shows the empty state, because an empty screen
 * that explains itself is the thing worth getting right first. No seed data:
 * fake companies teach people to ignore what is on screen.
 */
export default async function DealsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const deals: never[] = [];

  // Until the offer exists there is nothing to send, so the control is disabled
  // and says so. The rule set is the seed from src/domain/rules.ts.
  const blocking = evaluate(SEED_RULES, ["offer.technical_annex_incomplete"]);

  return (
    <main className="min-w-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.deals")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("common.showing", { shown: deals.length, total: deals.length })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="secondary">{t("common.filters")}</Button>
          <RulePopover results={blocking}>
            <Button
              variant="primary"
              icon={<Plus className="size-4" aria-hidden />}
              disabledReason={isBlocked(blocking) ? t(blocking[0]?.messageKey ?? "") : undefined}
            >
              {t("nav.offers")}
            </Button>
          </RulePopover>
        </div>
      </div>

      <div className="px-7 py-6">
        <div className="rounded-[var(--radius-card)] border border-line bg-card px-6 py-14 text-center">
          <h2 className="text-lead font-semibold text-ink">{t("empty.noDealsTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[420px] text-tiny leading-relaxed text-secondary">
            {t("empty.noDealsBody")}
          </p>
        </div>
      </div>
    </main>
  );
}
