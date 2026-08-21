import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Screen 82. One company, many spellings.
 *
 * TOUATGAZ / Touat Gaz / TouatGaz JV / GTG must all return the same record.
 * Three mechanisms do that, in the order a person would expect:
 *
 *   1. An exact code match wins outright. Typing CL-0007 means CL-0007.
 *   2. A substring match — "touat" inside "GROUPEMENT TOUATGAZ".
 *   3. Trigram similarity — "Touat Gaz" against "TOUATGAZ", where the space
 *      breaks every other kind of matching.
 *
 * Aliases carry the rest. "GTG" resembles nothing, so it is not something an
 * algorithm can infer — it is something a person recorded once, on screen 84,
 * and every search after that gets it for free.
 *
 * LAW — search never becomes a way around a permission (PLAN §5). Nothing here
 * selects cost, margin or salary, so no index of them exists to leak.
 */

export type PartyHit = {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  /** The alias that matched, when it was an alias rather than the name. */
  matchedAlias: string | null;
  /**
   * Why this row is here. A person who types "GTG" and gets "GROUPEMENT
   * TOUATGAZ" needs to be told it was the alias, or the result looks wrong.
   */
  matchedOn: "code" | "name" | "alias";
  score: number;
};

/** Below this, results are noise rather than near-misses. */
const SIMILARITY_FLOOR = 0.22;

export async function searchParties(term: string, limit = 20): Promise<PartyHit[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];

  const rows = await db.execute<PartyHit & { score: string }>(sql`
    with q as (select immutable_unaccent(${q}) as needle)
    select
      p.id,
      p.code,
      p.legal_name  as "legalName",
      p.trade_name  as "tradeName",
      (
        select a.alias from party_alias a, q
        where a.party_id = p.id
        order by similarity(immutable_unaccent(lower(a.alias)), q.needle) desc
        limit 1
      ) as "matchedAlias",
      greatest(
        case when lower(p.code) = (select needle from q) then 1.0 else 0 end,
        similarity(immutable_unaccent(lower(p.legal_name)), (select needle from q)),
        coalesce(similarity(immutable_unaccent(lower(p.trade_name)), (select needle from q)), 0),
        coalesce((
          select max(similarity(immutable_unaccent(lower(a.alias)), (select needle from q)))
          from party_alias a where a.party_id = p.id
        ), 0)
      ) as score,
      case
        when lower(p.code) = (select needle from q) then 'code'
        when immutable_unaccent(lower(p.legal_name)) like '%' || (select needle from q) || '%'
          or immutable_unaccent(lower(coalesce(p.trade_name, ''))) like '%' || (select needle from q) || '%'
          then 'name'
        when exists (
          select 1 from party_alias a
          where a.party_id = p.id
            and immutable_unaccent(lower(a.alias)) like '%' || (select needle from q) || '%'
        ) then 'alias'
        when similarity(immutable_unaccent(lower(p.legal_name)), (select needle from q)) >
             coalesce((select max(similarity(immutable_unaccent(lower(a.alias)), (select needle from q)))
                       from party_alias a where a.party_id = p.id), 0)
          then 'name'
        else 'alias'
      end as "matchedOn"
    from party p, q
    where p.deleted_at is null
      and p.superseded_by is null
      and (
        lower(p.code) = q.needle
        or immutable_unaccent(lower(p.legal_name)) like '%' || q.needle || '%'
        or immutable_unaccent(lower(coalesce(p.trade_name, ''))) like '%' || q.needle || '%'
        or similarity(immutable_unaccent(lower(p.legal_name)), q.needle) > ${SIMILARITY_FLOOR}
        or exists (
          select 1 from party_alias a
          where a.party_id = p.id
            and (
              immutable_unaccent(lower(a.alias)) like '%' || q.needle || '%'
              or similarity(immutable_unaccent(lower(a.alias)), q.needle) > ${SIMILARITY_FLOOR}
            )
        )
      )
    order by score desc, p.legal_name asc
    limit ${limit}
  `);

  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}
