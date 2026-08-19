"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkBar } from "./bulk-bar";
import { ColumnsMenu } from "./columns-menu";
import { FilterPanel } from "./filter-panel";
import { Pagination } from "./pagination";
import { SavedViews } from "./saved-views";
import type { BulkAction, ColumnDef, FilterField, SavedView } from "./types";
import { useListState } from "./use-list-state";

/**
 * Screen 79. THE list. Ten screens share it — before building any list screen,
 * use this one. Do not write a second table.
 */
export function DataTable<Row extends { id: string }>({
  rows,
  total,
  columns,
  filterFields = [],
  savedViews = [],
  bulkActions = [],
  emptyState,
  getRowHref,
}: {
  rows: Row[];
  /** Unfiltered total. The count always shows both. */
  total: number;
  columns: ColumnDef<Row>[];
  filterFields?: FilterField[];
  savedViews?: SavedView[];
  bulkActions?: BulkAction[];
  emptyState: ReactNode;
  getRowHref?: (row: Row) => string;
}) {
  const t = useTranslations();
  const list = useListState();
  const [panel, setPanel] = useState<"filters" | "columns" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [visible, setVisible] = useState(columns.filter((c) => !c.optional).map((c) => c.key));

  const shownColumns = useMemo(
    () => columns.filter((c) => visible.includes(c.key)),
    [columns, visible],
  );
  const isFiltered = Object.values(list.filter).some((v) => v.length > 0);
  const allTicked = rows.length > 0 && selected.length === rows.length;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-7 py-3">
        <SavedViews
          views={savedViews}
          activeId={activeView}
          onSelect={(filter, id) => {
            list.setFilter(filter);
            setActiveView(id);
          }}
        />
        <div className="relative ms-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => setPanel(panel === "filters" ? null : "filters")}
          >
            {t("common.filters")}
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setPanel(panel === "columns" ? null : "columns")}
          >
            {t("common.columns")}
          </Button>
          {panel === "filters" ? (
            <FilterPanel
              fields={filterFields}
              value={list.filter}
              matched={rows.length}
              total={total}
              onApply={(next) => {
                list.setFilter(next);
                setActiveView(null);
              }}
              onClose={() => setPanel(null)}
            />
          ) : null}
          {panel === "columns" ? (
            <ColumnsMenu
              columns={columns}
              visible={visible}
              onToggle={(key) =>
                setVisible((prev) =>
                  prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                )
              }
            />
          ) : null}
        </div>
      </div>

      <div className="mx-7 min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-line bg-surface">
        {rows.length === 0 ? (
          <div className="px-6 py-14 text-center">{emptyState}</div>
        ) : (
          <table className="w-full border-collapse text-tiny">
            <thead>
              <tr className="border-b border-line-subtle text-muted">
                <th className="w-9 px-3 py-2.5">
                  <Checkbox
                    checked={allTicked}
                    aria-label={t("list.selectAll")}
                    onChange={() => setSelected(allTicked ? [] : rows.map((r) => r.id))}
                  />
                </th>
                {shownColumns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-3 py-2.5 font-medium ${column.align === "end" ? "text-end" : "text-start"}`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-ink"
                        onClick={() =>
                          list.setSort(
                            list.sort?.key === column.key && list.sort.direction === "asc"
                              ? { key: column.key, direction: "desc" }
                              : { key: column.key, direction: "asc" },
                          )
                        }
                      >
                        {t(column.labelKey)}
                        {list.sort?.key === column.key ? (
                          list.sort.direction === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden />
                          )
                        ) : null}
                      </button>
                    ) : (
                      t(column.labelKey)
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line-subtle last:border-0 hover:bg-plane"
                >
                  <td className="px-3 py-2.5">
                    <Checkbox
                      checked={selected.includes(row.id)}
                      onChange={() =>
                        setSelected((prev) =>
                          prev.includes(row.id)
                            ? prev.filter((id) => id !== row.id)
                            : [...prev, row.id],
                        )
                      }
                    />
                  </td>
                  {shownColumns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2.5 text-ink ${column.align === "end" ? "text-end" : "text-start"}`}
                    >
                      {getRowHref && column === shownColumns[0] ? (
                        <a href={getRowHref(row)} className="font-medium hover:underline">
                          {column.render(row)}
                        </a>
                      ) : (
                        column.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <BulkBar selectedIds={selected} actions={bulkActions} onClear={() => setSelected([])} />

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        shown={rows.length}
        total={total}
        filtered={isFiltered}
        onPage={list.setPage}
        onPageSize={list.setPageSize}
      />
    </section>
  );
}
