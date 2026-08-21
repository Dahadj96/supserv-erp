import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { party, partyAlias, person } from "@/db/schema/party";

/**
 * Screen 84 — everything the merge screen has to show BEFORE anything happens.
 *
 * Two rules govern this file.
 *
 * "Suggested, never automatic" — so the signals are reported, not acted on. The
 * screen says which of the five matched and which did not, including the ones
 * that did not, because "Same phone — not here" is information too.
 *
 * "Nothing is dropped, nothing is duplicated" — so the counts are real counts
 * read from the database, never a guess. A row that no part of the system can
 * yet count does not appear at all: an empty row reading 0 would be a claim we
 * have not earned. Rows arrive as their tables do.
 */

export type MergeSide = typeof party.$inferSelect & { aliases: string[] };

export type SignalKey = "rc" | "nif" | "emailDomain" | "similarName" | "phone";

export type MergeSignal = {
  key: SignalKey;
  matched: boolean;
  /** The matching value, when there is one worth showing (the email domain). */
  detail: string | null;
};

/** One line of "What moves across". `key` is a message key, not a label. */
export type MoveRow = {
  key: string;
  kept: number;
  retired: number;
  after: number;
};

export type MergePreview = {
  kept: MergeSide;
  retired: MergeSide;
  signals: MergeSignal[];
  moves: MoveRow[];
  /** Aliases are never a choice — this is the size of the union, not a sum. */
  aliasesAfter: number;
};

/** Aliases the retired record contributes, by the same rule `mergeParties` uses. */
export function aliasUnion(kept: MergeSide, retired: MergeSide): string[] {
  const seen = new Set([kept.legalName.toLowerCase()]);
  const out: string[] = [];
  const candidates = [
    ...kept.aliases,
    ...retired.aliases,
    retired.code,
    retired.legalName,
    ...(retired.tradeName ? [retired.tradeName] : []),
  ];
  for (const alias of candidates) {
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

async function loadSide(id: string): Promise<MergeSide | null> {
  const [row] = await db.select().from(party).where(eq(party.id, id)).limit(1);
  if (!row) return null;
  const aliases = await db
    .select({ alias: partyAlias.alias })
    .from(partyAlias)
    .where(eq(partyAlias.partyId, id));
  return { ...row, aliases: aliases.map((a) => a.alias) };
}

/**
 * The same similarity function the suggester uses. Asking the database rather
 * than reimplementing it in JavaScript is deliberate: if the two ever disagree,
 * the screen would flag a pair it cannot explain.
 */
const SIMILAR_NAME_FLOOR = 0.55;

async function readSignals(keptId: string, retiredId: string): Promise<MergeSignal[]> {
  const rows = await db.execute<{
    rc: boolean;
    nif: boolean;
    phone: boolean;
    domain: string | null;
    nameScore: number;
  }>(sql`
    select
      (a.rc is not null and a.rc = b.rc) as rc,
      (a.nif is not null and a.nif = b.nif) as nif,
      (a.phone is not null and a.phone = b.phone) as phone,
      case
        when a.email is not null and b.email is not null
         and split_part(a.email, '@', 2) = split_part(b.email, '@', 2)
        then split_part(a.email, '@', 2)
      end as domain,
      similarity(immutable_unaccent(lower(a.legal_name)),
                 immutable_unaccent(lower(b.legal_name))) as "nameScore"
    from party a, party b
    where a.id = ${keptId} and b.id = ${retiredId}
  `);

  const r = rows[0];
  return [
    { key: "rc", matched: r?.rc === true, detail: null },
    { key: "nif", matched: r?.nif === true, detail: null },
    { key: "emailDomain", matched: r?.domain != null, detail: r?.domain ?? null },
    { key: "similarName", matched: (r?.nameScore ?? 0) > SIMILAR_NAME_FLOOR, detail: null },
    { key: "phone", matched: r?.phone === true, detail: null },
  ];
}

/**
 * Documents are counted by kind and never moved — `mergeParties` repoints
 * nothing. "After" is therefore the effective count a person will see once the
 * two records resolve to one, which is the sum.
 */
async function readMoves(keptId: string, retiredId: string): Promise<MoveRow[]> {
  const docs = await db
    .select({
      kind: document.kind,
      partyId: document.partyId,
      n: sql<number>`count(*)::int`,
    })
    .from(document)
    .where(inArray(document.partyId, [keptId, retiredId]))
    .groupBy(document.kind, document.partyId);

  const contacts = await db
    .select({ partyId: person.employerPartyId, n: sql<number>`count(*)::int` })
    .from(person)
    .where(and(inArray(person.employerPartyId, [keptId, retiredId]), isNull(person.deletedAt)))
    .groupBy(person.employerPartyId);

  const rows = new Map<string, MoveRow>();
  const bump = (key: string, side: "kept" | "retired", n: number) => {
    const row = rows.get(key) ?? { key, kept: 0, retired: 0, after: 0 };
    row[side] += n;
    row.after = row.kept + row.retired;
    rows.set(key, row);
  };

  for (const d of docs) {
    bump(`document.${d.kind}`, d.partyId === keptId ? "kept" : "retired", d.n);
  }
  for (const c of contacts) {
    bump("contacts", c.partyId === keptId ? "kept" : "retired", c.n);
  }

  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function mergePreview(
  keptId: string,
  retiredId: string,
): Promise<MergePreview | null> {
  if (keptId === retiredId) return null;
  const [kept, retired] = await Promise.all([loadSide(keptId), loadSide(retiredId)]);
  if (!kept || !retired) return null;
  if (kept.supersededBy || retired.supersededBy) return null;

  const [signals, moves] = await Promise.all([
    readSignals(keptId, retiredId),
    readMoves(keptId, retiredId),
  ]);

  const union = aliasUnion(kept, retired);
  return { kept, retired, signals, moves, aliasesAfter: union.length };
}

/** The fields a person is asked about, in the order screen 84 asks them. */
export const MERGE_FIELDS = [
  "legalName",
  "nif",
  "nis",
  "rc",
  "ai",
  "address",
  "wilaya",
  "email",
  "phone",
  "docLocale",
  "paymentTerms",
] as const;

export type MergeField = (typeof MERGE_FIELDS)[number];

/**
 * What the screen proposes before anybody touches it.
 *
 * The left record is kept, so it wins by default — except where that would
 * throw away the only value there is, and except for payment terms, where
 * screen 84 is explicit: "the newer record is right — it came off the last
 * signed contract." That is a rule about how this company works, not a
 * preference, which is why it lives here and not in the page.
 */
export function defaultChoices(
  kept: MergeSide,
  retired: MergeSide,
): Record<MergeField, "kept" | "retired"> {
  const out = {} as Record<MergeField, "kept" | "retired">;
  const newerSide = retired.createdAt > kept.createdAt ? "retired" : "kept";

  for (const field of MERGE_FIELDS) {
    const a = kept[field];
    const b = retired[field];
    if (field === "paymentTerms") {
      const newerValue = newerSide === "retired" ? b : a;
      out[field] = newerValue ? newerSide : a ? "kept" : "retired";
      continue;
    }
    out[field] = a ? "kept" : b ? "retired" : "kept";
  }
  return out;
}
