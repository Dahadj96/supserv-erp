"use client";

import { useTranslations } from "next-intl";
import type { BulkAction, ColumnDef, FilterField, SavedView } from "@/components/data";
import { DataTable, downloadCsv, toCsv } from "@/components/data";
import { Badge } from "@/components/ui/badge";
import { RowDelete, type RowDeleteDescription } from "@/components/ui/row-delete";

export type DealRow = {
  id: string;
  reference: string;
  client: string;
  subject: string;
  value: string | null;
  deadline: string | null;
  /** Inside 48 hours AND still live. A closed deal's deadline is never red. */
  deadlineUrgent: boolean;
  /** Already translated — it is `badgeOf()`, so it may be a stage or an outcome. */
  stage: string;
  stageKey: string;
  owner: string | null;
};

/**
 * The badge tone per stage and outcome.
 *
 * Won is green and lost is red, which is obvious. The one worth explaining is
 * `noBid`: it is neutral, not red. Walking away from a consultation you cannot
 * win on time is a good decision, and a list that scolds people for making it
 * teaches them to leave enquiries open instead — which is how twelve of them
 * expired unread.
 */
const TONE: Record<string, "good" | "warning" | "critical" | "neutral" | "accent"> = {
  new: "accent",
  qualifying: "neutral",
  sourcing: "warning",
  offerOut: "accent",
  ordered: "good",
  invoiced: "good",
  won: "good",
  lost: "critical",
  noBid: "neutral",
};

const COLUMNS: ColumnDef<DealRow>[] = [
  { key: "reference", labelKey: "deals.reference", render: (r) => r.reference, sortable: true },
  { key: "client", labelKey: "deals.client", render: (r) => r.client, sortable: true },
  { key: "subject", labelKey: "deals.subject", render: (r) => r.subject },
  {
    key: "value",
    labelKey: "deals.value",
    render: (r) => r.value ?? "—",
    align: "end",
    sortable: true,
  },
  {
    key: "deadline",
    labelKey: "deals.deadline",
    render: (r) =>
      r.deadline ? (
        <span className={r.deadlineUrgent ? "font-medium text-critical-ink" : undefined}>
          {r.deadline}
        </span>
      ) : (
        "—"
      ),
    sortable: true,
  },
  {
    key: "stage",
    labelKey: "deals.stage",
    render: (r) => <Badge tone={TONE[r.stageKey] ?? "neutral"}>{r.stage}</Badge>,
  },
  { key: "owner", labelKey: "deals.owner", render: (r) => r.owner ?? "—" },
  // Listed but off by default; a permission greys it, it is never hidden.
  {
    key: "margin",
    labelKey: "deals.margin",
    render: () => "—",
    permission: "offers.margin.view",
    optional: true,
    align: "end",
  },
];

const FILTERS: FilterField[] = [
  {
    key: "stage",
    labelKey: "deals.filters.stage",
    kind: "multiselect",
    hintKey: "deals.filters.stageHint",
    options: [
      { value: "new", labelKey: "deals.filters.new" },
      { value: "qualifying", labelKey: "deals.filters.qualifying" },
      { value: "sourcing", labelKey: "deals.filters.sourcing" },
      { value: "offerOut", labelKey: "deals.filters.offerOut" },
      { value: "ordered", labelKey: "deals.filters.ordered" },
      { value: "invoiced", labelKey: "deals.filters.invoiced" },
    ],
  },
  {
    key: "owner",
    labelKey: "deals.filters.owner",
    kind: "select",
    hintKey: "deals.filters.ownerHint",
    options: [
      { value: "me", labelKey: "deals.filters.mine" },
      { value: "anyone", labelKey: "deals.filters.anyone" },
    ],
  },
];

/**
 * A saved view is a named question, not a query. These two ship with the app,
 * so their names are translated; views a person creates keep the language they
 * were typed in and are never auto-translated (LAW 4).
 */
