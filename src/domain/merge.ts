import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { user } from "@/db/schema/auth";
import { auditEntry, duplicateDismissal, mergeLog } from "@/db/schema/control";
import { party, partyAlias, person } from "@/db/schema/party";

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
  /** The contact made from the losing email address, if one was made. */
  contactCreated: { id: string; fullName: string; email: string } | null;
  mergeLogId: string;
};

/**
 * Screen 84: "the other one becomes a contact rather than being thrown away."
 *
 * But only if it is a person. `contact@touatgaz.dz` is a role, not a human, and
 * a contact card called "Contact" is worse than no contact card — somebody will
 * address an email to it.
 */
const ROLE_MAILBOXES = new Set([
  "contact",
  "info",
  "infos",
  "commercial",
  "commande",
  "commandes",
  "admin",
  "administration",
  "direction",
  "secretariat",
  "compta",
  "comptabilite",
  "facturation",
  "achat",
  "achats",
  "sales",
  "support",
  "hello",
  "office",
  "noreply",
  "no-reply",
  "ne-pas-repondre",
]);

/** "m.belkacem" becomes "M. Belkacem". Initials keep their full stop. */
export function nameFromEmail(email: string): string | null {
  const local = email.split("@")[0]?.toLowerCase().trim();
  if (!local) return null;
  if (ROLE_MAILBOXES.has(local.replace(/[._-]/g, ""))) return null;
  if (ROLE_MAILBOXES.has(local)) return null;

  const parts = local
    .split(/[._\-+]+/)
    .filter((p) => p.length > 0 && !/^\d+$/.test(p))
    .map((p) => p.replace(/\d+$/, ""))
    .filter(Boolean);

  if (parts.length === 0) return null;
  return parts
    .map((p) => (p.length === 1 ? `${p.toUpperCase()}.` : p[0]?.toUpperCase() + p.slice(1)))
    .join(" ");
}

/**
 * How long a merge can be put back.
 *
 * Thirty days, and the window is real rather than decorative: the column
 * `reversible_until` existed from the first day with nothing reading it. Long
 * enough that the person who notices — often the client, on a facture with the
 * wrong name — has time to say so; short enough that "reversible" does not
 * become a promise about a company that has traded under the merged record for
 * a year.
 */
const REVERSIBLE_DAYS = 30;

/** What `merge_log.reverses` holds. Everything the undo needs, nothing else. */
export type Reversal = {
  /** The kept row's values BEFORE the merge, for the fields it changed. */
  keptBefore: Record<string, unknown>;
  /** The aliases THIS merge added — not the ones already on the kept row. */
  aliasesAdded: string[];
  /** The contact made from the losing email address, if one was made. */
  contactCreatedId: string | null;
};

