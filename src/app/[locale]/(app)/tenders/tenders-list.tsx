"use client";

import type { ReactNode } from "react";
import type { ColumnDef } from "@/components/data";
import { DataTable } from "@/components/data";
import { Badge } from "@/components/ui/badge";

/**
 * Screen 07's rows, on the shared table — task 3.6, the first of four.
 *
 * EVERY FIELD HERE IS ALREADY FORMATTED. The row that crosses from the server
 * is flat, serialisable and decided: a date is the string that will be printed,
 * a badge is a tone and a label rather than a rule about a deadline. That is
 * the same shape `deals-list.tsx` takes and it is deliberate — the formatter
 * and the deadline arithmetic live on the server where the locale and
 * `deadlineDisplay` already are, and a client component that recomputed either
 * would be a second opinion about what "closing soon" means.
 *
 * The facet chips stay on the page above this rather than becoming
 * `filterFields`. They are counted server-side by `tenderCounts`, they are in
 * the URL, and a filter panel that answered the same question a different way
 * would be two controls competing over one list.
 */

export type TenderListRow = {
  id: string;
  /** Their reference, not ours: the one on the envelope and in every email. */
  reference: string;
  authority: string;
  object: string;
  procedure: string;
  procedureLabel: string;
  /** True for an AONR or an AOO — a public procedure rather than a private one. */
  procedureFormal: boolean;
  submission: string;
  caution: string;
  percent: number;
  blocking: number;
  /** What the last column prints, already decided by the server. */
  closes: { kind: "submitted" | "closed" | "none" | "at"; label: string; urgent: boolean };
};

const CLOSES_TONE = { submitted: "good", closed: "neutral", at: "warning" } as const;

const COLUMNS: ColumnDef<TenderListRow>[] = [
  {
    key: "reference",
    labelKey: "tenders.column.ref",
    render: (r) => r.reference,
    sortable: true,
  },
  { key: "authority", labelKey: "tenders.column.authority", render: (r) => r.authority },
  {
    key: "object",
    labelKey: "tenders.column.object",
    render: (r) => <span className="block max-w-[280px] truncate">{r.object}</span>,
  },
  {
    key: "procedure",
    labelKey: "tenders.column.procedure",
    render: (r) => (
      <Badge tone={r.procedureFormal ? "neutral" : "accent"}>{r.procedureLabel}</Badge>
    ),
  },
  {
    key: "submission",
    labelKey: "tenders.column.submission",
    render: (r) => r.submission,
    // Off by default. It matters on the day and it is the column somebody
    // scrolls past on every other day; the columns menu is where it lives.
    optional: true,
  },
  {
    key: "caution",
    labelKey: "tenders.column.caution",
    align: "end",
    render: (r) => <span className="tabular-nums">{r.caution}</span>,
  },
  {
    key: "dossier",
    labelKey: "tenders.column.dossier",
    render: (r) => (
      <div className="flex items-center gap-2">
        {/*
          The bar is computed on every draw from the pieces and the company's
          papers — there is no stored percentage, for the same reason there is
          no stored stage. A folder that was 100% in July is not 100% in
          September when the CASNOS attestation has expired in between.
        */}
        <span className="h-1.5 w-[70px] overflow-hidden rounded-full bg-line" aria-hidden>
          <span
            className={`block h-full rounded-full ${
              r.blocking > 0 ? "bg-critical" : r.percent === 100 ? "bg-good" : "bg-warning"
            }`}
            style={{ width: `${r.percent}%` }}
          />
        </span>
        <span className="tabular-nums text-micro text-secondary">{r.percent}%</span>
      </div>
    ),
  },
  {
    key: "closes",
    labelKey: "tenders.column.closes",
    sortable: true,
    render: (r) =>
      r.closes.kind === "none" ? (
        <span className="text-micro text-muted">{r.closes.label}</span>
      ) : (
        <Badge tone={r.closes.urgent ? "critical" : CLOSES_TONE[r.closes.kind]}>
          {r.closes.label}
        </Badge>
      ),
  },
];

export function TendersList({
  rows,
  total,
  emptyState,
}: {
  rows: TenderListRow[];
  total: number;
  /**
   * Screen 07's own `StateBlock` (task 3.2), rendered on the server and passed
   * in rather than rebuilt here — it is the same block with the same button,
   * and a second copy is how the two come to say different things.
   */
  emptyState: ReactNode;
}) {
  return (
    <DataTable
      rows={rows}
      total={total}
      columns={COLUMNS}
      getRowHref={(row) => `/tenders/${row.id}`}
      emptyState={emptyState}
    />
  );
}
