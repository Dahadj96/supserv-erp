import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { documentTemplate } from "@/db/schema/document-template";
import { SEED_TYPES } from "@/domain/document-types";

/**
 * Screen 71 — what a template is, and the much longer list of what it is not.
 *
 * Eleven blocks make up a document. Nine of them are master data injected at
 * render: the logo, the legal identity, RC/NIF/NIS/AI, the bank line, the
 * signature block, the client block, the number, the lines and totals, and the
 * amount in words. Two are the template's own: the wording and section order,
 * and any footer mentions it adds to the ones the compliance profile requires.
 *
 * That split is the whole design. "Change the logo once and all eighteen
 * change" is only true because a template cannot hold a logo.
 */

/** The eleven blocks, and where each one comes from. Screen 71's middle panel. */
export const BLOCKS = [
  { key: "logo", from: "master", where: "company_identity.logo_path" },
  { key: "identity", from: "master", where: "company_identity" },
  { key: "identifiers", from: "master", where: "company_identity.rc / nif / nis / ai" },
  { key: "bank", from: "master", where: "bank_account (default)" },
  { key: "signature", from: "master", where: "company_identity" },
  { key: "client", from: "master", where: "party" },
  { key: "number", from: "master", where: "numbering_series" },
  { key: "lines", from: "master", where: "document / document_line" },
  { key: "amountInWords", from: "master", where: "src/documents/amount-in-words.ts" },
  { key: "wording", from: "template", where: "document_template.wording" },
  { key: "footerMentions", from: "template", where: "document_template.footer_mentions" },
] as const;

export type Template = {
  id: string;
  kind: string;
  locale: string;
  version: number;
  wording: Record<string, string>;
  footerMentions: string[];
  active: boolean;
};

/**
 * The template that would be used for a NEW document of this kind and language:
 * the highest active version. An issued document does not come through here —
 * it carries the id of the template that produced it.
 */
export async function currentTemplate(kind: string, locale: string): Promise<Template | null> {
  const [row] = await db
    .select()
    .from(documentTemplate)
    .where(
      and(
        eq(documentTemplate.kind, kind),
        eq(documentTemplate.locale, locale),
        eq(documentTemplate.active, true),
      ),
    )
    .orderBy(desc(documentTemplate.version))
    .limit(1);

  return row ?? null;
}

export async function templateById(id: string): Promise<Template | null> {
  const [row] = await db
    .select()
    .from(documentTemplate)
    .where(eq(documentTemplate.id, id))
    .limit(1);
  return row ?? null;
}

export async function listTemplates(): Promise<Template[]> {
  return db
    .select()
    .from(documentTemplate)
    .orderBy(documentTemplate.kind, documentTemplate.locale, desc(documentTemplate.version));
}

export class TemplateRefused extends Error {
  constructor(readonly reason: "noSuchTemplate" | "notCurrent") {
    super(reason);
  }
}

/**
 * Editing a template does NOT edit a template.
 *
 * It writes a new version and switches the old one off. Screen 71: "Editing a
 * template never changes a past document." The only way that can be true is if
 * the row an issued document points at is never touched again — so a change is
 * an insert, and every document that was produced by v3 still resolves to v3
 * long after v4 exists.
 */
export async function reviseFooter(
  id: string,
  mentions: string[],
  actorId: string,
): Promise<Template> {
  const existing = await templateById(id);
  if (!existing) throw new TemplateRefused("noSuchTemplate");
  if (!existing.active) throw new TemplateRefused("notCurrent");

  const cleaned = mentions.map((m) => m.trim()).filter(Boolean);

  const [next] = await db
    .insert(documentTemplate)
    .values({
      kind: existing.kind,
      locale: existing.locale,
      version: existing.version + 1,
      wording: existing.wording,
      footerMentions: cleaned,
      active: true,
    })
    .returning();

  await db
    .update(documentTemplate)
    .set({ active: false })
    .where(eq(documentTemplate.id, existing.id));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "document_template",
    entityId: next?.id ?? null,
    action: "revise",
    before: { version: existing.version, footerMentions: existing.footerMentions },
    after: { version: existing.version + 1, footerMentions: cleaned },
    sourceScreen: "71",
  });

  return next as Template;
}

/**
 * One v1 per (kind, language) the catalogue says that kind is written in.
 *
 * The wording is empty on purpose. `src/documents/pdf.ts` carries a default set
 * of words per language, and an empty template means "use those" rather than
 * "print nothing" — so writing the templates down changes nothing about what
 * comes out until somebody actually edits one. A seed that invented French
 * commercial wording nobody wrote would be the same mistake as a seed that
 * invented a legal rule.
 */
export async function ensureTemplatesExist(): Promise<number> {
  let written = 0;

  for (const type of SEED_TYPES) {
    for (const locale of type.languages) {
      // Arabic has no wording and no layout yet — screen 53 says so plainly.
      if (locale === "ar") continue;

      const existing = await currentTemplate(type.kind, locale);
      if (existing) continue;

      await db.insert(documentTemplate).values({
        kind: type.kind,
        locale,
        version: 1,
        wording: {},
        footerMentions: [],
        active: true,
      });
      written += 1;
    }
  }

  return written;
}
