"use client";

import { ChevronDown, ChevronUp, FileText, Mail, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { Button } from "@/components/ui/button";
import type { LineSource } from "@/domain/deal/sources";
import { readPasteAction, readSourceAction } from "./actions";
import type { Proposal, ProposedRow } from "./proposal";

/**
 * Screen 73 — the item table.
 *
 * WHAT THIS REPLACED, and why it had to go: one textarea holding the whole list
 * as tab-separated text. Every complaint about it was correct. A quantity could
 * not be corrected without editing a monospace blob and hoping the tabs stayed
 * where they were; a line could not be deleted except by deleting its text; and
 * saving REPLACED every row, so the shop-counter price captured against line 3
 * on Tuesday was cut loose because line 5's unit was wrong.
 *
 * Now each field is a field. A row carries the `deal_line` it already is, so a
 * corrected quantity is an UPDATE and everything hanging off that line stays
 * hanging off it.
 *
 * The paste box is still here, below the table, because pasting fourteen lines
 * out of an email is still the fastest thing in the world when the client typed
 * them. It now ADDS to the table instead of replacing it, and what it adds is
 * rows a person can then fix.
 */

export type EditorRow = {
  id: string | null;
  reference: string;
  designation: string;
  qty: string;
  unit: string;
};

type Row = EditorRow & { key: number };

const blank = (key: number): Row => ({
  key,
  id: null,
  reference: "",
  designation: "",
  qty: "1",
  unit: "",
});

/** What the last read said. Cleared when another one starts. */
type Notice =
  | { tone: "good"; label: string; added: number; ignored: number }
  | { tone: "bad"; reason: string; detail?: string };

export function LinesEditor({
  dealId,
  initial,
  sources,
  closed,
  action,
}: {
  dealId: string;
  initial: EditorRow[];
  sources: LineSource[];
  /** The enquiry is lost. The table is shown and nothing may be changed. */
  closed: boolean;
  action: (form: FormData) => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<Row[]>(initial.map((row, i) => ({ ...row, key: i + 1 })));
  const [next, setNext] = useState(initial.length + 1);
  const [paste, setPaste] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startReading] = useTransition();

  const set = (key: number, field: keyof EditorRow, value: string) =>
    setRows((all) => all.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  const move = (index: number, by: number) =>
    setRows((all) => {
      const to = index + by;
      if (to < 0 || to >= all.length) return all;
      const copy = [...all];
      const [row] = copy.splice(index, 1);
      if (row) copy.splice(to, 0, row);
      return copy;
    });

  /** Proposed rows are APPENDED. Nothing already in the table is touched. */
  const absorb = (proposal: Proposal) => {
    if (!proposal.ok) {
      setNotice({ tone: "bad", reason: proposal.reason, detail: proposal.detail });
      return;
    }
    setRows((all) => [
      ...all,
      ...proposal.rows.map((row: ProposedRow, i) => ({ ...row, id: null, key: next + i })),
    ]);
    setNext((n) => n + proposal.rows.length);
    setNotice({
      tone: "good",
      label: proposal.label,
      added: proposal.rows.length,
      ignored: proposal.ignored,
    });
  };

  const read = (key: string) => {
    setNotice(null);
    startReading(async () => {
      absorb(await readSourceAction(dealId, key));
    });
  };

  const readPaste = () => {
    if (!paste.trim()) return;
    setNotice(null);
    startReading(async () => {
      const proposal = await readPasteAction(dealId, paste);
      absorb(proposal);
      if (proposal.ok) setPaste("");
    });
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-tiny font-semibold text-ink">{t("dealItems.current")}</h2>
          <span className="ms-auto text-micro text-muted">
            {t("dealItems.lineCount", { count: rows.length })}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-6 text-tiny text-muted">{t("dealItems.noLines")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="w-[40px] py-2 ps-4 text-start font-medium">#</th>
                  <th className="w-[150px] py-2 pe-2 text-start font-medium">
                    {t("dealItems.column.reference")}
                  </th>
                  <th className="min-w-[240px] py-2 pe-2 text-start font-medium">
                    {t("dealItems.column.designation")}
                  </th>
                  <th className="w-[92px] py-2 pe-2 text-end font-medium">
                    {t("dealItems.column.qty")}
                  </th>
                  <th className="w-[80px] py-2 pe-2 text-start font-medium">
                    {t("dealItems.column.unit")}
                  </th>
                  <th className="w-[76px] py-2 pe-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-b border-line-subtle last:border-0">
                    {/* The row it already is, so saving updates rather than
                        replaces. Empty for a row somebody just added. */}
                    <input type="hidden" name="lineId" value={row.id ?? ""} />

                    <td className="py-1.5 ps-4 text-micro tabular-nums text-muted">{index + 1}</td>
                    <td className="py-1.5 pe-2">
                      <input
                        name="reference"
                        value={row.reference}
                        readOnly={closed}
                        onChange={(e) => set(row.key, "reference", e.target.value)}
                        placeholder={t("dealItems.referencePlaceholder")}
                        className={`${INPUT} w-full font-mono text-micro`}
                      />
                    </td>
                    <td className="py-1.5 pe-2">
                      <input
                        name="designation"
                        value={row.designation}
                        readOnly={closed}
                        onChange={(e) => set(row.key, "designation", e.target.value)}
                        className={`${INPUT} w-full`}
                      />
                    </td>
                    <td className="py-1.5 pe-2">
                      <input
                        name="qty"
                        type="number"
                        step="0.001"
                        min="0"
                        value={row.qty}
                        readOnly={closed}
                        onChange={(e) => set(row.key, "qty", e.target.value)}
                        className={`${INPUT} w-full text-end`}
                      />
                    </td>
                    <td className="py-1.5 pe-2">
                      <input
                        name="unit"
                        value={row.unit}
                        readOnly={closed}
                        onChange={(e) => set(row.key, "unit", e.target.value)}
                        className={`${INPUT} w-full`}
                      />
                    </td>
                    <td className="py-1.5 pe-4">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          aria-label={t("dealItems.moveUp")}
                          onClick={() => move(index, -1)}
                          className="text-muted hover:text-ink"
                        >
                          <ChevronUp className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={t("dealItems.moveDown")}
                          onClick={() => move(index, 1)}
                          className="text-muted hover:text-ink"
                        >
                          <ChevronDown className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={t("dealItems.removeLine")}
                          onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                          className="text-muted hover:text-critical-ink"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-5 py-3">
          <Button
            variant="secondary"
            size="small"
            icon={<Plus className="size-3.5" aria-hidden />}
            disabledReason={closed ? t("dealItems.error.closed") : undefined}
            onClick={() => {
              setRows((all) => [...all, blank(next)]);
              setNext((n) => n + 1);
            }}
          >
            {t("dealItems.addLine")}
          </Button>
          <div className="ms-auto">
            <Button
              type="submit"
              variant="primary"
              size="small"
              disabledReason={closed ? t("dealItems.error.closed") : undefined}
            >
              {t("dealItems.save")}
            </Button>
          </div>
        </div>
      </section>

      <Reading
        sources={sources}
        closed={closed}
        busy={busy}
        notice={notice}
        paste={paste}
        setPaste={setPaste}
        onRead={read}
        onReadPaste={readPaste}
      />
    </form>
  );
}

/**
 * Where the list can be read from — the client's own email and the files they
 * attached, each a button that reads it now.
 *
 * A source that cannot be read is LISTED and disabled with its reason, never
 * hidden. A person hunting for the bordereau needs to see that the ERP knows
 * `demande.jpg` is there and cannot open a photograph, rather than wondering
 * whether the file arrived at all.
 */
function Reading({
  sources,
  closed,
  busy,
  notice,
  paste,
  setPaste,
  onRead,
  onReadPaste,
}: {
  sources: LineSource[];
  closed: boolean;
  busy: boolean;
  notice: Notice | null;
  paste: string;
  setPaste: (value: string) => void;
  onRead: (key: string) => void;
  onReadPaste: () => void;
}) {
  const t = useTranslations();

  const why = (source: LineSource): string | undefined => {
    if (closed) return t("dealItems.error.closed");
    if (busy) return t("dealItems.reading");
    if (source.state === "notReadable") {
      return t("dealItems.cannotRead", { kind: source.detail ?? "" });
    }
    return undefined;
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 className="text-tiny font-semibold text-ink">{t("dealItems.readFrom")}</h2>
        <span className="ms-auto text-micro text-muted">{t("dealItems.readFromHint")}</span>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {sources.length === 0 ? (
          <p className="text-micro leading-relaxed text-muted">{t("dealItems.noSources")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <Button
                key={source.key}
                variant="secondary"
                size="small"
                icon={
                  source.kind === "body" ? (
                    <Mail className="size-3.5" aria-hidden />
                  ) : (
                    <FileText className="size-3.5" aria-hidden />
                  )
                }
                disabledReason={why(source)}
                onClick={() => onRead(source.key)}
              >
                {source.kind === "body" ? t("dealItems.theEmail") : source.label}
              </Button>
            ))}
          </div>
        )}

        {notice ? (
          <p
            className={`rounded-[var(--radius-control)] px-3 py-2 text-micro leading-relaxed ${
              notice.tone === "good"
                ? "bg-good-bg text-good-ink"
                : "bg-critical-bg text-critical-ink"
            }`}
          >
            {notice.tone === "good"
              ? notice.label
                ? t("dealItems.readAdded", {
                    count: notice.added,
                    label: notice.label,
                    ignored: notice.ignored,
                  })
                : t("dealItems.pasteAdded", { count: notice.added, ignored: notice.ignored })
              : t.has(`dealItems.error.${notice.reason}`)
                ? t(`dealItems.error.${notice.reason}`)
                : notice.reason}
            {notice.tone === "bad" && notice.detail ? ` (${notice.detail})` : null}
          </p>
        ) : null}

        <div>
          <label className="text-micro text-secondary" htmlFor="paste">
            {t("dealItems.pasteLabel")}
          </label>
          {/*
            No `name`: this box is not part of the save. Its text is read by the
            SERVER, on demand, and what comes back are rows in the table above.
            A textarea that posted alongside the table would give the save two
            versions of the list to reconcile.
          */}
          <textarea
            id="paste"
            rows={6}
            value={paste}
            readOnly={closed}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={t("dealItems.pastePlaceholder")}
            className={`${INPUT} mt-1 h-auto py-2 font-mono text-micro`}
          />
          <div className="mt-2">
            <Button
              variant="secondary"
              size="small"
              disabledReason={
                closed
                  ? t("dealItems.error.closed")
                  : busy
                    ? t("dealItems.reading")
                    : paste.trim()
                      ? undefined
                      : t("dealItems.pasteEmpty")
              }
              onClick={onReadPaste}
            >
              {t("dealItems.readPaste")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
