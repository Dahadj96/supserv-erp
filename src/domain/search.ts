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

/**
 * Archived companies stay findable on purpose. That is the difference between
 * archive and the bin (screen 83): a binned record is on its way out, an
 * archived one is finished business you may still need to look up. Only
 * `deleted_at` and `superseded_by` are excluded above.
 */

export type PersonHit = {
  id: string;
  fullName: string;
  trade: string;
  /** external = a contact (screen 76); anything else is one of ours (51). */
  relationship: string;
  companyId: string | null;
  companyName: string | null;
  matchedOn: "name" | "trade" | "email";
  score: number;
};

/**
 * People and contacts are one table and one search. Somebody typing "Kaddour"
 * does not know or care which of the two screens he is on, and being asked to
 * guess is exactly the kind of thing this system exists to stop.
 */
export async function searchPeople(term: string, limit = 20): Promise<PersonHit[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];

  const rows = await db.execute<PersonHit & { score: string }>(sql`
    with q as (select immutable_unaccent(${q}) as needle)
    select
      p.id,
      p.full_name as "fullName",
      p.trade,
      p.relationship,
      c.id        as "companyId",
      c.legal_name as "companyName",
      greatest(
        similarity(immutable_unaccent(lower(p.full_name)), q.needle),
        coalesce(similarity(immutable_unaccent(lower(p.trade)), q.needle), 0) * 0.6,
        case when immutable_unaccent(lower(coalesce(p.email, ''))) like '%' || q.needle || '%'
             then 0.9 else 0 end
      ) as score,
      case
        when immutable_unaccent(lower(p.full_name)) like '%' || q.needle || '%' then 'name'
        when immutable_unaccent(lower(coalesce(p.email, ''))) like '%' || q.needle || '%'
          then 'email'
        when immutable_unaccent(lower(p.trade)) like '%' || q.needle || '%' then 'trade'
        else 'name'
      end as "matchedOn"
    from person p
    left join party c on c.id = p.employer_party_id
    cross join q
    where p.deleted_at is null
      and p.superseded_by is null
      and (
        immutable_unaccent(lower(p.full_name)) like '%' || q.needle || '%'
        or immutable_unaccent(lower(p.trade)) like '%' || q.needle || '%'
        or immutable_unaccent(lower(coalesce(p.email, ''))) like '%' || q.needle || '%'
        or similarity(immutable_unaccent(lower(p.full_name)), q.needle) > ${SIMILARITY_FLOOR}
      )
    order by score desc, p.full_name asc
    limit ${limit}
  `);

  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

export type ItemHit = {
  id: string;
  code: string;
  designation: string;
  brand: string | null;
  matchedAlias: string | null;
  matchedOn: "code" | "designation" | "alias";
  score: number;
};

/**
 * Items carry the same alias memory companies do (screen 75), so searching what
 * the supplier called something finds what the client called it.
 */
export async function searchItems(term: string, limit = 20): Promise<ItemHit[]> {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];

  const rows = await db.execute<ItemHit & { score: string }>(sql`
    with q as (select immutable_unaccent(${q}) as needle)
    select
      i.id,
      i.code,
      i.designation,
      i.brand,
      (
        select a.alias from item_alias a, q
        where a.item_id = i.id
        order by similarity(immutable_unaccent(lower(a.alias)), q.needle) desc
        limit 1
      ) as "matchedAlias",
      greatest(
        case when lower(i.code) = q.needle then 1.0 else 0 end,
        similarity(immutable_unaccent(lower(i.designation)), q.needle),
        coalesce((
          select max(similarity(immutable_unaccent(lower(a.alias)), q.needle))
          from item_alias a where a.item_id = i.id
        ), 0)
      ) as score,
      case
        when lower(i.code) = q.needle then 'code'
        when immutable_unaccent(lower(i.designation)) like '%' || q.needle || '%'
          then 'designation'
        else 'alias'
      end as "matchedOn"
    from item i
    cross join q
    where i.superseded_by is null
      and (
        lower(i.code) = q.needle
        or immutable_unaccent(lower(i.designation)) like '%' || q.needle || '%'
        or similarity(immutable_unaccent(lower(i.designation)), q.needle) > ${SIMILARITY_FLOOR}
        or exists (
          select 1 from item_alias a
          where a.item_id = i.id
            and (
              immutable_unaccent(lower(a.alias)) like '%' || q.needle || '%'
              or similarity(immutable_unaccent(lower(a.alias)), q.needle) > ${SIMILARITY_FLOOR}
            )
        )
      )
    order by score desc, i.designation asc
    limit ${limit}
  `);

  return rows.map((r) => ({ ...r, score: Number(r.score) }));
}

/** What screen 82 can look in today. Documents, files and email follow. */
export const SEARCH_SCOPES = ["all", "companies", "people", "items"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export function isSearchScope(value: string | undefined): value is SearchScope {
  return SEARCH_SCOPES.includes(value as SearchScope);
}
