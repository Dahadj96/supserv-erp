"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ColumnDef } from "@/components/data";
import { DataTable } from "@/components/data";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PersonRow } from "@/domain/people";

/** Screen 51 draws each origin in its own colour. All four are equal in weight. */
const SOURCE_TONE: Record<string, BadgeTone> = {
  cv: "accent",
  direct: "warning",
  subcontractor: "serious",
  import: "neutral",
};

export function PeopleList({
  rows,
  total,
  discard,
  notAllowed,
}: {
  rows: PersonRow[];
  total: number;
  /** Screen 83's action, bound to the locale on the server. */
  discard: (form: FormData) => Promise<void>;
  /** The sentence to show when this role may not bin anything. */
  notAllowed?: string;
}) {
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
    {
      /**
       * A name was the cheapest row in this system to make and, until now, the
       * only one nobody could unmake — two required fields, no permission, and
       * no way back. It goes to the bin for 30 days like everything else.
       *
       * Present and grey rather than absent when it refuses: a man who has not
       * left a site crew is somebody screen 16 still draws, and "take him off
       * the crew first" is a sentence worth being able to read.
       */
      key: "remove",
      labelKey: "bin.remove",
      align: "end",
      render: (r) => (
        <form action={discard}>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="back" value="/people" />
          <input type="hidden" name="screen" value="51" />
          <Button
            type="submit"
            variant="ghost"
            size="small"
            disabledReason={
              notAllowed ?? (r.onSite > 0 ? t("bin.personOnSite", { count: r.onSite }) : undefined)
            }
          >
            {t("bin.remove")}
          </Button>
        </form>
      ),
    },
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
