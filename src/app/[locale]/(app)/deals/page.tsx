import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { RulePopover } from "@/components/ui/rule-popover";
import { evaluate, isBlocked, SEED_RULES } from "@/domain/rules";
import { type DealRow, DealsList } from "./deals-list";

/**
 * Screen 05 — Deals.
 *
 * There is no `deal` table yet: the schema so far covers documents, items and
 * parties. Until it exists this list is genuinely empty rather than seeded —
 * fake companies teach people to ignore what is on screen (CLAUDE.md).
 */
export default async function DealsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const rows: DealRow[] = [];
  const total = 0;

  // Until an offer exists there is nothing to send, so the control is disabled
  // and says why. The rule set comes from src/domain/rules.ts, not from here.
  const blocking = evaluate(SEED_RULES, ["offer.technical_annex_incomplete"]);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("nav.deals")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("common.showing", { shown: rows.length, total })}
          </p>
        </div>
        <div className="ms-auto">
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

      <DealsList rows={rows} total={total} />
    </main>
  );
}
