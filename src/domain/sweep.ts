import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party, person } from "@/db/schema/party";
import {
  DocumentIsIssued,
  discardDeal,
  discardDocument,
  discardParty,
  discardPerson,
  NotDiscardable,
  PersonOnSite,
  peopleOnSite,
} from "./deletion";

/**
 * "Clear my test data" — screen 29, one deliberate act.
 *
 * Somebody learning an ERP types into it. Six weeks of that leaves a database
 * of companies that do not exist, enquiries nobody sent, and drafts of
 * documents for both. Until this file the only way out was to open each row and
 * press Remove, which is why nobody did, which is why the lists people were
 * meant to trust were half invented.
 *
 * THREE THINGS THIS IS NOT.
 *
 * It is not a delete. Every row it touches goes through the same
 * `discardParty` / `discardDeal` / `discardDocument` / `discardPerson` that
 * screens 22, 06, 18, 76 and 51 press one at a time — so every guard those
 * carry still bites, every audit entry is still written, and everything it
 * takes is in the bin for thirty days and comes back with one press. Nothing
 * here writes an `UPDATE`, and nothing here could write a `DELETE`.
 *
 * It is not a reset. There is no seed data in this system (CLAUDE.md), so there
 * is nothing to restore to. What it clears is what a person typed, and a person
 * chooses the moment before which they were still learning.
 *
 * It is not allowed to touch paper. A company or an enquiry carrying an issued
 * document is skipped and counted, never forced — LAW 5 outranks tidiness, and
 * a sweep that quietly binned four of five things a person asked for would be
 * worse than one that refused all five, because only the second is noticed.
 *
 * ─── ORDER, AND WHY IT DOES NOT CASCADE ──────────────────────────────────
 *
 * Discarding a company does not discard its enquiries; an enquiry's drafts are
 * separate rows again. So the sweep could have cascaded downwards — take a
 * company and everything hanging off it. It deliberately does not. A cut-off is
 * a MOMENT a person chose, not a tree: cascading would let "everything before
 * the first of September" reach an enquiry typed yesterday because the company
 * it sits on is old, and that is exactly the surprise this feature cannot
 * afford.
 *
 * What it does instead is run child first — documents, then enquiries, then
 * people, then companies — and refuse UPWARDS. By the time the company pass
 * runs, every draft and every enquiry the cut-off covers is already in the bin,
 * so anything still live on a company is something the cut-off did NOT cover.
 * A company with one of those is skipped and reported. That is what keeps the
 * sweep from leaving a live enquiry pointing at a binned client, which is the
 * one inconsistency a per-kind sweep would otherwise create.
 *
 * A note is not swept. It is the only row on a timeline nothing else in the
 * system holds a copy of — somebody put the phone down and typed it — and it
 * is reached through the record it is about, so a note on a binned enquiry is
 * already out of sight. Removing them wholesale would destroy the one thing
 * here that is not recoverable from anywhere else.
 */

/**
 * Child first. The array IS the algorithm — every pass reads the result of the
 * ones above it, so reordering these four words changes what the sweep does.
 */
export const SWEEP_ORDER = ["document", "deal", "person", "company"] as const;
export type SweepKind = (typeof SWEEP_ORDER)[number];

/**
 * Why a row was left alone.
 *
 *   issued    it is, or carries, paper that has left the building (LAW 5)
 *   attached  something live still points at it that the cut-off does not cover
 *   onSite    a person who has not left a site crew — screen 16 still draws them
 *   failed    it refused between the preview and the press
 */
export type SweepSkipReason = "issued" | "attached" | "onSite" | "failed";

export type SweepSkip = { kind: SweepKind; reason: SweepSkipReason; count: number };

/** Enough to recognise a row on the preview without opening it. */
export type SweepCandidate = { id: string; label: string };

export type SweepCounts = Record<SweepKind, number>;

export type SweepPlan = {
  before: Date;
  take: Record<SweepKind, SweepCandidate[]>;
  skipped: SweepSkip[];
};

export type SweepOutcome = {
  before: Date;
  discarded: SweepCounts;
  skipped: SweepSkip[];
};

