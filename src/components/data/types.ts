import type { ReactNode } from "react";

/**
 * Screen 79. The shared list. Ten screens use this and none of them writes a
 * second table — see CLAUDE.md, "reuse, never rebuild".
 *
 * Two rules from the screen are load-bearing and encoded here:
 *   1. The count always shows both. A filtered list that only shows 14 makes
 *      people believe 14 is all there is, so `total` is never optional.
 *   2. The filter lives in the address. State goes in the URL, so pasting the
 *      link shows the other person the same rows — if their permissions allow.
 */

export type ColumnDef<Row> = {
  key: string;
  /** i18n key, never a literal. */
  labelKey: string;
  render: (row: Row) => ReactNode;
  /** Columns a permission may grey out are still listed — never hidden. */
  permission?: string;
  sortable?: boolean;
  align?: "start" | "end";
  /** Off by default; the person turns it on in the columns menu. */
  optional?: boolean;
};

/** AND between fields, OR inside one. Stated on the screen, enforced here. */
export type FilterField = {
  key: string;
  labelKey: string;
  kind: "select" | "multiselect" | "text" | "range" | "date" | "boolean";
  options?: { value: string; labelKey: string }[];
  /** Shown under the field on screen 79 — the sentence that explains it. */
  hintKey?: string;
};

export type FilterValue = Record<string, string[]>;

export type SortSpec = { key: string; direction: "asc" | "desc" } | null;

/**
 * Only what is safe in bulk. Assign, tag, mark waiting, export — things you can
 * undo, or that change nothing a client will ever see. Send, issue, cancel and
 * delete are never here: anything that leaves the building or cannot be undone
 * happens one record at a time, with its own confirmation.
 */
export type BulkAction = {
  key: string;
  labelKey: string;
  run: (selectedIds: string[]) => void | Promise<void>;
};

export type SavedView = {
  id: string;
  name: string;
  /** What it asks, in words — a saved view is a named question, not a query. */
  question: string;
  filter: FilterValue;
  shared: boolean;
  isDefault: boolean;
};
