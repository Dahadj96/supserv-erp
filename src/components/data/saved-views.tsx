"use client";

import { useTranslations } from "next-intl";
import type { FilterValue, SavedView } from "./types";

/**
 * Screen 79 — a saved view is a named question, not a query. Yours are private
 * until you share them, which is why `shared` is a property of the view and not
 * a permission on the list.
 */
export function SavedViews({
  views,
  activeId,
  onSelect,
}: {
  views: SavedView[];
  activeId: string | null;
  onSelect: (filter: FilterValue, id: string) => void;
}) {
  const t = useTranslations();
  if (views.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 text-micro text-muted">{t("list.savedViews")}</span>
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          title={view.question}
          onClick={() => onSelect(view.filter, view.id)}
          className={`shrink-0 rounded-[var(--radius-pill)] px-2.5 py-1 text-micro ${
            activeId === view.id
              ? "bg-ink font-medium text-on-ink"
              : "bg-chip text-secondary hover:bg-line"
          }`}
        >
          {view.name}
          {view.shared ? <span className="ms-1 text-muted">·</span> : null}
        </button>
      ))}
    </div>
  );
}
