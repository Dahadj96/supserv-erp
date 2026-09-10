"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * V2 — a delete on the row, not only inside the record.
 *
 * `deals-list.tsx` refuses deletion in the BULK bar and is right to: "only what
 * is safe in bulk. No send, issue, cancel or delete — ever." That is a rule
 * about doing fifty at once, and it had been read as a rule about doing one.
 * The owner opened the deals list, saw no way to remove a row, and stopped —
 * `discardDocument` had the same shape, callable from the document's own page
 * and from nowhere else.
 *
 * So: one record at a time, from the row a person is actually looking at, with
 * its own confirmation. Which is exactly what the bulk-bar note asked for.
 *
 * THE CONFIRMATION IS NOT A SPEED BUMP. `describe` is a server action that
 * counts what the removal takes with it, asked when the panel opens rather
 * than for every row on the list, and the panel does not offer the button
 * until the answer is back. A confirmation that says "are you sure?" teaches
 * people to click through it; one that says "this takes 4 lines and 1 unissued
 * draft with it" is the only thing that ever stops the wrong one.
 *
 * When `describe` comes back refusing — an issued document, a person still on
 * a crew — the panel says so and shows no confirm button at all. The refusal
 * names the thing, because "it has 1 issued document" is a sentence somebody
 * then has to go and investigate.
 */

export type RowDeleteDescription = {
  /** What goes with it, in the reader's language. Already translated. */
  takes: string;
  /** Set when the removal will refuse. Already translated, and names the thing. */
  refusedBecause?: string;
};

export function RowDelete({
  label,
  what,
  describe,
  action,
  disabledReason,
}: {
  /** The record's own name — the reference or the number. Never a key. */
  label: string;
  /** "this enquiry" / "this invoice", for the question at the top. */
  what: string;
  describe: () => Promise<RowDeleteDescription>;
  /** The server action. It gets `reason` from this form and nothing else. */
  action: (form: FormData) => void;
  /** Refused before it is even asked — no permission. Greys the trash. */
  disabledReason?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [described, setDescribed] = useState<RowDeleteDescription | null>(null);
  const [asking, ask] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const reason = useRef<HTMLInputElement>(null);

  // Escape closes it, and so does clicking anywhere else. A panel that can only
  // be dismissed by its own Cancel button is a panel people submit to get rid of.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const away = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [open]);

  const start = () => {
    setOpen(true);
    setDescribed(null);
    ask(async () => setDescribed(await describe()));
  };

  // Once the answer is in and the form exists, put the cursor in it.
  useEffect(() => {
    if (open && described && !described.refusedBecause) reason.current?.focus();
  }, [open, described]);

  return (
    <span className="relative inline-flex" ref={panel}>
      <button
        type="button"
        aria-label={t("rowDelete.open", { what: label })}
        title={disabledReason ?? t("rowDelete.open", { what: label })}
        aria-disabled={disabledReason ? true : undefined}
        onClick={disabledReason ? undefined : start}
        // 24px target, not a 14px icon — the same rule the item table follows.
        // A delete control small enough to miss is one you hit by accident.
        className={`inline-flex size-6 items-center justify-center rounded-[var(--radius-control)] ${
          disabledReason
            ? "cursor-not-allowed text-disabled"
            : "text-muted hover:bg-critical-bg hover:text-critical-ink"
        }`}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("rowDelete.title", { what })}
          className="absolute end-0 top-full z-20 mt-1.5 w-[340px] rounded-[var(--radius-card)] border border-line bg-surface p-4 text-start shadow-sm"
        >
          <p className="text-tiny font-medium text-ink">{t("rowDelete.title", { what })}</p>
          <p className="mt-0.5 font-mono text-micro text-muted">{label}</p>

          {asking || !described ? (
            <p className="mt-3 flex items-center gap-2 text-micro text-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("rowDelete.working")}
            </p>
          ) : described.refusedBecause ? (
            <>
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-2.5 py-2 text-micro leading-relaxed text-critical-ink">
                {described.refusedBecause}
              </p>
              <div className="mt-3 flex justify-end">
                <Button variant="secondary" size="small" onClick={() => setOpen(false)}>
                  {t("rowDelete.close")}
                </Button>
              </div>
            </>
          ) : (
            <form action={action} onSubmit={() => setOpen(false)}>
              <p className="mt-3 rounded-[var(--radius-control)] bg-sunken px-2.5 py-2 text-micro leading-relaxed text-secondary">
                {described.takes}
              </p>
              <label className="mt-3 block">
                <span className="text-micro text-secondary">{t("rowDelete.reason")}</span>
                <input
                  name="reason"
                  // Focused when the panel opens rather than with `autoFocus`:
                  // the attribute steals focus on first paint, which is a
                  // different and worse thing than moving it into a dialog the
                  // person has just opened on purpose.
                  ref={reason}
                  className="mt-1 h-[30px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-micro outline-none focus:border-ink"
                />
              </label>
              <p className="mt-2 text-micro text-muted">{t("rowDelete.restorable")}</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => setOpen(false)}
                >
                  {t("rowDelete.cancel")}
                </Button>
                <Button type="submit" variant="danger" size="small">
                  {t("rowDelete.confirm")}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </span>
  );
}