const NONE: SweepCounts = { document: 0, deal: 0, person: 0, company: 0 };

export function sweepCounts(plan: SweepPlan): SweepCounts {
  return {
    document: plan.take.document.length,
    deal: plan.take.deal.length,
    person: plan.take.person.length,
    company: plan.take.company.length,
  };
}

export function sweepTotal(counts: SweepCounts): number {
  return counts.document + counts.deal + counts.person + counts.company;
}

export function skippedTotal(skipped: SweepSkip[]): number {
  return skipped.reduce((n, s) => n + s.count, 0);
}

/** `inArray` with an empty list is not a query worth sending. */
async function forIds<T>(ids: string[], run: () => Promise<T[]>): Promise<T[]> {
  return ids.length === 0 ? [] : run();
}

/**
 * What the sweep WOULD do, without doing any of it.
 *
 * Read by the preview and again by the sweep itself, so the two cannot
 * disagree about what was about to happen — the numbers on the confirmation
 * are the numbers the loop then walks.
 */
export async function planSweep(before: Date): Promise<SweepPlan> {
  const skipped: SweepSkip[] = [];
  const note = (kind: SweepKind, reason: SweepSkipReason, count: number) => {
    if (count > 0) skipped.push({ kind, reason, count });
  };

  // ── 1 · Drafts ──────────────────────────────────────────────────────────
  // `number is null AND locked_at is null` — both, exactly as `discardDocument`
  // refuses on. Everything else with a date before the cut-off is paper, and is
  // counted so the preview can say how much it is leaving alone rather than
  // saying nothing about it.
  const drafts = await db
    .select({ id: document.id, label: document.kind })
    .from(document)
    .where(
      and(
        isNull(document.deletedAt),
        isNull(document.number),
        isNull(document.lockedAt),
        lt(document.createdAt, before),
      ),
    );
  const [issuedDocs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(document)
    .where(
      and(
        isNull(document.deletedAt),
        lt(document.createdAt, before),
        or(isNotNull(document.number), isNotNull(document.lockedAt)),
      ),
    );
  note("document", "issued", issuedDocs?.n ?? 0);

  const draftIds = new Set(drafts.map((d) => d.id));

  // ── 2 · Deals ───────────────────────────────────────────────────────────
  const dealRows = await db
    .select({ id: deal.id, label: deal.subject, ref: deal.ref })
    .from(deal)
    .where(and(isNull(deal.deletedAt), lt(deal.createdAt, before)));
  const dealIds = dealRows.map((d) => d.id);

  const dealDocs = await forIds(dealIds, () =>
    db
      .select({ id: document.id, dealId: document.dealId, number: document.number })
      .from(document)
      .where(and(isNull(document.deletedAt), inArray(document.dealId, dealIds))),
  );

  const dealHasIssued = new Set<string>();
  const dealHasLive = new Set<string>();
  for (const row of dealDocs) {
    if (!row.dealId) continue;
    if (row.number !== null) dealHasIssued.add(row.dealId);
    // A draft the cut-off does not cover — typed after the moment the person
    // chose. Binning its enquiry would leave it pointing at a page that no
    // longer renders, so the enquiry stays too.
    else if (!draftIds.has(row.id)) dealHasLive.add(row.dealId);
  }

  const deals = dealRows.filter((d) => !dealHasIssued.has(d.id) && !dealHasLive.has(d.id));
  note("deal", "issued", dealRows.filter((d) => dealHasIssued.has(d.id)).length);
  note(
    "deal",
    "attached",
    dealRows.filter((d) => !dealHasIssued.has(d.id) && dealHasLive.has(d.id)).length,
  );
  const dealTakeIds = new Set(deals.map((d) => d.id));

  // ── 3 · People ──────────────────────────────────────────────────────────
  // A person is a leaf: nothing in this system is a document to a person, and
  // the one thing that refuses is a man standing on a site.
  const personRows = await db
    .select({ id: person.id, label: person.fullName, employer: person.employerPartyId })
    .from(person)
    .where(
      and(isNull(person.deletedAt), isNull(person.supersededBy), lt(person.createdAt, before)),
    );
  const onSite = await peopleOnSite(personRows.map((p) => p.id));
  const people = personRows.filter((p) => (onSite.get(p.id) ?? 0) === 0);
  note("person", "onSite", personRows.length - people.length);
  const personTakeIds = new Set(people.map((p) => p.id));

  // ── 4 · Companies ───────────────────────────────────────────────────────
  // Archived and merged-away companies are not candidates at all. Both are
  // deliberate acts somebody performed on that row, and quietly undoing one by
  // moving it somewhere else is not what "clear the test data" was asked for.
  const partyRows = await db
    .select({ id: party.id, label: party.legalName, code: party.code })
    .from(party)
    .where(
      and(
        isNull(party.deletedAt),
        isNull(party.archivedAt),
        isNull(party.supersededBy),
        lt(party.createdAt, before),
      ),
    );
  const partyIds = partyRows.map((p) => p.id);

  const partyDocs = await forIds(partyIds, () =>
    db
      .select({ id: document.id, partyId: document.partyId, number: document.number })
      .from(document)
      .where(and(isNull(document.deletedAt), inArray(document.partyId, partyIds))),
  );
  const partyDeals = await forIds(partyIds, () =>
    db
      .select({ id: deal.id, partyId: deal.partyId })
      .from(deal)
      .where(and(isNull(deal.deletedAt), inArray(deal.partyId, partyIds))),
  );

  const partyHasIssued = new Set<string>();
  const partyHasLive = new Set<string>();
  for (const row of partyDocs) {
    if (row.number !== null) partyHasIssued.add(row.partyId);
    else if (!draftIds.has(row.id)) partyHasLive.add(row.partyId);
  }
  for (const row of partyDeals) {
    if (!dealTakeIds.has(row.id)) partyHasLive.add(row.partyId);
  }
  for (const row of personRows) {
    if (row.employer && !personTakeIds.has(row.id)) partyHasLive.add(row.employer);
  }
  // A contact or a welder created AFTER the cut-off still holds their employer
  // here, and the query above only read the ones before it.
  const laterPeople = await forIds(partyIds, () =>
    db
      .select({ employer: person.employerPartyId })
      .from(person)
      .where(
        and(
          isNull(person.deletedAt),
          isNotNull(person.employerPartyId),
          inArray(person.employerPartyId, partyIds),
          gte(person.createdAt, before),
        ),
      ),
  );
  for (const row of laterPeople) if (row.employer) partyHasLive.add(row.employer);

  const companies = partyRows.filter((p) => !partyHasIssued.has(p.id) && !partyHasLive.has(p.id));
  note("company", "issued", partyRows.filter((p) => partyHasIssued.has(p.id)).length);
  note(
    "company",
    "attached",
    partyRows.filter((p) => !partyHasIssued.has(p.id) && partyHasLive.has(p.id)).length,
  );

  return {
    before,
    take: {
      document: drafts,
      deal: deals.map((d) => ({ id: d.id, label: d.label || d.ref })),
      person: people.map((p) => ({ id: p.id, label: p.label })),
      company: companies.map((p) => ({ id: p.id, label: p.label || p.code })),
    },
    skipped,
  };
}

/**
 * The audit entry for the sweep ITSELF, beside the one per record the discard
 * functions already write.
 *
 * Without it screen 32 shows sixty discards a minute apart with no cause, which
 * reads as an accident. With it the log shows one deliberate act, who performed
 * it, the moment they chose, and what it refused to touch — and the sixty
 * underneath are its consequences.
 *
 * Flat scalar fields, because `changedFields` renders `after` field by field
 * and a nested object arrives as JSON in a table cell. `skipped_<kind>_<reason>`
 * is written by `auditFields` and read back by `sweepFromFields`, so the two
 * ends of that contract sit ten lines apart.
 */
function auditFields(outcome: SweepOutcome): Record<string, string | number> {
  const fields: Record<string, string | number> = {
    before: outcome.before.toISOString(),
    companies: outcome.discarded.company,
    deals: outcome.discarded.deal,
    drafts: outcome.discarded.document,
    people: outcome.discarded.person,
  };
  for (const s of outcome.skipped) fields[`skipped_${s.kind}_${s.reason}`] = s.count;
  return fields;
}

export function sweepFromFields(after: unknown): SweepOutcome | null {
  if (typeof after !== "object" || after === null) return null;
  const row = after as Record<string, unknown>;
  const at = typeof row.before === "string" ? new Date(row.before) : null;
  if (!at || Number.isNaN(at.getTime())) return null;

  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const skipped: SweepSkip[] = [];
  for (const [key, value] of Object.entries(row)) {
    const m = key.match(/^skipped_(\w+?)_(\w+)$/);
    if (!m) continue;
    const kind = m[1] as SweepKind;
    const reason = m[2] as SweepSkipReason;
    if (!SWEEP_ORDER.includes(kind)) continue;
    skipped.push({ kind, reason, count: n(value) });
  }

  return {
    before: at,
    discarded: {
      company: n(row.companies),
      deal: n(row.deals),
      document: n(row.drafts),
      person: n(row.people),
    },
    skipped,
  };
}

/** The sweep as one row on screen 32, read back by the page that ran it. */
export async function readSweep(id: number): Promise<SweepOutcome | null> {
  const [row] = await db
    .select({ after: auditEntry.after })
    .from(auditEntry)
    .where(and(eq(auditEntry.id, id), eq(auditEntry.entity, "sweep")))
    .limit(1);
  return row ? sweepFromFields(row.after) : null;
}

/**
 * Do it — through the four per-record functions, one press at a time.
 *
 * The plan is recomputed here rather than handed in. A preview is a photograph
 * of a moment, and between the photograph and the press somebody in Adrar may
 * have issued an invoice on one of these enquiries; recomputing means the guard
 * that would refuse it is consulted against the world as it is now, not as it
 * was when the page rendered.
 */
export async function runSweep(opts: {
  before: Date;
  reason: string;
  actorId: string;
}): Promise<{ id: number; outcome: SweepOutcome }> {
  const plan = await planSweep(opts.before);
  const discarded: SweepCounts = { ...NONE };
  const failed: SweepCounts = { ...NONE };

  const discardOne = async (kind: SweepKind, id: string) => {
    const one = { id, reason: opts.reason, actorId: opts.actorId, fromWhere: "29" };
    if (kind === "document") await discardDocument(one);
    else if (kind === "deal") await discardDeal(one);
    else if (kind === "person") await discardPerson(one);
    else await discardParty(one);
  };

  let thrown: unknown = null;
  try {
    for (const kind of SWEEP_ORDER) {
      for (const row of plan.take[kind]) {
        try {
          await discardOne(kind, row.id);
          discarded[kind] += 1;
        } catch (error) {
          // The three refusals, said out loud by the count rather than by
          // stopping. Anything else is a real fault and stops the sweep.
          if (
            error instanceof NotDiscardable ||
            error instanceof DocumentIsIssued ||
            error instanceof PersonOnSite
          ) {
            failed[kind] += 1;
            continue;
          }
          throw error;
        }
      }
    }
  } catch (error) {
    thrown = error;
  }

  const skipped = [...plan.skipped];
  for (const kind of SWEEP_ORDER) {
    if (failed[kind] > 0) skipped.push({ kind, reason: "failed", count: failed[kind] });
  }
  const outcome: SweepOutcome = { before: opts.before, discarded, skipped };

  // Written even when the loop stopped early, and written last so that on
  // screen 32 — newest first — it sits above the records it explains.
  const [entry] = await db
    .insert(auditEntry)
    .values({
      actorId: opts.actorId,
      entity: "sweep",
      action: "sweep",
      after: { ...auditFields(outcome), ...(thrown ? { stoppedEarly: 1 } : {}) },
      reason: opts.reason.trim() || null,
      sourceScreen: "29",
    })
    .returning({ id: auditEntry.id });

  if (thrown) throw thrown;
  return { id: entry?.id as number, outcome };
}
