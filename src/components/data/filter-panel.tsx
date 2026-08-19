"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { FilterField, FilterValue } from "./types";

/**
 * Screen 79. The panel opens OVER the list — it never navigates away, because
 * losing your place is how people stop trusting filters.
 *
 * AND between fields, OR inside one.
 */
export function FilterPanel({
  fields,
  value,
  matched,
  total,
  onApply,
  onClose,
}: {
  fields: FilterField[];
  value: FilterValue;
  /** How many rows the pending selection would match. */
  matched: number;
  total: number;
  onApply: (next: FilterValue) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [draft, setDraft] = useState<FilterValue>(value);

  const applied = Object.entries(draft).flatMap(([key, values]) =>
    values.map((v) => ({ key, value: v })),
  );

  function toggle(key: string, option: string) {
    setDraft((prev) => {
      const current = prev[key] ?? [];
      const next = current.includes(option)
        ? current.filter((v) => v !== option)
        : [...current, option];
      return { ...prev, [key]: next };
    });
  }

  return (
    <div className="absolute end-0 top-full z-20 mt-2 w-[420px] rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-lg">
      {applied.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-line-subtle pb-3">
          <span className="text-micro text-muted">{t("list.applied")}</span>
          {applied.map((chip) => (
            <button
              key={`${chip.key}:${chip.value}`}
              type="button"
              onClick={() => toggle(chip.key, chip.value)}
              className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-chip px-2 py-0.5 text-micro text-ink"
            >
              {chip.value}
              <X className="size-3" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDraft({})}
            className="ms-auto text-micro font-medium text-accent-ink"
          >
            {t("common.clearAll")}
          </button>
        </div>
      ) : null}

      <div className="flex max-h-[420px] flex-col gap-3.5 overflow-auto">
        {fields.map((field) => (
          <fieldset key={field.key}>
            <legend className="text-micro font-medium text-secondary">{t(field.labelKey)}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {(field.options ?? []).map((option) => (
                <Checkbox
                  key={option.value}
                  label={t(option.labelKey)}
                  checked={(draft[field.key] ?? []).includes(option.value)}
                  onChange={() => toggle(field.key, option.value)}
                />
              ))}
            </div>
            {field.hintKey ? (
              <p className="mt-1 text-micro text-muted">{t(field.hintKey)}</p>
            ) : null}
          </fieldset>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-line-subtle pt-3">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
        >
          {t("list.applyCount", { shown: matched, total })}
        </Button>
      </div>
    </div>
  );
}
