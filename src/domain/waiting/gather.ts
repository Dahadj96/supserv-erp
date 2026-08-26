import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { deliveryDetail } from "@/db/schema/delivery";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";
import { balanceOf } from "@/domain/money/ageing";
import { dueNow } from "@/domain/money/relance";
import { owings, policy, relancesFor } from "@/domain/money/store";
import type { Waiting } from "./list";

/**
 * Screen 58 — where the silences come from.
 *
 * Same discipline as screen 55: nothing here is a row somebody created. Every
 * line is a fact that already exists somewhere and has simply not changed —
 * a sourcing response still at `asked`, an invoice with a balance, a delivery
 * note with no signed copy back.
 *
 * The consequence worth naming: when the supplier finally quotes, the line does
 * not get "closed". It stops being true, so it stops being here.
 */

/** Quotes we asked for and have not received. */
async function suppliers(): Promise<Waiting[]> {
  const rows = await db
    .select({
      id: sourcingResponse.id,
      status: sourcingResponse.status,
      chasedCount: sourcingResponse.chasedCount,
      lastChasedAt: sourcingResponse.lastChasedAt,
      sentAt: sourcingRequest.sentAt,
      replyBy: sourcingRequest.replyBy,
      subject: sourcingRequest.subject,
      dealId: sourcingRequest.dealId,
      dealRef: deal.ref,
      supplierName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(sourcingResponse)
    .innerJoin(sourcingRequest, eq(sourcingRequest.id, sourcingResponse.requestId))
    .innerJoin(party, eq(party.id, sourcingResponse.partyId))
    .leftJoin(deal, eq(deal.id, sourcingRequest.dealId))
    .where(
      and(
        // Still open: asked, chased, bounced. Anything priced or declined has
        // answered, and an answer is not a silence.
        sql`${sourcingResponse.status} in ('asked', 'chased', 'bounced', 'no_reply')`,
        isNull(sourcingResponse.receivedAt),
      ),
    );

  return rows.map((row) => ({
    id: `sr:${row.id}`,
    group: "supplier" as const,
    who: row.supplierName,
    what: row.subject,
    forRef: row.dealRef ?? null,
    forHref: row.dealId ? `/deals/${row.dealId}` : null,
    // `sentAt` is what "asked" means. A request that was never sent is not a
    // supplier being slow, it is us not having asked.
    askedAt: row.sentAt,
    chased: row.chasedCount,
    lastChasedAt: row.lastChasedAt,
    // No policy chases suppliers automatically, so nothing is promised here.
    autoChaseAt: null,
    // "A bounced address is not a slow supplier — it is a broken record."
    broken: row.status === "bounced",
  }));
}

/** Money, decisions and documents owed by clients. */
async function clients(now: Date): Promise<Waiting[]> {
  const rows: Waiting[] = [];

  const ledger = await owings();
  const unpaid = ledger.filter((row) => Number(balanceOf(row)) > 0);
  const steps = await policy();
  const history = await relancesFor(unpaid.map((row) => row.documentId));

  for (const invoice of unpaid) {
    const chases = history.get(invoice.documentId) ?? [];
    const sent = chases.filter((row) => row.status !== "draft");
    const due = dueNow({
      dueOn: invoice.dueOn,
      balance: balanceOf(invoice),
      policy: steps,
      history: chases,
      today: now,
    });

    rows.push({
      id: `owed:${invoice.documentId}`,
      group: "client",
      who: invoice.clientName,
      what: `${balanceOf(invoice)} ${invoice.currency}`,
      forRef: invoice.number,
      forHref: `/documents/${invoice.documentId}`,
      // Since it was issued — that is when the client became the one to move.
      askedAt: invoice.issuedOn,
      chased: sent.length,
      lastChasedAt: invoice.lastRelanceAt,
      // The relance policy IS the auto-chase, and it is the only one here that
      // has a real date behind it rather than an intention.
      autoChaseAt: due ? new Date(now) : null,
      broken: false,
    });
  }

  // Delivery notes gone out with no signed copy back. The client has the paper.
  const unsigned = await db
    .select({
      id: document.id,
      number: document.number,
      issuedOn: document.issuedOn,
      clientName: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
    })
    .from(document)
    .innerJoin(party, eq(party.id, document.partyId))
    .leftJoin(deliveryDetail, eq(deliveryDetail.documentId, document.id))
    .where(
      and(
        eq(document.kind, "delivery_note"),
        sql`${document.number} is not null`,
        isNull(deliveryDetail.signedCopyOnFile),
      ),
    );

  for (const note of unsigned) {
    rows.push({
      id: `signed:${note.id}`,
      group: "client",
      who: note.clientName,
      what: `signed ${note.number}`,
      forRef: note.number,
      forHref: `/deliveries/${note.id}`,
      askedAt: note.issuedOn ? new Date(`${note.issuedOn}T00:00:00Z`) : null,
      chased: 0,
      lastChasedAt: null,
      autoChaseAt: null,
      broken: false,
    });
  }

  return rows;
}

/**
 * Everything sitting with somebody else.
 *
 * The frame's third group — authorities and banks — is not here, and this is
 * the honest reason: a caution de soumission and a CASNOS attestation are
 * compliance documents, and the compliance module is phase 7. There is no table
 * that knows a bank guarantee was requested, so there is nothing to read. The
 * page says so rather than drawing an empty group as though it were good news.
 */
export async function gatherWaiting(now: Date): Promise<Waiting[]> {
  const [a, b] = await Promise.all([suppliers(), clients(now)]);
  return [...a, ...b];
}