const SEED_VIEWS: (Omit<SavedView, "name" | "question"> & {
  nameKey: string;
  questionKey: string;
})[] = [
  {
    id: "closing-this-week",
    nameKey: "deals.views.closingThisWeek",
    questionKey: "deals.views.closingThisWeekAsks",
    filter: { stage: ["offerOut"] },
    shared: true,
    isDefault: false,
  },
  {
    id: "nothing-sent-yet",
    nameKey: "deals.views.nothingSentYet",
    questionKey: "deals.views.nothingSentYetAsks",
    filter: { stage: ["new", "qualifying"] },
    shared: false,
    isDefault: false,
  },
];

/**
 * Only what is safe in bulk. No send, issue, cancel or delete — ever, and
 * `bulk-bar.tsx` says why.
 *
 * Three of the four that used to be here had `run: () => {}`. Ticking rows put
 * the bar on screen and pressing them did nothing, silently, which is the one
 * thing worse than the button not being there. They are gone rather than
 * stubbed, and each for its own reason:
 *
 *  - **Add a tag** — there is no tag. No table, no column, nothing to write.
 *  - **Mark waiting on** — screen 58 is computed. `src/domain/waiting/gather.ts`
 *    reads silences that already exist — a sourcing request with no response, an
 *    invoice with a balance, a bon de livraison with no signed copy back — and
 *    stores nothing. A deal has no waiting flag to set, and adding one would be
 *    a stored state that time changes (LAW 1). The honest answer is that this
 *    label promised something the design deliberately does not do.
 *  - **Assign to** — `deal.owner_id` is real, so this one is buildable, but not
 *    from a bar of plain buttons: assigning needs a person to pick a person, a
 *    server action and a permission. It returns with that, not before.
 *
 * Export stays, and now exports.
 */
const bulkActions = (t: (key: string) => string): BulkAction<DealRow>[] => [
  {
    key: "export",
    labelKey: "list.export",
    run: (_ids, { rows, columns }) => {
      // Not translated, and dated rather than timestamped: two people exporting
      // the same list on the same day should recognise each other's file in a
      // shared folder.
      const day = new Date().toISOString().slice(0, 10);
      downloadCsv(`deals-${day}.csv`, toCsv(rows, columns, t));
    },
  },
];

export function DealsList({
  rows,
  total,
  describeDiscard,
  discard,
}: {
  rows: DealRow[];
  total: number;
  /*
    V2 — the two halves of removing one row, handed in as server actions so
    this stays a client component and the list does not learn about the domain.

    `describeDiscard` is asked when the panel OPENS, not once per row: drawing
    a hundred trash icons must not cost a hundred count queries.
  */
  describeDiscard: (id: string) => Promise<RowDeleteDescription>;
  discard: (id: string, form: FormData) => void;
}) {
  const t = useTranslations();

  const views: SavedView[] = SEED_VIEWS.map(({ nameKey, questionKey, ...rest }) => ({
    ...rest,
    name: t(nameKey),
    question: t(questionKey),
  }));

  return (
    <DataTable
      rows={rows}
      total={total}
      columns={COLUMNS}
      filterFields={FILTERS}
      savedViews={views}
      bulkActions={bulkActions((key) => t(key))}
      getRowHref={(row) => `/deals/${row.id}`}
      /*
        The bulk bar still refuses deletion and always will — see the note above
        `bulkActions`. This is the other thing, and the thing the note was
        asking for: one record, from the row somebody is looking at, with a
        confirmation that names what goes with it.
      */
      rowAction={(row) => (
        <RowDelete
          label={row.reference}
          what={t("rowDelete.what.deal")}
          describe={() => describeDiscard(row.id)}
          action={discard.bind(null, row.id)}
        />
      )}
      emptyState={
        <>
          <h2 className="text-lead font-semibold text-ink">{t("empty.noDealsTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[420px] text-tiny leading-relaxed text-secondary">
            {t("empty.noDealsBody")}
          </p>
        </>
      }
    />
  );
}
