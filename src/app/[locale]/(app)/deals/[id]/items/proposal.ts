/**
 * What a reading of a source hands back to the table on screen 73.
 *
 * Its own file because the two halves cannot import from each other: the
 * actions file is `"use server"` and may export nothing but async functions,
 * and the table is `"use client"`. A shared type module is the seam.
 *
 * Everything here is a PROPOSAL. It lands in the table as rows a person can
 * change or delete, and nothing reaches `deal_line` until they press save.
 */
export type ProposedRow = {
  reference: string;
  designation: string;
  qty: string;
  unit: string;
};

export type Proposal =
  | {
      ok: true;
      /** The file's name, or the message's subject. Shown as what was read. */
      label: string;
      rows: ProposedRow[];
      /** How many lines the reader could make nothing of. Never hidden. */
      ignored: number;
    }
  | { ok: false; reason: string; detail?: string };
