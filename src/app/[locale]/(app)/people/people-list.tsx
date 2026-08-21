"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ColumnDef } from "@/components/data";
import { DataTable } from "@/components/data";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { PersonRow } from "@/domain/people";

/** Screen 51 draws each origin in its own colour. All four are equal in weight. */
const SOURCE_TONE: Record<string, BadgeTone> = {
  cv: "accent",
  direct: "warning",
  subcontractor: "serious",
  import: "neutral",
};

export function PeopleList({ rows, total }: { rows: PersonRow[]; total: number }) {
  const t = useTranslations();
  const format = useFormatter();

  const certification = (row: PersonRow) => {
    if (!row.certification) return "—";
    const { kind, expiresOn } = row.certification;
    if (!expiresOn) return kind;
    // Expiry is tracked for everybody, whatever their relationship — the right
    // card on screen 51 says so, and this column is where it is felt.
    return `${kind} — ${format.dateTime(new Date(expiresOn), {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
  };

  const COLUMNS: ColumnDef<PersonRow>[] = [
    { key: "fullName", labelKey: "people.name", render: (r) => r.fullName, sortable: true },
    { key: "trade", labelKey: "people.trade", render: (r) => r.trade, sortable: true },
    {
      key: "source",
      labelKey: "people.howAdded",
      render: (r) => (
        <Badge tone={SOURCE_TONE[r.source] ?? "neutral"}>{t(`people.source.${r.source}`)}</Badge>
      ),
    },
    {
      key: "relationship",
      labelKey: "people.relationship",
      render: (r) =>
        r.employerName ? (
          <span className="text-secondary">
            {r.employerName} — {t(`people.relationshipValue.${r.relationship}`)}
          </span>
        ) : (
          <Badge tone="neutral">{t(`people.relationshipValue.${r.relationship}`)}</Badge>
        ),
    },
    { key: "certification", labelKey: "people.certifications", render: certification },
    { key: "wilaya", labelKey: "people.wilaya", render: (r) => r.wilaya ?? "—" },
  ];

  return (
    <DataTable
      rows={rows}
      total={total}
      columns={COLUMNS}
      emptyState={
        <>
          <h2 className="text-lead font-semibold text-ink">{t("people.emptyTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[460px] text-tiny leading-relaxed text-secondary">
            {t("people.emptyBody")}
          </p>
        </>
      }
    />
  );
}
