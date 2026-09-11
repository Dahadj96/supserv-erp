"use client";

import { useTranslations } from "next-intl";
import type { ColumnDef } from "@/components/data";
import { BulkDelete, type BulkDeletePreview, DataTable } from "@/components/data";

export type CompanyRow = {
  id: string;
  code: string;
  legalName: string;
  wilaya: string | null;
  nif: string | null;
  docLocale: string;
};

const COLUMNS: ColumnDef<CompanyRow>[] = [
  { key: "code", labelKey: "companies.code", render: (r) => r.code, sortable: true },
  { key: "legalName", labelKey: "companies.legalName", render: (r) => r.legalName, sortable: true },
  { key: "wilaya", labelKey: "companies.wilaya", render: (r) => r.wilaya ?? "—" },
  {
    key: "nif",
    labelKey: "companies.nif",
    // No NIF, no invoice — décret 05-468. Shown here so the gap is visible
    // before somebody tries to issue against it.
    render: (r) => r.nif ?? "—",
  },
  { key: "docLocale", labelKey: "companies.docLocale", render: (r) => r.docLocale.toUpperCase() },
];

export function CompaniesList({
  rows,
  total,
  previewBulk,
  runBulk,
}: {
  rows: CompanyRow[];
  total: number;
  /* Bulk delete, with the server previewing which rows will refuse — a company
     that has ever issued a document never goes, and it is named before the
     button is pressed rather than skipped afterwards. */
  previewBulk: (ids: string[]) => Promise<BulkDeletePreview>;
  runBulk: (ids: string[], form: FormData) => void;
}) {
  const t = useTranslations();

  return (
    <DataTable
      bulkDelete={(ids) => (
        <BulkDelete ids={ids} preview={previewBulk} run={runBulk} onDone={() => {}} />
      )}
      rows={rows}
      total={total}
      columns={COLUMNS}
      getRowHref={(row) => `/companies/${row.id}`}
      emptyState={
        <>
          <h2 className="text-lead font-semibold text-ink">{t("empty.noCompaniesTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[420px] text-tiny leading-relaxed text-secondary">
            {t("empty.noCompaniesBody")}
          </p>
        </>
      }
    />
  );
}
