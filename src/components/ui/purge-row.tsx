"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * V3 — delete forever, typed out in full.
 *
 * The bin's other button is Restore, which is free. This one cannot be undone
 * by anybody, so it is deliberately awkward: it opens, it says what is about to
 * happen in the plainest sentence available, and it will not enable its own
 * button until the person has typed the record's own name back.
 *
 * Typing the name rather than the word "delete" is the point. "Delete" can be
 * typed without reading anything; "ENQ-2026-0004" cannot be typed unless you
 * have looked at which row you are standing on, and looking at which row you
 * are standing on is the entire safety mechanism.
 */
export function PurgeRow({
  label,
  what,
  action,
  disabledReason,
}: {
  /** The exact text that has to be typed back. */
  label: string;
  /** "this enquiry", "this company" — for the sentence. */
  what: string;
  action: (form: FormData) => void;
  disabledReason?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const box = useRef<HTMLInputElement>(null);

  // Focused when the confirmation opens, not with `autoFocus` — the attribute
  // grabs focus on first paint of the page, which is not the same act.
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);
  const matches = typed.trim() === label.trim();

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="small"
        className="text-critical-ink"
        disabledReason={disabledReason}
        onClick={() => setOpen(true)}
      >
        {t("bin.purge.open")}
      </Button>
    );
  }

  return (
    <form
      action={action}
      onSubmit={() => setOpen(false)}
      className="flex flex-col items-end gap-2 rounded-[var(--radius-control)] bg-critical-bg p-2.5"
    >
      <p className="text-micro leading-relaxed text-critical-ink">
        {t("bin.purge.warning", { what })}
      </p>
      <label className="w-full">
        <span className="text-micro text-critical-ink">{t("bin.purge.typeItBack", { label })}</span>
        <input
          name="confirm"
          ref={box}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
          className="mt-1 h-[28px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 font-mono text-micro outline-none focus:border-critical"
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          {t("bin.purge.cancel")}
        </Button>
        <Button
          type="submit"
          variant="danger"
          size="small"
          // The server checks this too. This is the courtesy; that is the rule.
          disabledReason={matches ? undefined : t("bin.purge.typeItFirst")}
        >
          {t("bin.purge.confirm")}
        </Button>
      </div>
    </form>
  );
}