export class MergeRefused extends Error {
  constructor(
    readonly reason: "noSuchMerge" | "windowClosed" | "alreadyReversed" | "notLast" | "notRecorded",
  ) {
    super(reason);
    this.name = "MergeRefused";
  }
}

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
    for (const candidate of candidates) {
      const key = candidate.toLowerCase();
      if (existing.has(key) || key === kept.legalName.toLowerCase()) continue;
      existing.add(key);
      toAdd.push(candidate);
    }
    if (toAdd.length > 0) {
      await tx
        .insert(partyAlias)
        .values(toAdd.map((one) => ({ partyId: keptId, alias: one, source: "merge" })))
        .onConflictDoNothing();
    }

    // 3. The losing email becomes a contact rather than being thrown away.
    //    `trade` is required, so it is stored as the neutral marker
    //    "unspecified" and translated in the interface — a French string in a
    //    data column would break LAW 4 the moment somebody works in English.
    let contactCreated: MergeResult["contactCreated"] = null;
    const losingEmail = choices.email === "retired" ? kept.email : retired.email;
    if (losingEmail && losingEmail !== (choices.email === "retired" ? retired.email : kept.email)) {
      const fullName = nameFromEmail(losingEmail);
      if (fullName) {
        const [already] = await tx
          .select({ id: person.id })
          .from(person)
          .where(and(eq(person.email, losingEmail), isNull(person.deletedAt)))
          .limit(1);

        if (!already) {
          const [created] = await tx
            .insert(person)
            .values({
              fullName,
              trade: "unspecified",
              email: losingEmail,
              source: "import",
              relationship: "external",
              employerPartyId: keptId,
            })
            .returning({ id: person.id });
          if (created) contactCreated = { id: created.id, fullName, email: losingEmail };
        }
      }
    }

    // 4. Retire. Not delete — `deleted_at` stays null, because this record was
    //    never deleted and its documents must keep resolving.
    await tx.update(party).set({ supersededBy: keptId }).where(eq(party.id, retiredId));

    const [logged] = await tx
      .insert(mergeLog)
      .values({
        entity: "party",
        keptId,
        retiredId,
        fieldChoices: choices,
        mergedBy: actorId,
        // Everything the undo needs, and nothing it does not: the kept row's
        // values BEFORE this merge changed them, the aliases this merge added
        // (not the ones already there), and the contact it created if it did.
        reverses: {
          keptBefore: Object.fromEntries(
            Object.keys(updates).map((field) => [field, (kept as Record<string, unknown>)[field]]),
          ),
          aliasesAdded: toAdd,
          contactCreatedId: contactCreated?.id ?? null,
        } satisfies Reversal,
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
      contactCreated,
      mergeLogId: logged?.id ?? "",
    };
  });
}

export type ReversibleMerge = {
  mergeLogId: string;
  keptId: string;
  keptCode: string;
  keptName: string;
  retiredId: string;
  retiredCode: string;
  retiredName: string;
  mergedAt: Date;
  reversibleUntil: Date | null;
  mergedByName: string | null;
  /**
   * The fields the merge TOOK from the retired record, by name.
   *
   * `field_choices` was written on every merge and read by nothing, which made
   * "who decided this?" — the reason the column exists — a question only
   * answerable with psql. The banner names them, because "TOUATGAZ was merged
   * in" and "TOUATGAZ was merged in and took the payment terms" are different
   * things to be told when you are deciding whether to put it back.
   */
  took: string[];
};

/**
 * The merge on this company that can still be put back, if there is one.
 *
 * Screen 82 shows it as a banner on the KEPT company, because that is the
 * record somebody is looking at when they notice the name is wrong. Only the
 * most recent, and only while the window is open: two merges deep, undoing the
 * older one first would restore fields the newer one has since changed.
 */
export async function reversibleMerge(
  keptId: string,
  now = new Date(),
): Promise<ReversibleMerge | null> {
  const retired = alias(party, "retired");

  const [row] = await db
    .select({
      mergeLogId: mergeLog.id,
      keptId: mergeLog.keptId,
      keptCode: party.code,
      keptName: party.legalName,
      retiredId: mergeLog.retiredId,
      retiredCode: retired.code,
      retiredName: retired.legalName,
      mergedAt: mergeLog.mergedAt,
      reversibleUntil: mergeLog.reversibleUntil,
      mergedByName: user.name,
      fieldChoices: mergeLog.fieldChoices,
    })
    .from(mergeLog)
    .innerJoin(party, eq(party.id, mergeLog.keptId))
    .innerJoin(retired, eq(retired.id, mergeLog.retiredId))
    .leftJoin(user, eq(user.id, mergeLog.mergedBy))
    .where(
      and(
        eq(mergeLog.keptId, keptId),
        isNull(mergeLog.reversedAt),
        // A merge made before this was recorded cannot be put back, so the
        // banner does not offer it. See `notRecorded`.
        isNotNull(mergeLog.reverses),
      ),
    )
    .orderBy(desc(mergeLog.mergedAt))
    .limit(1);

  if (!row) return null;
  if (row.reversibleUntil && row.reversibleUntil.getTime() < now.getTime()) return null;

  const { fieldChoices, ...rest } = row;
  const choices = (fieldChoices ?? {}) as FieldChoices;
  return {
    ...rest,
    took: Object.entries(choices)
      .filter(([, winner]) => winner === "retired")
      .map(([field]) => field),
  };
}

