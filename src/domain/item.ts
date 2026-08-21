import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { item, itemAlias } from "@/db/schema/item";

/**
 * Screens 73 and 75 — the item, and every name it has ever been given.
 *
 * "Once you have matched a client wording to a supplier article, the system
 * recognises it next time — including on a different enquiry from a different
 * client."
 *
 * That sentence is the reason `item_alias` exists and the reason matching is
 * done here rather than in the offer builder: the memory belongs to the item,
 * not to the enquiry that happened to create it.
 */

export type AliasSource = "client" | "supplier" | "manufacturer" | "internal";

export type ItemMatch = {
  itemId: string;
  code: string;
  designation: string;
  /** The alias that matched, when it was not the designation itself. */
  matchedAlias: string | null;
  matchedOn: "designation" | "alias";
  score: number;
};

/** Below this, two wordings are different products, not two spellings of one. */
const MATCH_FLOOR = 0.42;

/**
 * Find the item a wording refers to.
 *
 * Exact first, on the normalised form — accents, case and `×` versus `x` are
 * not differences. Then trigram, which catches "Mégaphone portatif 25W" against
 * "Mégaphone TOA ER-2230W 25W".
 */
export async function matchItem(wording: string, limit = 5): Promise<ItemMatch[]> {
  const term = wording.trim();
  if (term.length < 2) return [];

  // Both sides go through the SAME expression the trigram indexes were built
  // on — `immutable_unaccent(lower(...))`, in that order. Swap the two calls
  // and the index is silently unused.
  return db.execute<ItemMatch>(sql`
    with needle as (
      select immutable_unaccent(lower(${term})) as n
    ),
    live as (
      select id, code, designation from item where superseded_by is null
    ),
    hits as (
      select i.id as "itemId", i.code, i.designation,
             null::text as "matchedAlias", 'designation' as "matchedOn",
             case when immutable_unaccent(lower(i.designation)) = needle.n then 1.0
                  else similarity(immutable_unaccent(lower(i.designation)), needle.n)
             end as score
      from live i, needle
      union all
      select i.id, i.code, i.designation,
             a.alias, 'alias',
             case when immutable_unaccent(lower(a.alias)) = needle.n then 1.0
                  else similarity(immutable_unaccent(lower(a.alias)), needle.n)
             end
      from live i
      join item_alias a on a.item_id = i.id
      cross join needle
    ),
    best as (
      select distinct on ("itemId")
             "itemId", code, designation, "matchedAlias", "matchedOn", score
      from hits
      where score >= ${MATCH_FLOOR}
      order by "itemId", score desc
    )
    select * from best order by score desc, designation limit ${limit}
  `);
}

/**
 * Remember that this wording means this item.
 *
 * `partyId` is whose word it is — the client who wrote it, or the supplier who
 * quoted it. Keeping that is what lets the offer builder print the right one
 * for the right audience later, instead of one flattened name.
 */
export async function rememberAlias(opts: {
  itemId: string;
  alias: string;
  source: AliasSource;
  partyId?: string | null;
  preferOnOffer?: boolean;
}) {
  const alias = opts.alias.trim();
  if (!alias) return;

  await db
    .insert(itemAlias)
    .values({
      itemId: opts.itemId,
      alias,
      source: opts.source,
      partyId: opts.partyId ?? null,
      preferOnOffer: opts.preferOnOffer ?? false,
    })
    .onConflictDoNothing();
}

/**
 * The pairing screen 75 draws in "Remembered for next time": a client wording
 * on the left, the supplier article it was matched to on the right.
 *
 * Both are stored as aliases of the same item, which is what makes the memory
 * work across clients — the next enquiry that says "Mégaphone portatif 25W"
 * finds the item, and the item already knows what the supplier calls it.
 */
export async function rememberMatch(opts: {
  itemId: string;
  clientWording: string;
  clientPartyId?: string | null;
  supplierWording: string;
  supplierPartyId?: string | null;
}) {
  await rememberAlias({
    itemId: opts.itemId,
    alias: opts.clientWording,
    source: "client",
    partyId: opts.clientPartyId ?? null,
  });
  await rememberAlias({
    itemId: opts.itemId,
    alias: opts.supplierWording,
    source: "supplier",
    partyId: opts.supplierPartyId ?? null,
  });
}

/** Every name this item has, so a screen can show what it will be recognised by. */
export async function itemAliases(itemId: string) {
  return db
    .select({
      alias: itemAlias.alias,
      source: itemAlias.source,
      partyId: itemAlias.partyId,
      preferOnOffer: itemAlias.preferOnOffer,
    })
    .from(itemAlias)
    .where(eq(itemAlias.itemId, itemId));
}

/** ITM-0412. Allocated inside the insert, like every other reference here. */
async function nextItemCode(tx: typeof db): Promise<string> {
  const [row] = await tx.execute<{ next: number }>(sql`
    select coalesce(max(substring(code from 5)::int), 0) + 1 as next
    from item where code like 'ITM-%'
  `);
  return `ITM-${String(row?.next ?? 1).padStart(4, "0")}`;
}

export async function createItem(input: {
  designation: string;
  kind: "good" | "service";
  brand?: string | null;
  model?: string | null;
  unit?: string | null;
  isGeneric?: boolean;
}) {
  const designation = input.designation.trim();
  if (designation.length < 2) throw new Error("designationRequired");

  return db.transaction(async (tx) => {
    const code = await nextItemCode(tx as unknown as typeof db);
    const [created] = await tx
      .insert(item)
      .values({
        code,
        designation,
        kind: input.kind,
        brand: input.brand ?? null,
        model: input.model ?? null,
        unit: input.unit ?? null,
        isGeneric: input.isGeneric ?? false,
      })
      .returning({ id: item.id, code: item.code });
    return created as { id: string; code: string };
  });
}

/** Items that have not been merged away. Screen 84 applies here too. */
export const liveItem = isNull(item.supersededBy);

export async function getItem(id: string) {
  const [row] = await db
    .select()
    .from(item)
    .where(and(eq(item.id, id), liveItem))
    .limit(1);
  return row ?? null;
}
