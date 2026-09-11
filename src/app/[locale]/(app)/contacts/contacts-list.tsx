"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ColumnDef } from "@/components/data";
import { BulkDelete, type BulkDeletePreview, DataTable } from "@/components/data";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ContactRow, ContactStatus } from "@/domain/contact";

/** Screen 76 draws each status in its own colour. Bouncing is the loud one. */
const STATUS_TONE: Record<ContactStatus, BadgeTone> = {
  active: "good",
  unverified: "warning",
  bouncing: "critical",
};

/** Email blue, phone orange, WhatsApp green — as drawn. */
const PREFERS_TONE: Record<string, BadgeTone> = {
  email: "accent",
  phone: "serious",
  whatsapp: "good",
};

export function ContactsList({
  rows,
  total,
  previewBulk,
  runBulk,
}: {
  rows: ContactRow[];
  total: number;
  previewBulk: (ids: string[]) => Promise<BulkDeletePreview>;
  runBulk: (ids: string[], form: FormData) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();

  const lastContact = (at: Date | null) => {
    if (!at) return t("contacts.never");
    const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
    // Two words people actually use, then a date. Nobody says "3 days ago"
    // about a phone call; they say the date.
    if (days <= 0) return t("contacts.today");
    if (days === 1) return t("contacts.yesterday");
    return format.dateTime(at, { day: "2-digit", month: "short" });
  };

  const COLUMNS: ColumnDef<ContactRow>[] = [
    { key: "fullName", labelKey: "contacts.name", render: (r) => r.fullName, sortable: true },
    { key: "company", labelKey: "contacts.company", render: (r) => r.companyName, sortable: true },
    { key: "job", labelKey: "contacts.job", render: (r) => r.job },
    { key: "email", labelKey: "contacts.email", render: (r) => r.email || "—" },
    { key: "phone", labelKey: "contacts.phone", render: (r) => r.phone || "—" },
    {
      key: "prefers",
      labelKey: "contacts.prefers",
      render: (r) =>
        r.prefers ? (
          <Badge tone={PREFERS_TONE[r.prefers] ?? "neutral"}>
            {t(`contacts.prefersValue.${r.prefers}`)}
          </Badge>
        ) : (
          "—"
        ),
    },
    {
      key: "lastContact",
      labelKey: "contacts.lastContact",
      render: (r) => lastContact(r.lastContactAt),
      sortable: true,
    },
    {
      key: "status",
      labelKey: "contacts.status",
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]}>{t(`contacts.statusValue.${r.status}`)}</Badge>
      ),
    },
  ];

  return (
    <DataTable
      bulkDelete={(ids) => (
        <BulkDelete ids={ids} preview={previewBulk} run={runBulk} onDone={() => {}} />
      )}
      rows={rows}
      total={total}
      columns={COLUMNS}
      getRowHref={(row) => `/companies/${row.companyId}`}
      emptyState={
        <>
          <h2 className="text-lead font-semibold text-ink">{t("contacts.emptyTitle")}</h2>
          <p className="mx-auto mt-1.5 max-w-[440px] text-tiny leading-relaxed text-secondary">
            {t("contacts.emptyBody")}
          </p>
        </>
      }
    />
  );
}
