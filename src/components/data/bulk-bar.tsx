"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { BulkAction, BulkContext } from "./types";

/**
 * Screen 79. The bar appears when you tick rows, and only offers what is safe
 * in bulk — things you can undo, or that change nothing a client will ever see.
 *
 * Send, issue and cancel are deliberately absent and stay absent: those leave
 * the building, and nothing that leaves the building happens fifty at a time.
 *
 * DELETE USED TO BE ON THAT LIST, and came off it on 11 September 2026 when the
 * owner asked for it — because the reason it was there had already stopped
 * being true. It was written when a discard was a one-way door: the bin could
 * not be emptied OR finished (V3), discarding a deal wrote one row and stranded
 * its drafts so "restore" did not restore (V1), and no screen could say what a
 * removal would take (V2). All three are false now. Every row the bar bins is
 * restorable for thirty days with everything that went with it, and destroying
 * a record for good is a different permission, one row at a time, behind a
 * typed confirmation. Fifty reversible acts are not more dangerous than one.
 *
 * What carries the safety is not the confirmation: it is that `BulkDelete`
 * previews on the SERVER with the same guards the discard uses, and NAMES the
 * rows that will refuse, before and after. A bulk action that silently skips
 * eleven of your fifty rows is worse than no bulk action — that is what this
 * rule was really protecting against, and it still holds.
 *
 * The other half of the rule, learned late and unchanged: an action listed here
 * must do what its label says the moment it is visible. A button that returns
 * in a later phase costs more trust than a button that is not there yet.
 */
export function BulkBar<Row>({
  selectedIds,
  actions,
  context,
  onClear,
  destructive,
}: {
  selectedIds: string[];
  actions: BulkAction<Row>[];
  /** The ticked rows and the visible columns — see `BulkContext`. */
  context: BulkContext<Row>;
  onClear: () => void;
  /**
   * The one destructive action the bar carries, rendered apart from the rest
   * and last. Separate from `actions` on purpose: those take a callback and
   * run, this one needs a server round trip before it may even be offered, and
   * mixing them would let a list pass "delete" as an ordinary action with no
   * preview behind it.
   */
  destructive?: (ids: string[]) => ReactNode;
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
          onClick={() => action.run(selectedIds, context)}
        >
          {t(action.labelKey)}
        </Button>
      ))}
      {destructive ? (
        <>
          <span className="mx-1 h-4 w-px bg-secondary" />
          {destructive(selectedIds)}
        </>
      ) : null}
      <Button size="small" variant="ghost" className="text-muted" onClick={onClear}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
