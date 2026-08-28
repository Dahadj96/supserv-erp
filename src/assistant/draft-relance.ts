import { eq } from "drizzle-orm";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { render } from "@/domain/email/placeholders";
import { listEmailTemplates, settingsPreviewValues } from "@/domain/email/templates";
import { balanceOf, daysLate } from "@/domain/money/ageing";
import { owings } from "@/domain/money/store";
import type { Citation } from "./proposals";

/**
 * The one `propose` tool built so far: chase this invoice.
 *
 * It writes nothing. It reads an overdue invoice, picks the relance template
 * for the CLIENT's language, fills in what it can, and hands back the text a
 * person would send — plus the links proving every number in it.
 *
 * The wording is SUPSERV's, from screen 59, and if nobody has written it this
 * refuses. That is the same rule the template seed follows: a plausible relance
 * composed by a machine ends up in front of a client who assumes a human wrote
 * it. An assistant that invents the words is worse than one that says "you have
 * not written the first reminder yet, here is where".
 */

export type DraftedRelance = {
  documentId: string;
  title: string;
  body: string;
  subject: string | null;
  citations: Citation[];
  /** Placeholders still standing, so the screen can show what needs a hand. */
  unresolved: string[];
};

export class CannotDraft extends Error {
  constructor(
    readonly reason: "notOverdue" | "noSuchInvoice" | "noTemplate" | "templateBlank",
    readonly fixRoute: string | null = null,
  ) {
    super(reason);
  }
}

/** First, second or third reminder, from how late it already is. */
export function stepFor(days: number): "relance1" | "relance2" | "relance3" {
  if (days >= 45) return "relance3";
  if (days >= 21) return "relance2";
  return "relance1";
}

export async function draftRelanceFor(opts: {
  documentId: string;
  me: { name: string | null; email: string | null };
  today?: Date;
}): Promise<DraftedRelance> {
  const today = opts.today ?? new Date();

  const all = await owings();
  const invoice = all.find((owing) => owing.documentId === opts.documentId);
  if (!invoice) throw new CannotDraft("noSuchInvoice");

  const late = daysLate(invoice.dueOn, today);
  const balance = balanceOf(invoice);
  if (late <= 0 || Number(balance) <= 0) throw new CannotDraft("notOverdue");

  // LAW 4 — the document follows the counterparty. A French template for a
  // French client, whatever language the person drafting is working in.
  const [client] = await db
    .select({ docLocale: party.docLocale, legalName: party.legalName, tradeName: party.tradeName })
    .from(party)
    .where(eq(party.id, invoice.partyId))
    .limit(1);
  const locale = client?.docLocale ?? "fr";

  const key = stepFor(late);
  const templates = await listEmailTemplates();
  const template = templates.find((t) => t.key === key && t.locale === locale);

  if (!template) throw new CannotDraft("noTemplate", "/settings/email-templates");
  if (!template.written) throw new CannotDraft("templateBlank", "/settings/email-templates");

  const values = {
    ...(await settingsPreviewValues(opts.me)),
    "client.name": client?.tradeName || client?.legalName || invoice.clientName,
    "invoice.number": invoice.number,
    "invoice.total": balance,
    "invoice.dueDate": invoice.dueOn ? invoice.dueOn.toISOString().slice(0, 10) : null,
    "invoice.daysOverdue": String(late),
  };

  const body = render(template.body, values);
  const subject = template.subject ? render(template.subject, values) : null;

  const unresolved = [...(subject?.left ?? []), ...body.left]
    .map((entry) => entry.name)
    .filter((name, i, arr) => arr.indexOf(name) === i);

  /**
   * Every number in the body, and where to see it.
   *
   * The ageing screen shows the balance and the days late; the document shows
   * what was invoiced. A person can check both before deciding, which is the
   * whole point of a proposal rather than an action.
   */
  const citations: Citation[] = [
    {
      label: `${invoice.number ?? "—"} · ${balance} ${invoice.currency ?? "DZD"}`,
      href: "/payments/ageing",
    },
    { label: invoice.clientName, href: `/documents/${invoice.documentId}` },
  ];

  return {
    documentId: invoice.documentId,
    title: `${invoice.clientName} — ${invoice.number ?? "—"} · ${late} d`,
    body: body.text,
    subject: subject?.text ?? null,
    citations,
    unresolved,
  };
}
