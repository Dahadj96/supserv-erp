"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { CAPTURE_MODES, type CaptureMode, type FieldState, type Reading } from "@/capture/reading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/domain/money";
import { readAction, saveAction } from "./actions";

/**
 * Screen 61 — the box, and the card underneath it.
 *
 * The card appears while you type because the whole promise of the screen is
 * fifteen seconds. It is redrawn from the SERVER's reading, not from anything
 * guessed here: a browser that decided on its own that an address belonged to
 * URBACON would be a second, worse implementation of `resolveSender`, and the
 * two would disagree on the day it mattered.
 *
 * The pause before reading is 500ms. Short enough that the card feels attached
 * to the box, long enough that pasting a forty-line email is one lookup.
 */

const PAUSE_MS = 500;

const TONE: Record<FieldState, "good" | "warning" | "neutral" | "accent"> = {
  matched: "good",
  auto: "accent",
  suggested: "accent",
  safe: "good",
  unknown: "warning",
  none: "neutral",
};

export function CaptureBox({ locale }: { locale: string }) {
  const t = useTranslations();
  const [mode, setMode] = useState<CaptureMode>("email");
  const [text, setText] = useState("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [reading_, startReading] = useTransition();
  const [saving, startSaving] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length === 0) {
      setReading(null);
      return;
    }
    timer.current = setTimeout(() => {
      startReading(async () => setReading(await readAction(mode, text)));
    }, PAUSE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mode, text]);

  const busy = reading_ || saving;
  const canSave = reading !== null && !reading.tooThin && reading.writes.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {CAPTURE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-full border px-4 py-1.5 text-tiny transition-colors ${
              mode === m
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-secondary hover:border-line-strong"
            }`}
          >
            {t(`capture.mode.${m}`)}
          </button>
        ))}
      </div>

      {/*
        A file and a photo do not belong in a textarea, and the honest thing is
        to say where they DO go rather than draw a drop zone that discards them.
        Screens 39 and 41 already read files; this hands over to them.
      */}
      {mode === "file" || mode === "photo" ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-6">
          <p className="text-tiny text-ink">{t(`capture.handOff.${mode}.what`)}</p>
          <p className="mt-1 text-micro leading-relaxed text-muted">
            {t(`capture.handOff.${mode}.why`)}
          </p>
          <a
            href={`/${locale}/inbox/${mode === "photo" ? "scan" : "dossier"}`}
            className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
          >
            {t(`capture.handOff.${mode}.go`)}
          </a>
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={t(`capture.placeholder.${mode}`)}
          className="w-full rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-5 text-tiny leading-relaxed text-ink outline-none placeholder:text-muted focus:border-ink"
        />
      )}

      {reading && (mode === "email" || mode === "phone" || mode === "typed") ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("capture.understood")}</h2>
            <span className="ms-auto text-micro text-muted">
              {reading_ ? t("capture.reading") : t("capture.changeAnything")}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4">
            {reading.fields.map((field) => (
              <div key={field.key}>
                <p className="text-micro text-secondary">{t(`capture.field.${field.key}`)}</p>
                <div className="mt-1 flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-plane px-3 py-2">
                  <p className="min-w-0 flex-1 truncate text-tiny text-ink">
                    {t(`capture.${field.labelKey}`, {
                      ...valuesFor(field.values),
                      money: field.money
                        ? formatMoney(field.money.amount, field.money.currency, locale)
                        : "",
                    })}
                  </p>
                  <Badge tone={TONE[field.state]}>
                    {field.confidence !== null
                      ? `${Math.round(field.confidence * 100)}%`
                      : t(`capture.state.${field.state}`)}
                  </Badge>
                </div>
                {field.caveatKey ? (
                  <p className="mt-1 text-micro leading-relaxed text-muted">
                    {t(`capture.caveat.${field.caveatKey}`)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 border-t border-line-subtle px-5 py-3.5">
            <p className="text-micro text-muted">{t("capture.nothingUntilButton")}</p>
            <div className="ms-auto flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setText("");
                  setReading(null);
                }}
              >
                {t("capture.discard")}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!canSave || busy}
                onClick={() => startSaving(async () => saveAction(locale, mode, text))}
              >
                {saving ? t("capture.saving") : t("capture.save")}
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The values a proposal pulled out of the text, positionally.
 *
 * ICU wants named arguments, and these are ordered, so they are named by their
 * position: `{v0}`, `{v1}`. Ugly, and better than the alternative — which is a
 * different message key per field shape, and a `t.has()` guard around each.
 */
function valuesFor(values: string[]): Record<string, string> {
  return Object.fromEntries(values.map((v, i) => [`v${i}`, v]));
}
