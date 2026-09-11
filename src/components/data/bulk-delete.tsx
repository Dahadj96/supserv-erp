"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * Bulk delete, asked for by the owner on 11 September 2026.
 *
 * `bulk-bar.tsx` has said since screen 79 was drawn not to put delete here, and
 * the reason it gave was that deletion could not be undone. That stopped being
 * true: V1 made a discard take its work with it and give it all back, V2 made
 * every removal say what it takes, and V3 made the bin a real bin with a
 * separate, Gérant-only, one-at-a-time way to finish. Fifty reversible acts
 * are not more dangerous than one, so the rule's premise went and the button
 * arrives. Send, issue and cancel stay absent for ever — those DO leave the
 * building.
 *
 * WHAT MAKES IT SAFE IS NOT THE CONFIRMATION. It is that the preview is
 * computed on the SERVER with the same guards the discard itself uses, and
 * that a refusal is never silent: the rows that cannot go are NAMED before
 * anybody presses the button, and named again afterwards. A bulk action that
 * quietly skips eleven of your fifty rows is worse than no bulk action, and
 * that is what the original rule was really protecting against.
 */

export type BulkDeletePreview = {
  canGo: number;
  refused: { label: string; reason: string }[];
};

export function BulkDelete({
  ids,
  preview,
  run,
  onDone,
}: {
  ids: string[];
  /** Server action: what WOULD happen, with the same guards as the discard. */
  preview: (ids: string[]) => Promise<BulkDeletePreview>;
  /** Server action: do it. Reason comes from this form. */
  run: (ids: string[], form: FormData) => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<BulkDeletePreview | null>(null);
  const [asking, ask] = useTransition();
  const panel = useRef<HTMLDivElement>(null);
  const reason = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (open && seen && seen.canGo > 0) reason.current?.focus();
  }, [open, seen]);

  const start = () => {
    setOpen(true);
    setSeen(null);
    ask(async () => setSeen(await preview(ids)));
  };

  return (
    <span className="relative inline-flex" ref={panel}>
      <Button
        variant="ghost"
        size="small"
        className="text-on-ink hover:bg-critical"
        icon={<Trash2 className="size-3.5" aria-hidden />}
        onClick={start}
      >
        {t("list.bulkDelete")}
      </Button>

      {open ? (
        <div
          role="dialog"
          aria-label={t("list.bulkDeleteTitle", { count: ids.length })}
          className="absolute bottom-full end-0 z-20 mb-2 w-[380px] rounded-[var(--radius-card)] border border-line bg-surface p-4 text-start text-ink shadow-lg"
        >
          <p className="text-tiny font-medium">
            {t("list.bulkDeleteTitle", { count: ids.length })}
          </p>

          {asking || !seen ? (
            <p className="mt-3 flex items-center gap-2 text-micro text-muted">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("list.bulkChecking")}
            </p>
          ) : (
            <>
              {/* Named, not counted. "3 refused" is a sentence somebody then
                  has to go and investigate across fifty ticked rows. */}
              {seen.refused.length > 0 ? (
                <div className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-2.5 py-2">
                  <p className="text-micro font-medium text-critical-ink">
                    {t("list.bulkRefused", { count: seen.refused.length })}
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {seen.refused.slice(0, 6).map((r) => (
                      <li key={r.label} className="text-micro leading-relaxed text-critical-ink">
                        <span className="font-medium">{r.label}</span> —{" "}
                        {t.has(`list.bulkReason.${r.reason}`)
                          ? t(`list.bulkReason.${r.reason}`)
                          : r.reason}
                      </li>
                    ))}
                    {seen.refused.length > 6 ? (
                      <li className="text-micro text-critical-ink">
                        {t("list.bulkAndMore", { n: seen.refused.length - 6 })}
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {seen.canGo === 0 ? (
                <div className="mt-3 flex justify-end">
                  <Button variant="secondary" size="small" onClick={() => setOpen(false)}>
                    {t("rowDelete.close")}
                  </Button>
                </div>
              ) : (
                <form
                  action={run.bind(null, ids)}
                  onSubmit={() => {
                    setOpen(false);
                    onDone();
                  }}
                >
                  <p className="mt-3 rounded-[var(--radius-control)] bg-sunken px-2.5 py-2 text-micro leading-relaxed text-secondary">
                    {t("list.bulkWillGo", { count: seen.canGo })}
                  </p>
                  <label className="mt-3 block">
                    <span className="text-micro text-secondary">{t("rowDelete.reason")}</span>
                    <input
                      name="reason"
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
                      {t("list.bulkConfirm", { count: seen.canGo })}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      ) : null}
    </span>
  );
}
