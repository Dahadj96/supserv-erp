import { asc, eq } from "drizzle-orm";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { document, documentLine } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import type { LineKind } from "@/documents/draft";
import { listTypes } from "@/domain/document-types";
import { Link } from "@/i18n/navigation";
import { saveDraftAction } from "./actions";
import { Builder, type Row } from "./builder";

/**
 * Screen 47 — the document builder.
 *
 * It edits a DRAFT and only a draft. LAW 5 is not enforced by hiding a button:
 * `saveDraft` refuses an issued document outright, and this page sends you to
 * the preview instead of showing you an editor you are not allowed to use.
 */
export const dynamic = "force-dynamic";

export default async function EditDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { saved, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [record] = await db.select().from(document).where(eq(document.id, id)).limit(1);
  if (!record) notFound();

  // An issued document has nothing to edit. Sending somebody to the preview is
  // more useful than telling them no.
  if (record.number || record.lockedAt || record.status !== "draft") {
    hardRedirect(`/${locale}/documents/${id}?error=alreadyIssued`);
  }

  if (!mayIssue(session.role, record.kind)) {
    hardRedirect(`/${locale}/documents/${id}?error=notAllowed`);
  }

  const [counterparty] = await db.select().from(party).where(eq(party.id, record.partyId)).limit(1);

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, id))
    .orderBy(asc(documentLine.position));

  const types = await listTypes();
  const kindName = (k: string) => (t.has(`docTypes.kind.${k}`) ? t(`docTypes.kind.${k}`) : k);

  const offered = (types.length > 0 ? types.filter((type) => type.active) : [{ kind: record.kind }])
    .map((type) => type.kind)
    .filter((k) => mayIssue(session.role, k))
    .map((k) => ({ kind: k, label: kindName(k) }));

  const initial: Row[] = lines.map((line, index) => ({
    key: index + 1,
    lineKind: (line.lineKind ?? "item") as LineKind,
    designation: line.designation ?? "",
    reference: line.reference ?? "",
    unit: line.unit ?? "",
    qty: line.qty ?? "",
    unitPrice: line.unitPrice ?? "",
    discountPct: line.discountPct ?? "0",
    vatRate: line.vatRate ?? "19",
    isOption: line.isOption,
  }));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <p className="text-micro text-muted">{kindName(record.kind)}</p>
          <h1 className="mt-0.5 flex items-center gap-2 text-[19px] font-semibold text-ink">
            {t("builder.title")}
            <Badge tone="neutral">{t("builder.draft")}</Badge>
          </h1>
          <p className="mt-1 text-tiny text-muted">
            {t("builder.forClient", {
              client: counterparty?.legalName ?? "—",
              language: record.locale.toUpperCase(),
            })}
          </p>
        </div>
        <div className="ms-auto">
          <Link href={`/documents/${id}`}>
            <Button variant="secondary">{t("builder.preview")}</Button>
          </Link>
        </div>
      </div>

      {saved ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("builder.saved")}
        </p>
      ) : null}
      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`builder.error.${error}`) ? t(`builder.error.${error}`) : error}
        </p>
      ) : null}

      <div className="max-w-[1400px] px-7 py-6">
        <Builder
          locale={record.locale}
          kind={record.kind}
          kinds={offered}
          issuedOn={record.issuedOn ?? new Date().toISOString().slice(0, 10)}
          globalDiscountPct={record.globalDiscountPct ?? "0"}
          advanceDeducted={record.advanceDeducted ?? "0"}
          retentionPct={record.retentionPct ?? "0"}
          initial={initial}
          currency={record.currency}
          action={saveDraftAction.bind(null, locale, id)}
        />
      </div>
    </main>
  );
}
