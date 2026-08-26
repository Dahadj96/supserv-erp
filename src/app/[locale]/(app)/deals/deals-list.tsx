"use client";

import { useTranslations } from "next-intl";
import type { BulkAction, ColumnDef, FilterField, SavedView } from "@/components/data";
import { DataTable } from "@/components/data";
import { Badge } from "@/components/ui/badge";

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

/** Only what is safe in bulk. No send, issue, cancel or delete — ever. */
const BULK: BulkAction[] = [
  { key: "assign", labelKey: "list.assignTo", run: () => {} },
  { key: "tag", labelKey: "list.addTag", run: () => {} },
  { key: "waiting", labelKey: "list.markWaiting", run: () => {} },
  { key: "export", labelKey: "list.export", run: () => {} },
];

export function DealsList({ rows, total }: { rows: DealRow[]; total: number }) {
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
      bulkActions={BULK}
      getRowHref={(row) => `/deals/${row.id}`}
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