/**
 * Put a merge back.
 *
 * The kept row's fields return to what they were, the aliases this merge added
 * go, the contact it made from the losing email address is retired, and the
 * retired company stops being retired. The log row STAYS, marked reversed:
 * the merge happened, and a record of it disappearing would be the second
 * wrong thing done to the same pair of companies.
 *
 * Refused once something newer has been done to the kept company by another
 * merge — undoing the older one would restore fields the newer one changed.
 */
export async function unmergeParties(opts: {
  mergeLogId: string;
  actorId: string;
  now?: Date;
}): Promise<{ keptId: string; retiredId: string }> {
  const now = opts.now ?? new Date();

  return db.transaction(async (tx) => {
    const [log] = await tx.select().from(mergeLog).where(eq(mergeLog.id, opts.mergeLogId)).limit(1);
    if (!log) throw new MergeRefused("noSuchMerge");
    if (log.reversedAt) throw new MergeRefused("alreadyReversed");
    if (log.reversibleUntil && log.reversibleUntil.getTime() < now.getTime()) {
      throw new MergeRefused("windowClosed");
    }

    const [newer] = await tx
      .select({ id: mergeLog.id })
      .from(mergeLog)
      .where(
        and(
          eq(mergeLog.keptId, log.keptId),
          isNull(mergeLog.reversedAt),
          // NOT the row itself, said with the id rather than left to the
          // comparison: Postgres keeps microseconds and a JavaScript Date has
          // milliseconds, so a row read back and compared to its own stored
          // timestamp is newer than itself.
          ne(mergeLog.id, log.id),
          gt(mergeLog.mergedAt, log.mergedAt),
        ),
      )
      .limit(1);
    if (newer) throw new MergeRefused("notLast");

    /*
      A merge made before this column existed. Clearing `superseded_by` and
      leaving the fields and the aliases as the merge left them would be a
      partial undo presented as a whole one — the worst of the three states.
      There is exactly one such row, made while this was being built.
    */
    const reversal = (log.reverses ?? null) as Reversal | null;
    if (!reversal) throw new MergeRefused("notRecorded");

    // 1. The kept row's own fields, back to what they were. A merge that chose
    //    nothing from the retired row changed nothing here, and this is empty.
    if (Object.keys(reversal.keptBefore).length > 0) {
      await tx.update(party).set(reversal.keptBefore).where(eq(party.id, log.keptId));
    }

    // 2. The aliases THIS merge added. Only those, and only the ones it wrote:
    //    an alias somebody typed by hand afterwards is theirs, not the merge's.
    if (reversal.aliasesAdded.length > 0) {
      await tx
        .delete(partyAlias)
        .where(
          and(
            eq(partyAlias.partyId, log.keptId),
            eq(partyAlias.source, "merge"),
            inArray(partyAlias.alias, reversal.aliasesAdded),
          ),
        );
    }

    // 3. The contact made from the losing email address. Retired, not deleted —
    //    somebody may have written to them in the meantime, and the note would
    //    lose its person.
    if (reversal?.contactCreatedId) {
      await tx
        .update(person)
        .set({
          deletedAt: now,
          deletedBy: opts.actorId,
          deleteReason: "merge reversed",
        })
        .where(and(eq(person.id, reversal.contactCreatedId), isNull(person.deletedAt)));
    }

    // 4. And the company stops being retired.
    await tx.update(party).set({ supersededBy: null }).where(eq(party.id, log.retiredId));

    await tx
      .update(mergeLog)
      .set({ reversedAt: now, reversedBy: opts.actorId })
      .where(eq(mergeLog.id, log.id));

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "party",
      entityId: log.retiredId,
      action: "update",
      before: { supersededBy: log.keptId },
      after: { supersededBy: null, mergeReversed: log.id },
      sourceScreen: "82",
    });

    return { keptId: log.keptId, retiredId: log.retiredId };
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
