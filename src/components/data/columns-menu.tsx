"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import type { ColumnDef } from "./types";

/**
 * Screen 79 — the button beside Filters. Per person, per list.
 *
 * A permission never hides that a column exists: a column the person may not
 * read stays listed and greyed, with its permission code named, rather than
 * vanishing as though it were never designed.
 */
export function ColumnsMenu<Row>({
  columns,
  visible,
  onToggle,
}: {
  columns: ColumnDef<Row>[];
  visible: string[];
  onToggle: (key: string) => void;
}) {
  const t = useTranslations();

  return (
    <div className="absolute end-0 top-full z-20 mt-2 w-[260px] rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-lg">
      <p className="mb-2 text-micro font-medium text-muted">{t("common.columns")}</p>
      <ul className="flex flex-col gap-1.5">
        {columns.map((column) => (
          <li key={column.key} className="flex items-center justify-between gap-2">
            <Checkbox
              label={t(column.labelKey)}
              checked={visible.includes(column.key)}
              onChange={() => onToggle(column.key)}
            />
            {column.permission ? (
              <span className="text-micro text-muted">{column.permission}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
