import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry, duplicateDismissal, mergeLog } from "@/db/schema/control";
import { party, partyAlias } from "@/db/schema/party";

/**
 * Screen 84 — merge duplicates.
 *
 * THE DECISION THAT SHAPES THIS FILE: nothing is repointed.
 *
 * The obvious implementation moves the retired company's documents onto the
 * kept one. That breaks LAW 5 — an issued document is immutable, and its
 * counterparty is part of what was issued. So the retired row stays exactly
 * where it is, `superseded_by` points at the survivor, and every read follows
 * the chain. "Old links still work — they land on CL-0007" is then true by
 * construction rather than by a migration that has to be got right once.
 *
 * The counts on screen 84 are therefore effective counts, not moves.
 */

/** Left is kept and keeps its reference. Right is retired. */
export type FieldChoice = "kept" | "retired";

/** Which side wins for each field a person was asked about. */
export type FieldChoices = Partial<
  Record<
    | "legalName"
    | "tradeName"
    | "nif"
    | "nis"
    | "rc"
    | "ai"
    | "email"
    | "phone"
    | "address"
    | "wilaya"
    | "docLocale"
    | "paymentTerms",
    FieldChoice
  >
>;

export type MergeResult = {
  keptId: string;
  retiredId: string;
  aliasesAdded: string[];
  mergeLogId: string;
};

const REVERSIBLE_DAYS = 30;

export async function mergeParties(opts: {
  keptId: string;
  retiredId: string;
  choices: FieldChoices;
  actorId: string;
}): Promise<MergeResult> {
  const { keptId, retiredId, choices, actorId } = opts;
  if (keptId === retiredId) throw new Error("A company cannot be merged into itself");

  return db.transaction(async (tx) => {
    const [kept] = await tx.select().from(party).where(eq(party.id, keptId)).limit(1);
    const [retired] = await tx.select().from(party).where(eq(party.id, retiredId)).limit(1);
    if (!kept) throw new Error(`No company ${keptId}`);
    if (!retired) throw new Error(`No company ${retiredId}`);
    if (retired.supersededBy) throw new Error(`${retired.code} has already been merged`);
    if (kept.supersededBy) throw new Error(`${kept.code} has itself been merged away`);

    // 1. Field by field. Only the fields where the retired row won change.
    const updates: Record<string, unknown> = {};
    for (const [field, winner] of Object.entries(choices)) {
      if (winner === "retired") {
        updates[field] = (retired as Record<string, unknown>)[field];
      }
    }
    if (Object.keys(updates).length > 0) {
      await tx.update(party).set(updates).where(eq(party.id, keptId));
    }

    // 2. Aliases are never a choice — both lists are kept, added together.
    //    The retired code and legal name join them, which is what makes the old
    //    reference searchable forever.
    const retiredAliases = await tx
      .select({ alias: partyAlias.alias })
      .from(partyAlias)
      .where(eq(partyAlias.partyId, retiredId));

    const existing = new Set(
      (
        await tx
          .select({ alias: partyAlias.alias })
          .from(partyAlias)
          .where(eq(partyAlias.partyId, keptId))
      ).map((r) => r.alias.toLowerCase()),
    );

    const candidates = [
      ...retiredAliases.map((a) => a.alias),
      retired.code,
      retired.legalName,
      ...(retired.tradeName ? [retired.tradeName] : []),
    ];

    const toAdd: string[] = [];
    for (const alias of candidates) {
      const key = alias.toLowerCase();
      if (existing.has(key) || key === kept.legalName.toLowerCase()) continue;
      existing.add(key);
      toAdd.push(alias);
    }
    if (toAdd.length > 0) {
      await tx
        .insert(partyAlias)
        .values(toAdd.map((alias) => ({ partyId: keptId, alias, source: "merge" })))
        .onConflictDoNothing();
    }

    // 3. Retire. Not delete — `deleted_at` stays null, because this record was
    //    never deleted and its documents must keep resolving.
    await tx.update(party).set({ supersededBy: keptId }).where(eq(party.id, retiredId));

    const [logged] = await tx
      .insert(mergeLog)
      .values({
        entity: "party",
        keptId,
        retiredId,
        fieldChoices: choices,
        movedCounts: {},
        mergedBy: actorId,
        reversibleUntil: sql`now() + interval '${sql.raw(String(REVERSIBLE_DAYS))} days'`,
      })
      .returning({ id: mergeLog.id });

    await tx.insert(auditEntry).values({
      actorId,
      actorKind: "user",
      entity: "party",
      entityId: retiredId,
      action: "merge",
      before: { code: retired.code, legalName: retired.legalName },
      after: { supersededBy: keptId, keptCode: kept.code },
      sourceScreen: "84",
    });

    return {
      keptId,
      retiredId,
      aliasesAdded: toAdd,
      mergeLogId: logged?.id ?? "",
    };
  });
}

