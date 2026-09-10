import { desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { party } from "@/db/schema/party";
import { sourcingRequest, sourcingResponse } from "@/db/schema/sourcing";

/**
 * Screen 09 — every sourcing request, across every deal.
 *
 * `requestsForDeal` already existed and answers "what did we ask about THIS
 * enquiry". The nav has pointed at `/sourcing` since phase 0 and nothing
 * answered "what are we waiting on, everywhere" — which is the question the
 * screen is for.
 *
 * The counts are the screen. Four asked and two replied means two suppliers to
 * chase; a request where everyone bounced is a broken address book, not a slow
 * market. `sourcing_response` holds a row from the moment a message goes out
 * precisely so a silence is visible — see the schema comment — and this is
 * where that pays off.
 */
export type SourcingRow = {
  id: string;
  ref: string;
  subject: string;
  dealId: string;
  dealRef: string;
  clientName: string | null;
  sentAt: Date | null;
  replyBy: Date | null;
  asked: number;
  quoted: number;
  declined: number;
  silent: number;
  bounced: number;
};

export async function listSourcingRequests(limit = 200): Promise<SourcingRow[]> {
  return (
    db
      .select({
        id: sourcingRequest.id,
        ref: sourcingRequest.ref,
        subject: sourcingRequest.subject,
        dealId: sourcingRequest.dealId,
        dealRef: deal.ref,
        clientName: sql<
          string | null
        >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
        sentAt: sourcingRequest.sentAt,
        replyBy: sourcingRequest.replyBy,

        asked: sql<number>`(
        select count(*)::int from ${sourcingResponse} r
        where r.request_id = ${sourcingRequest.id}
      )`,
        quoted: sql<number>`(
        select count(*)::int from ${sourcingResponse} r
        where r.request_id = ${sourcingRequest.id} and r.status = 'quoted'
      )`,
        declined: sql<number>`(
        select count(*)::int from ${sourcingResponse} r
        where r.request_id = ${sourcingRequest.id} and r.status = 'declined'
      )`,
        // Asked and nothing back. The two that matter to chase.
        silent: sql<number>`(
        select count(*)::int from ${sourcingResponse} r
        where r.request_id = ${sourcingRequest.id} and r.status in ('asked', 'no_reply')
      )`,
        // A broken address, not a slow supplier. Counted apart, on purpose.
        bounced: sql<number>`(
        select count(*)::int from ${sourcingResponse} r
        where r.request_id = ${sourcingRequest.id} and r.status = 'bounced'
      )`,
      })
      .from(sourcingRequest)
      .innerJoin(deal, eq(deal.id, sourcingRequest.dealId))
      .leftJoin(party, eq(party.id, deal.partyId))
      /*
      V1 — a request belonging to a binned enquiry is not work anybody is
      doing. `sourcing_request.deal_id` is `ON DELETE cascade`, which fires on a
      hard delete and this system never hard-deletes, so until now discarding an
      enquiry left its supplier requests sitting on this list pointing at a deal
      nobody could open. The tenders list has always filtered this way; this one
      did not, and that is the whole of the bug.
    */
      .where(isNull(deal.deletedAt))
      .orderBy(desc(sourcingRequest.createdAt))
      .limit(limit)
  );
}

export type SourcingCounts = { all: number; waiting: number; bounced: number; unsent: number };

export async function sourcingCounts(): Promise<SourcingCounts> {
  const rows = await listSourcingRequests(1000);
  return {
    all: rows.length,
    waiting: rows.filter((row) => row.sentAt !== null && row.silent > 0).length,
    bounced: rows.filter((row) => row.bounced > 0).length,
    // Written and never sent. A different fact from never written, and the same
    // distinction `relance.draft` makes on screen 20.
    unsent: rows.filter((row) => row.sentAt === null).length,
  };
}
