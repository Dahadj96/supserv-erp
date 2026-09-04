import { and, desc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { project } from "@/db/schema/project";

export type ProjectCandidate = {
  dealId: string;
  ref: string;
  subject: string;
  client: string;
  /** The latest issued order or offer, which the project would bill against. */
  latestKind: string;
  latestNumber: string | null;
  latestOn: string | null;
};

/**
 * Enquiries a project could be opened on: the client has an issued order or
 * offer in hand, and no project exists yet. What `/projects/new` lists when
 * it is reached without an enquiry in the address — from the rail, say.
 */
export async function projectCandidates(): Promise<ProjectCandidate[]> {
  const rows = await db
    .select({
      dealId: deal.id,
      ref: deal.ref,
      subject: deal.subject,
      client: sql<string>`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      latestKind: document.kind,
      latestNumber: document.number,
      latestOn: document.issuedOn,
    })
    .from(document)
    .innerJoin(deal, eq(deal.id, document.dealId))
    .leftJoin(party, eq(party.id, deal.partyId))
    .where(
      and(
        eq(document.status, "issued"),
        inArray(document.kind, ["client_order", "quotation", "proforma"]),
        isNull(deal.deletedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(project)
            .where(and(eq(project.dealId, deal.id), isNull(project.deletedAt))),
        ),
      ),
    )
    .orderBy(desc(document.issuedOn), desc(document.createdAt));

  // One row per enquiry — the first is the latest, by the order above, and
  // an order outranks an offer on the same day only by chance; the project
  // form lets the person pick anyway.
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.dealId)) return false;
    seen.add(row.dealId);
    return true;
  });
}
