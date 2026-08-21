"use server";

import { and, eq, isNull } from "drizzle-orm";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { computeTotals, lineTotalExcl } from "@/domain/money";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 72, the fourth way in: "Nothing — enter it myself".
 *
 * The other three start from an order, an offer or a situation de travaux, and
 * none of those records exist yet. Rather than mock them, this builds the one
 * path that is real today, and the screen says plainly why the other three are
 * grey.
 *
 * It creates a DRAFT. No number is reserved here — that happens on screen 18
 * when somebody presses Issue, and only there. LAW 5.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

type ParsedLine = {
  designation: string;
  unit: string | null;
  qty: string;
  unitPrice: string;
  vatRate: string;
};

/** Only lines with a designation and a quantity survive. A blank row is a blank row. */
function parseLines(form: FormData): ParsedLine[] {
  const designations = form.getAll("designation").map(String);
  const units = form.getAll("unit").map(String);
  const quantities = form.getAll("qty").map(String);
  const prices = form.getAll("unitPrice").map(String);
  const rates = form.getAll("vatRate").map(String);

  const lines: ParsedLine[] = [];
  for (let i = 0; i < designations.length; i++) {
    const designation = (designations[i] ?? "").trim();
    const qty = Number(quantities[i] ?? 0);
    if (!designation || !Number.isFinite(qty) || qty <= 0) continue;

    lines.push({
      designation,
      unit: (units[i] ?? "").trim() || null,
      qty: String(qty),
      unitPrice: String(Number(prices[i] ?? 0) || 0),
      vatRate: String(Number(rates[i] ?? 0) || 0),
    });
  }
  return lines;
}

export async function createDraftInvoice(locale: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }
  if (!mayIssue(session.role, "invoice")) {
    redirect({ href: "/documents/new?error=notAllowed", locale });
    return;
  }

  const partyId = str(form, "partyId");
  if (!partyId) {
    redirect({ href: "/documents/new?error=noClient", locale });
    return;
  }

  // A retired, archived or deleted party is not somebody you can invoice, and
  // the picker is not the only place that has to know it.
  const [client] = await db
    .select()
    .from(party)
    .where(and(eq(party.id, partyId), isNull(party.deletedAt), isNull(party.supersededBy)))
    .limit(1);
  if (!client) {
    redirect({ href: "/documents/new?error=noClient", locale });
    return;
  }

  const lines = parseLines(form);
  if (lines.length === 0) {
    redirect({ href: "/documents/new?error=noLines", locale });
    return;
  }

  const issuedOn = str(form, "issuedOn") || new Date().toISOString().slice(0, 10);
  const totals = computeTotals(lines);

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind: "invoice",
        number: null, // LAW 5 — allocated at issue, never on a draft.
        partyId: client.id,
        // LAW 4 — the document speaks the client's language, not the user's.
        locale: client.docLocale,
        currency: client.currency,
        issuedOn,
        status: "draft",
        totals,
      })
      .returning({ id: document.id });

    if (!created) throw new Error("draftNotCreated");

    await tx.insert(documentLine).values(
      lines.map((line, index) => ({
        documentId: created.id,
        position: index + 1,
        lineKind: "item",
        designation: line.designation,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        totalExcl: lineTotalExcl(line).toFixed(2),
      })),
    );

    // The client role is claimed by invoicing them, not asserted in advance —
    // and it is recorded, so the next screen that asks "who do we sell to" has
    // an answer that came from something that actually happened.
    await tx.insert(partyRole).values({ partyId: client.id, role: "client" }).onConflictDoNothing();

    await tx.insert(auditEntry).values({
      actorId: session.userId,
      actorKind: "user",
      entity: "document",
      entityId: created.id,
      action: "create",
      after: { kind: "invoice", counterparty: client.code, lines: lines.length },
      sourceScreen: "72",
    });

    return created.id;
  });

  redirect({ href: `/documents/${id}`, locale });
}
