import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { party, person } from "@/db/schema/party";
import { restoreDeal, restoreDocument, restoreParty, restorePerson } from "@/domain/deletion";
import {
  planSweep,
  readSweep,
  runSweep,
  type SweepKind,
  type SweepSkipReason,
  sweepCounts,
} from "@/domain/sweep";

/**
 * Screen 29 — "Clear my test data", against the real database.
 *
 * The fixtures are dated in the year 2000 and the cut-off is June 2000, so the
 * sweep under test can only ever reach these rows. That is not a trick to make
 * the test pass: the integration suite shares one database and a sweep is
 * global by definition, so a cut-off of "now" here would bin every fixture
 * every other file in this folder depends on.
 */
const CUT = new Date("2000-06-01T00:00:00Z");
const BEFORE = new Date("2000-01-01T00:00:00Z");
const AFTER = new Date("2000-12-01T00:00:00Z");

const ACTOR = "test-sweeper";
const stamp = Date.now().toString().slice(-6);
const CODES = {
  junk: `TEST-SWEEP-JUNK-${stamp}`,
  paper: `TEST-SWEEP-PAPER-${stamp}`,
  busy: `TEST-SWEEP-BUSY-${stamp}`,
  later: `TEST-SWEEP-LATER-${stamp}`,
};

const ids = {
  junk: "",
  paper: "",
  busy: "",
  later: "",
  oldDeal: "",
  paperDeal: "",
  newDeal: "",
  draft: "",
  issued: "",
  newDraft: "",
  oldPerson: "",
  newPerson: "",
};

async function company(code: string, name: string, createdAt: Date): Promise<string> {
  const [row] = await db
    .insert(party)
    .values({ code, legalName: name, createdAt })
    .returning({ id: party.id });
  return row?.id as string;
}

async function enquiry(ref: string, partyId: string, createdAt: Date): Promise<string> {
  const [row] = await db
    .insert(deal)
    .values({ ref, partyId, subject: ref, receivedAt: createdAt, createdAt })
    .returning({ id: deal.id });
  return row?.id as string;
}

async function paper(opts: {
  partyId: string;
  dealId?: string;
  number?: string;
  createdAt: Date;
}): Promise<string> {
  const [row] = await db
    .insert(document)
    .values({
      kind: opts.number ? "invoice" : "quotation",
      number: opts.number ?? null,
      lockedAt: opts.number ? opts.createdAt : null,
      status: opts.number ? "issued" : "draft",
      partyId: opts.partyId,
      dealId: opts.dealId ?? null,
      locale: "fr",
      totals: {},
      createdAt: opts.createdAt,
    })
    .returning({ id: document.id });
  return row?.id as string;
}

beforeAll(async () => {
  ids.junk = await company(CODES.junk, "SARL Typed While Learning", BEFORE);
  ids.paper = await company(CODES.paper, "SARL Real Client", BEFORE);
  ids.busy = await company(CODES.busy, "SARL Still Working", BEFORE);
  ids.later = await company(CODES.later, "SARL Draft Since", BEFORE);

  // The three enquiries: one that should never have existed, one that has been
  // invoiced, and one typed after the moment the person chose.
  ids.oldDeal = await enquiry(`TEST-SWEEP-A-${stamp}`, ids.junk, BEFORE);
  ids.paperDeal = await enquiry(`TEST-SWEEP-B-${stamp}`, ids.paper, BEFORE);
  ids.newDeal = await enquiry(`TEST-SWEEP-C-${stamp}`, ids.busy, AFTER);

  ids.draft = await paper({ partyId: ids.junk, dealId: ids.oldDeal, createdAt: BEFORE });
  ids.issued = await paper({
    partyId: ids.paper,
    dealId: ids.paperDeal,
    number: `TEST/2000/${stamp}`,
    createdAt: BEFORE,
  });
  ids.newDraft = await paper({ partyId: ids.later, createdAt: AFTER });

  const [old] = await db
    .insert(person)
    .values({
      fullName: `Sweep Old ${stamp}`,
      trade: "soudeur",
      source: "direct",
      relationship: "candidate",
      createdAt: BEFORE,
    })
    .returning({ id: person.id });
  ids.oldPerson = old?.id as string;

  const [recent] = await db
    .insert(person)
    .values({
      fullName: `Sweep New ${stamp}`,
      trade: "soudeur",
      source: "direct",
      relationship: "candidate",
      createdAt: AFTER,
    })
    .returning({ id: person.id });
  ids.newPerson = recent?.id as string;
});

afterAll(async () => {
  await db
    .delete(document)
    .where(inArray(document.id, [ids.draft, ids.issued, ids.newDraft].filter(Boolean)));
  await db
    .delete(deal)
    .where(inArray(deal.id, [ids.oldDeal, ids.paperDeal, ids.newDeal].filter(Boolean)));
  await db.delete(person).where(inArray(person.id, [ids.oldPerson, ids.newPerson].filter(Boolean)));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(party).where(inArray(party.code, Object.values(CODES)));
});

function skip(
  skipped: { kind: SweepKind; reason: SweepSkipReason; count: number }[],
  kind: SweepKind,
  reason: SweepSkipReason,
): number {
  return skipped.find((s) => s.kind === kind && s.reason === reason)?.count ?? 0;
}

