"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

/**
 * Screen 34 — the error state. It says nothing was changed, because that is the
 * first thing a person needs to know after a request fails.
 */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();

  return (
    <main className="min-h-0 flex-1 overflow-auto px-4 md:px-7 py-6">
      <StateBlock
        tone="error"
        title={t("empty.errorTitle")}
        body={t("empty.errorBody")}
        action={
          <Button variant="secondary" onClick={reset}>
            {t("common.retry")}
          </Button>
        }
      />
    </main>
  );
}
