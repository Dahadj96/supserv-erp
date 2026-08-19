"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { BulkAction } from "./types";

/**
 * Screen 79. The bar appears when you tick rows, and only offers what is safe
 * in bulk: assign, tag, mark waiting, export — things you can undo, or that
 * change nothing a client will ever see.
 *
 * Send, issue, cancel and delete are deliberately absent. Anything that leaves
 * the building or cannot be undone happens one record at a time, with its own
 * confirmation. Do not add them here.
 */
export function BulkBar({
  selectedIds,
  actions,
  onClear,
}: {
  selectedIds: string[];
  actions: BulkAction[];
  onClear: () => void;
}) {
  const t = useTranslations();
  if (selectedIds.length === 0) return null;

  return (
    <div className="sticky bottom-4 z-10 mx-auto flex w-fit items-center gap-2 rounded-[var(--radius-card)] border border-line bg-ink px-3 py-2 text-on-ink shadow-lg">
      <span className="text-tiny font-medium">
        {t("list.selected", { count: selectedIds.length })}
      </span>
      <span className="mx-1 h-4 w-px bg-secondary" />
      {actions.map((action) => (
        <Button
          key={action.key}
          size="small"
          variant="ghost"
          className="text-on-ink hover:bg-ink-hover"
          onClick={() => action.run(selectedIds)}
        >
          {t(action.labelKey)}
        </Button>
      ))}
      <Button size="small" variant="ghost" className="text-muted" onClick={onClear}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
