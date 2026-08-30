import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { document, documentLink } from "@/db/schema/document";
import { party } from "@/db/schema/party";

/**
 * Screen 13 — Orders.
 *
 * Two kinds live here and they point in opposite directions:
 *
 *   `client_order`    what a CLIENT ordered from us. Numbered by their
 *                     reference, not ours.
 *   `purchase_order`  what WE ordered from a supplier.
 *
 * Same table, same engine, opposite counterparties. Screen 13 shows both,
 * because "what is committed" has both halves in it and a screen showing one
 * would let a purchase order nobody delivered sit invisible beside a client
 * order everybody is chasing.
 *
 * `delivered` counts delivery notes linked to the order — a computed fact,
 * LAW 1, not a status somebody remembers to tick.
 */
export const ORDER_KINDS = ["client_order", "purchase_order"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

export function isOrderKind(value: string | undefined): value is OrderKind {
  return Boolean(value) && ORDER_KINDS.includes(value as OrderKind);
}

export type OrderRow = {
  id: string;
  kind: string;
  number: string | null;
  status: string;
  counterparty: string | null;
  issuedOn: string | null;
  total: string;
  currency: string;
  /** Delivery notes raised against it. Zero means nothing has moved yet. */
  delivered: number;
};

export async function listOrders(kind?: OrderKind, limit = 200): Promise<OrderRow[]> {
  const kinds = kind ? [kind] : [...ORDER_KINDS];

  return db
    .select({
      id: document.id,
      kind: document.kind,
      number: document.number,
      status: document.status,
      counterparty: sql<
        string | null
      >`coalesce(nullif(trim(${party.tradeName}), ''), ${party.legalName})`,
      issuedOn: document.issuedOn,
      total: sql<string>`coalesce(${document.totals}->>'totalIncl', '0')`,
      currency: document.currency,
      delivered: sql<number>`(
        select count(*)::int from ${documentLink} l
        join ${document} d on d.id = l.to_document
        where l.from_document = ${document.id} and d.kind = 'delivery_note'
      )`,
    })
    .from(document)
    .leftJoin(party, eq(party.id, document.partyId))
    .where(inArray(document.kind, kinds))
    .orderBy(desc(document.createdAt))
    .limit(limit);
}

export type OrderCounts = Record<OrderKind | "all" | "undelivered", number>;

export async function orderCounts(): Promise<OrderCounts> {
  const all = await listOrders(undefined, 1000);
  return {
    all: all.length,
    client_order: all.filter((row) => row.kind === "client_order").length,
    purchase_order: all.filter((row) => row.kind === "purchase_order").length,
    // Issued and nothing delivered against it. The list's reason to exist.
    undelivered: all.filter((row) => row.number !== null && row.delivered === 0).length,
  };
}