/**
 * "Not a duplicate" is remembered so the same pair is never suggested again.
 * Stored low-id-first so the pair is one row whichever order it is found in.
 */
export async function dismissDuplicate(opts: {
  aId: string;
  bId: string;
  actorId: string;
  reason?: string;
}) {
  const [aId, bId] = [opts.aId, opts.bId].sort();
  await db
    .insert(duplicateDismissal)
    .values({
      entity: "party",
      aId: aId as string,
      bId: bId as string,
      dismissedBy: opts.actorId,
      reason: opts.reason,
    })
    .onConflictDoNothing();
}

/**
 * Suggested, never automatic. Ranked the way screen 84 ranks them: same RC is
 * the strongest signal there is, then NIF, then email domain, then a similar
 * name once accents and spacing are stripped.
 */
export type DuplicateSuggestion = {
  aId: string;
  aCode: string;
  aName: string;
  bId: string;
  bCode: string;
  bName: string;
  signal: "rc" | "nif" | "email_domain" | "similar_name";
};

export async function suggestDuplicateParties(limit = 20): Promise<DuplicateSuggestion[]> {
  return db.execute<DuplicateSuggestion>(sql`
    with live as (
      select id, code, legal_name, nif, rc, email
      from party
      where deleted_at is null and superseded_by is null
    ),
    pairs as (
      select a.id as "aId", a.code as "aCode", a.legal_name as "aName",
             b.id as "bId", b.code as "bCode", b.legal_name as "bName",
             case
               when a.rc is not null and a.rc = b.rc then 'rc'
               when a.nif is not null and a.nif = b.nif then 'nif'
               when a.email is not null and b.email is not null
                 and split_part(a.email, '@', 2) = split_part(b.email, '@', 2) then 'email_domain'
               else 'similar_name'
             end as signal,
             case
               when a.rc is not null and a.rc = b.rc then 4
               when a.nif is not null and a.nif = b.nif then 3
               when a.email is not null and b.email is not null
                 and split_part(a.email, '@', 2) = split_part(b.email, '@', 2) then 2
               else 1
             end as strength
      from live a
      join live b on a.id < b.id
      where (a.rc is not null and a.rc = b.rc)
         or (a.nif is not null and a.nif = b.nif)
         or (a.email is not null and b.email is not null
             and split_part(a.email, '@', 2) = split_part(b.email, '@', 2))
         or similarity(immutable_unaccent(lower(a.legal_name)),
                       immutable_unaccent(lower(b.legal_name))) > 0.55
    )
    select p."aId", p."aCode", p."aName", p."bId", p."bCode", p."bName", p.signal
    from pairs p
    where not exists (
      select 1 from duplicate_dismissal d
      where d.entity = 'party' and d.a_id = least(p."aId", p."bId") and d.b_id = greatest(p."aId", p."bId")
    )
    order by p.strength desc, p."aName"
    limit ${limit}
  `);
}
