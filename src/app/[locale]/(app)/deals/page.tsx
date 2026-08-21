import { Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
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

  // The button is grey because the offer builder does not exist yet — not
  // because a compliance rule refused anything. It used to claim the latter,
  // citing a rule from a seed list that said it had been confirmed by a person
  // who never confirmed it. Screen 80 asks for a reason on every grey control;
  // it does not ask for an impressive one.
  const notYet = t("rules.comingInPhase", { phase: 4 });

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
          <Button
            variant="primary"
            icon={<Plus className="size-4" aria-hidden />}
            disabledReason={notYet}
          >
            {t("nav.offers")}
          </Button>
        </div>
      </div>

      <DealsList rows={rows} total={total} />
    </main>
  );
}
