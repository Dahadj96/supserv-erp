"use server";

import { and, eq } from "drizzle-orm";
import { mayIssue } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { issuingRules } from "@/domain/document-types";
import { computeTotals } from "@/domain/money";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 72 — the four ways into a new document, of which one has data behind
 * it today: "Nothing — enter it myself".
 *
 * This creates the record and nothing else. The lines are added on screen 47,
 * the builder, which is the only place that writes them. Two screens that both
 * knew how to build a line table would drift apart inside a month.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function createDraft(locale: string, form: FormData) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    return;
  }

  const kind = str(form, "kind") || "invoice";
  if (!mayIssue(session.role, kind)) {
    redirect({ href: `/documents/new?error=notAllowed&kind=${kind}`, locale });
    return;
  }

  const rules = await issuingRules(kind);
  if (rules && !rules.active) {
    redirect({ href: `/documents/new?error=typeIsOff&kind=${kind}`, locale });
    return;
  }

  /*
    T9. The form offered `liveParty` and this accepted two of its three clauses,
    so an archived company could be posted through by hand and became the
    counterparty on a real document. What a screen OFFERS and what its action
    ACCEPTS is a count and its list wearing different clothes: the same rule has
    to answer both.
  */
  const partyId = str(form, "partyId");
  const [client] = partyId
    ? await db
        .select()
        .from(party)
        .where(and(eq(party.id, partyId), liveParty))
        .limit(1)
    : [];

  if (!client) {
    redirect({ href: `/documents/new?error=noClient&kind=${kind}`, locale });
    return;
  }

  const issuedOn = str(form, "issuedOn") || new Date().toISOString().slice(0, 10);

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(document)
      .values({
        kind,
        number: null, // LAW 5 — allocated at issue, never on a draft.
        partyId: client.id,
        // LAW 4 — the document speaks the client's language, not the user's.
        locale: client.docLocale,
        currency: client.currency,
        issuedOn,
        status: "draft",
        totals: computeTotals([]),
      })
      .returning({ id: document.id });

    if (!created) throw new Error("draftNotCreated");

    await tx.insert(partyRole).values({ partyId: client.id, role: "client" }).onConflictDoNothing();

    await tx.insert(auditEntry).values({
      actorId: session.userId,
      actorKind: "user",
      entity: "document",
      entityId: created.id,
      action: "create",
      after: { kind, counterparty: client.code },
      sourceScreen: "72",
    });

    return created.id;
  });

  redirect({ href: `/documents/${id}/edit`, locale });
}
