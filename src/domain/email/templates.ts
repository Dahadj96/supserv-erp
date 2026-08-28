import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companyIdentity } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { emailTemplate } from "@/db/schema/email-template";
import { render, scan, type Values } from "./placeholders";

/**
 * Screen 59 — the emails this company sends, and the paragraphs it reuses.
 *
 * The bodies are seeded EMPTY, on purpose, and it is the same decision
 * `ensureTemplatesExist` made for documents: "a seed that invented French
 * commercial wording nobody wrote would be the same mistake as a seed that
 * invented a legal rule." SUPSERV's covering note is SUPSERV's, and a plausible
 * one written by a machine would be sent to a client by somebody who assumed
 * a human wrote it.
 *
 * So what the seed provides is the LIST — the eleven moments this company
 * writes the same email twice — and each one starts blank and says so.
 */

export const TEMPLATE_LOCALES = ["fr", "en"] as const;

export type EmailScope = "template" | "snippet";

type Seed = { key: string; scope: EmailScope };

/**
 * Grouped by where in the work they happen, which is the order screen 59 lists
 * them in. Every key needs `emailTemplates.name.<key>` and `.when.<key>` in
 * both message files — a template whose purpose is not written down is a
 * template nobody knows when to use.
 */
export const SEED_EMAIL_TEMPLATES: Seed[] = [
  { key: "enquiryAck", scope: "template" },
  { key: "askForClarification", scope: "template" },
  { key: "supplierRfq", scope: "template" },
  { key: "supplierChase", scope: "template" },
  { key: "offerCovering", scope: "template" },
  { key: "offerFollowUp", scope: "template" },
  { key: "deliveryAdvice", scope: "template" },
  { key: "invoiceCovering", scope: "template" },
  { key: "relance1", scope: "template" },
  { key: "relance2", scope: "template" },
  { key: "relance3", scope: "template" },
  { key: "signature", scope: "snippet" },
  { key: "bankDetails", scope: "snippet" },
  { key: "deliveryTerms", scope: "snippet" },
  { key: "validityTerms", scope: "snippet" },
];

export type EmailTemplate = {
  id: string;
  key: string;
  locale: string;
  scope: EmailScope;
  subject: string | null;
  body: string;
  updatedBy: string | null;
  updatedAt: Date | null;
  /** Derived, never stored — LAW 1. Blank body means nobody has written it. */
  written: boolean;
  /** Placeholders in the body that are not in the vocabulary. */
  unknown: string[];
};

function decorate(row: typeof emailTemplate.$inferSelect): EmailTemplate {
  const body = row.body ?? "";
  const found = scan(`${row.subject ?? ""}\n${body}`);
  return {
    id: row.id,
    key: row.key,
    locale: row.locale,
    scope: row.scope as EmailScope,
    subject: row.subject,
    body,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
    written: body.trim().length > 0,
    unknown: found.unknown,
  };
}

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  const rows = await db
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.active, true))
    .orderBy(emailTemplate.key, emailTemplate.locale);

  const order = new Map(SEED_EMAIL_TEMPLATES.map((s, i) => [s.key, i]));
  return rows
    .map(decorate)
    .sort(
      (a, b) =>
        (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999) || a.locale.localeCompare(b.locale),
    );
}

export async function emailTemplateById(id: string): Promise<EmailTemplate | null> {
  const [row] = await db.select().from(emailTemplate).where(eq(emailTemplate.id, id)).limit(1);
  return row ? decorate(row) : null;
}

/**
 * One blank row per (key, language). Idempotent — running it again after new
 * keys are added writes only the new ones, and never touches wording somebody
 * has written.
 */
export async function ensureEmailTemplatesExist(): Promise<number> {
  let written = 0;

  for (const seed of SEED_EMAIL_TEMPLATES) {
    for (const locale of TEMPLATE_LOCALES) {
      const [existing] = await db
        .select({ id: emailTemplate.id })
        .from(emailTemplate)
        .where(and(eq(emailTemplate.key, seed.key), eq(emailTemplate.locale, locale)))
        .limit(1);
      if (existing) continue;

      await db.insert(emailTemplate).values({
        key: seed.key,
        locale,
        scope: seed.scope,
        subject: seed.scope === "template" ? "" : null,
        body: "",
      });
      written += 1;
    }
  }

  return written;
}

export class TemplateRefused extends Error {
  constructor(readonly reason: "noSuchTemplate" | "unknownPlaceholder") {
    super(reason);
  }
}

/**
 * Save wording. Refuses a placeholder the renderer does not know.
 *
 * That refusal is the whole reason the vocabulary is closed. `{client.nom}` is
 * a typo that would sit in a template for a year and go out in an email as
 * literal braces; catching it at save time costs one error message.
 */
export async function saveEmailTemplate(opts: {
  id: string;
  subject: string | null;
  body: string;
  actorId: string;
}): Promise<EmailTemplate> {
  const existing = await emailTemplateById(opts.id);
  if (!existing) throw new TemplateRefused("noSuchTemplate");

  const subject = existing.scope === "template" ? (opts.subject ?? "") : null;
  const found = scan(`${subject ?? ""}\n${opts.body}`);
  if (found.unknown.length > 0) throw new TemplateRefused("unknownPlaceholder");

  await db
    .update(emailTemplate)
    .set({ subject, body: opts.body, updatedBy: opts.actorId, updatedAt: new Date() })
    .where(eq(emailTemplate.id, opts.id));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    actorKind: "user",
    entity: "email_template",
    entityId: opts.id,
    action: "revise",
    before: { subject: existing.subject, body: existing.body },
    after: { subject, body: opts.body },
    sourceScreen: "59",
  });

  return (await emailTemplateById(opts.id)) as EmailTemplate;
}

/**
 * The half of the vocabulary that can be filled in from Settings.
 *
 * `us.*` is company master data — the same rows screen 71 injects into every
 * document, so a template previewing "SARL SUPSERV" here is showing the string
 * that would actually go out. `me.*` is whoever is looking. Everything the
 * counterparty owns is absent from this object on purpose, so `render` reports
 * it as `noRecord` rather than blanking it.
 */
export async function settingsPreviewValues(me: {
  name: string | null;
  email: string | null;
}): Promise<Values> {
  const [us] = await db.select().from(companyIdentity).limit(1);

  return {
    "us.name": us?.tradeName || us?.legalName || null,
    "us.phone": us?.phone ?? null,
    "us.email": us?.email ?? null,
    "us.website": us?.website ?? null,
    "us.address": us?.address ?? null,
    "us.rc": us?.rc ?? null,
    "us.nif": us?.nif ?? null,
    "me.name": me.name,
    "me.email": me.email,
  };
}

export function previewOf(template: EmailTemplate, values: Values) {
  return {
    subject: template.subject ? render(template.subject, values) : null,
    body: render(template.body, values),
  };
}
