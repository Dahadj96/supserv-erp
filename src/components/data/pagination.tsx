"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Screen 79, rule one: the count always shows both. "14 of 342" — a filtered
 * list that only shows 14 makes people believe 14 is all there is.
 */
export function Pagination({
  page,
  pageSize,
  shown,
  total,
  filtered,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  shown: number;
  total: number;
  /** True when a filter is applied — changes the sentence, not the numbers. */
  filtered: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const t = useTranslations();
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, shown);
  const pages = Math.max(1, Math.ceil(shown / pageSize));

  return (
    <div className="flex items-center gap-3 border-t border-line-subtle px-4 py-2.5 text-tiny text-secondary">
      <span>{t("list.range", { first, last, total: shown })}</span>
      {filtered ? (
        <span className="text-muted">{t("list.filteredFrom", { shown, total })}</span>
      ) : null}

      <span className="ms-auto flex items-center gap-1">
        <button
          type="button"
          aria-label={t("list.previous")}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="flex size-7 items-center justify-center rounded-[var(--radius-control)] hover:bg-sunken disabled:text-disabled"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <button
          type="button"
          aria-label={t("list.next")}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="flex size-7 items-center justify-center rounded-[var(--radius-control)] hover:bg-sunken disabled:text-disabled"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </span>

      <label className="flex items-center gap-1.5">
        <span className="text-muted">{t("list.rowsPerPage")}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded-[var(--radius-control)] border border-line bg-surface px-1.5 py-0.5"
        >
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