describe("clear my test data — one deliberate act", () => {
  it("previews exactly what it is about to take", async () => {
    const plan = await planSweep(CUT);
    const counts = sweepCounts(plan);

    expect(counts).toEqual({ company: 1, deal: 1, document: 1, person: 1 });
    expect(plan.take.company.map((r) => r.id)).toEqual([ids.junk]);
    expect(plan.take.deal.map((r) => r.id)).toEqual([ids.oldDeal]);
    expect(plan.take.document.map((r) => r.id)).toEqual([ids.draft]);
    expect(plan.take.person.map((r) => r.id)).toEqual([ids.oldPerson]);
  });

  it("says what it will refuse, and why, before anything happens", async () => {
    const plan = await planSweep(CUT);

    // The company and the enquiry that carry a sent invoice.
    expect(skip(plan.skipped, "company", "issued")).toBe(1);
    expect(skip(plan.skipped, "deal", "issued")).toBe(1);
    // The invoice itself, counted so the preview says what it is leaving.
    expect(skip(plan.skipped, "document", "issued")).toBe(1);
    // Two companies whose only live children were typed after the cut-off: one
    // an enquiry, one a draft. Binning either would leave a live row pointing
    // at a company in the bin.
    expect(skip(plan.skipped, "company", "attached")).toBe(2);
  });

  it("discards exactly the number it previewed, and writes one entry for the act", async () => {
    const plan = await planSweep(CUT);
    const { id, outcome } = await runSweep({ before: CUT, reason: "test data", actorId: ACTOR });

    expect(outcome.discarded).toEqual(sweepCounts(plan));

    // One audit entry per record — written by the four discard functions, not
    // by the sweep — plus exactly one for the sweep itself.
    const perRecord = await db
      .select({ entity: auditEntry.entity, entityId: auditEntry.entityId })
      .from(auditEntry)
      .where(and(eq(auditEntry.actorId, ACTOR), eq(auditEntry.action, "discard")));
    expect(perRecord).toHaveLength(4);
    expect(perRecord.map((r) => r.entityId).sort()).toEqual(
      [ids.junk, ids.oldDeal, ids.draft, ids.oldPerson].sort(),
    );

    const sweeps = await db
      .select({ id: auditEntry.id })
      .from(auditEntry)
      .where(and(eq(auditEntry.actorId, ACTOR), eq(auditEntry.entity, "sweep")));
    expect(sweeps).toHaveLength(1);

    const read = await readSweep(id);
    expect(read?.discarded).toEqual(outcome.discarded);
    expect(read?.before.toISOString()).toBe(CUT.toISOString());
  });

  it("never touches anything issued, or anything carrying it", async () => {
    const [invoice] = await db.select().from(document).where(eq(document.id, ids.issued));
    expect(invoice?.deletedAt, "an issued document is never deleted — LAW 5").toBeNull();

    const [client] = await db.select().from(party).where(eq(party.id, ids.paper));
    expect(client?.deletedAt, "nor the company that issued it").toBeNull();

    const [invoiced] = await db.select().from(deal).where(eq(deal.id, ids.paperDeal));
    expect(invoiced?.deletedAt, "nor the enquiry it answers").toBeNull();
  });

  it("leaves everything on the other side of the cut-off alone", async () => {
    const [recentDeal] = await db.select().from(deal).where(eq(deal.id, ids.newDeal));
    const [recentDraft] = await db.select().from(document).where(eq(document.id, ids.newDraft));
    const [recentPerson] = await db.select().from(person).where(eq(person.id, ids.newPerson));

    expect(recentDeal?.deletedAt).toBeNull();
    expect(recentDraft?.deletedAt).toBeNull();
    expect(recentPerson?.deletedAt).toBeNull();

    // And the companies those hang off, which is why they were skipped.
    const [busy] = await db.select().from(party).where(eq(party.id, ids.busy));
    const [later] = await db.select().from(party).where(eq(party.id, ids.later));
    expect(busy?.deletedAt).toBeNull();
    expect(later?.deletedAt).toBeNull();
  });

  it("puts what it took in the bin, with the reason, and gives it all back", async () => {
    const [binned] = await db.select().from(party).where(eq(party.id, ids.junk));
    expect(binned?.deletedAt).toBeTruthy();
    expect(binned?.deleteReason).toBe("test data");
    expect(binned?.legalName, "soft delete only — the row is still there").toBe(
      "SARL Typed While Learning",
    );

    await restoreParty({ id: ids.junk, actorId: ACTOR });
    await restoreDeal({ id: ids.oldDeal, actorId: ACTOR });
    await restoreDocument({ id: ids.draft, actorId: ACTOR });
    await restorePerson({ id: ids.oldPerson, actorId: ACTOR });

    const [back] = await db.select().from(party).where(eq(party.id, ids.junk));
    const [backDeal] = await db.select().from(deal).where(eq(deal.id, ids.oldDeal));
    const [backDraft] = await db.select().from(document).where(eq(document.id, ids.draft));
    const [backPerson] = await db.select().from(person).where(eq(person.id, ids.oldPerson));

    expect(back?.deletedAt).toBeNull();
    expect(backDeal?.deletedAt).toBeNull();
    expect(backDraft?.deletedAt).toBeNull();
    expect(backPerson?.deletedAt).toBeNull();
  });
});
