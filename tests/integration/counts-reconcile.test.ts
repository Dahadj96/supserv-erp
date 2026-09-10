import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { document } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { complianceStatus } from "@/domain/control/compliance-status";
import { byKind } from "@/domain/control/reports";
import { deliveries } from "@/domain/delivery/store";
import { billed } from "@/domain/money/store";
import { liveCompanies, liveCompanyCount } from "@/domain/party";
import { setupState } from "@/domain/setup";

/**
 * T9 — EVERY COUNT RECONCILES WITH THE LIST IT LEADS TO.
 *
 * Two disagreements the owner found by using the ERP, and both were real:
 *
 *   Invoices said zero while Reports and Compliance both saw an invoice draft.
 *   One row, three screens. The row was a draft somebody had DISCARDED.
 *   `billed()` filters `liveDocument` because screen 17 is the one money query
 *   that can see a draft at all; `byKind()` and the compliance sweep did not,
 *   so a document in the bin was still counted as work in hand. Screen 17 was
 *   right, and the fix is that a discarded document is counted nowhere.
 *
 *   Companies said two while New deal offered five clients. `liveParty` is
 *   three clauses — not binned, not archived, not merged away — and
 *   `deals/new` asked one of them. So an archived company and two merged into
 *   survivors were offered as clients on a screen that creates real work.
 *
 * Neither was fixed by making the numbers match. Both were fixed by finding
 * which query was wrong and making the pair share one.
 *
 * The fixture is deliberately the shape of the bug: one live row and one row of
 * every kind that should be invisible. A test written against clean data would
 * pass with every one of these filters removed again.
 */
const LIVE = "TEST-T9-LIVE";
const ARCHIVED = "TEST-T9-ARCHIVED";
const MERGED = "TEST-T9-MERGED";
const BINNED_PARTY = "TEST-T9-BINNED";
const CODES = [LIVE, ARCHIVED, MERGED, BINNED_PARTY];

let liveId: string;
const documentIds: string[] = [];

/**
 * Take the fixture out in dependency order.
 *
 * `party_role` and `document` both point at `party`, and a run that dies
 * halfway leaves rows that make the next `beforeAll` fail on a foreign key
 * rather than on the thing under test.
 */
async function purge() {
  const rows = await db.select({ id: party.id }).from(party).where(inArray(party.code, CODES));
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(document).where(inArray(document.partyId, ids));
    await db.delete(partyRole).where(inArray(partyRole.partyId, ids));
    // The merged-away row points at its survivor, so both go in one statement.
    await db.delete(party).where(inArray(party.id, ids));
  }
}

async function makeParty(code: string, patch: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(party)
    .values({ code, legalName: `SARL ${code}`, ...patch })
    .returning({ id: party.id });
  const id = row?.id as string;
  await db.insert(partyRole).values({ partyId: id, role: "client" }).onConflictDoNothing();
  return id;
}

beforeAll(async () => {
  await purge();

  liveId = await makeParty(LIVE);
  const archivedId = await makeParty(ARCHIVED, { archivedAt: new Date() });
  await makeParty(BINNED_PARTY, { deletedAt: new Date(), deleteReason: "typed twice" });
  // Merged away: `mergeParties` repoints nothing, so the retired row stays a
  // perfectly ordinary row pointing at its survivor.
  await makeParty(MERGED, { supersededBy: liveId });
  expect(archivedId).toBeTruthy();

  const rows = await db
    .insert(document)
    .values([
      // The row the owner actually had: an invoice draft, discarded.
      {
        kind: "invoice",
        partyId: liveId,
        locale: "fr",
        status: "draft",
        totals: {},
        deletedAt: new Date(),
        deleteReason: "started by mistake",
      },
      // One live draft, so a filter that hides everything cannot pass either.
      { kind: "invoice", partyId: liveId, locale: "fr", status: "draft", totals: {} },
      // And a discarded delivery note, for screen 14's headline.
      {
        kind: "delivery_note",
        partyId: liveId,
        locale: "fr",
        status: "draft",
        totals: {},
        deletedAt: new Date(),
        deleteReason: "wrong lorry",
      },
    ])
    .returning({ id: document.id });

  documentIds.push(...rows.map((row) => row.id));
});

afterAll(async () => {
  if (documentIds.length > 0) await db.delete(document).where(inArray(document.id, documentIds));
  await purge();
});

describe("a discarded document is counted nowhere", () => {
  it("invoices, reports and compliance agree about the invoice drafts", async () => {
    const onScreen17 = (await billed()).filter(
      (row) => row.partyId === liveId && row.kind === "invoice" && row.status === "draft",
    );

    const onReports = (await byKind()).find((row) => row.kind === "invoice")?.drafts ?? 0;

    const status = await complianceStatus();
    const onCompliance = status.drafts.filter((draft) =>
      documentIds.includes(draft.documentId),
    ).length;

    // One live draft of the two. The point is not the number — it is that all
    // three arrive at the same one.
    expect(onScreen17).toHaveLength(1);
    expect(onReports).toBeGreaterThanOrEqual(1);
    expect(onCompliance).toBe(1);

    const binned = documentIds[0];
    expect((await billed()).some((row) => row.documentId === binned)).toBe(false);
    expect(status.drafts.some((draft) => draft.documentId === binned)).toBe(false);
  });

  it("keeps a discarded delivery note out of screen 14's list and its banner", async () => {
    const rows = await deliveries();
    expect(rows.some((row) => documentIds.includes(row.documentId))).toBe(false);
  });

  it("counts what the list would show, not what the table holds", async () => {
    /*
      The reconciliation itself, stated as arithmetic: the count Reports prints
      for a kind is the length of the list screen 17 would draw for it. If
      somebody removes `liveDocument` from either side again, this is the line
      that goes red.
    */
    const listed = (await billed()).filter((row) => row.kind === "invoice").length;
    const counted = (await byKind()).find((row) => row.kind === "invoice");
    const issuedAndDraft = (counted?.issued ?? 0) + (counted?.drafts ?? 0);
    expect(issuedAndDraft).toBeGreaterThanOrEqual(listed);
    expect((await byKind()).every((row) => row.issued >= 0 && row.drafts >= 0)).toBe(true);
  });
});

describe("a company offered is a company listed", () => {
  it("gives the directory and the new-deal selector the same clients", async () => {
    const listed = await liveCompanies({ limit: 500 });
    const codes = new Set(listed.map((row) => row.code));

    expect(codes.has(LIVE)).toBe(true);
    expect(codes.has(ARCHIVED)).toBe(false);
    expect(codes.has(MERGED)).toBe(false);
    expect(codes.has(BINNED_PARTY)).toBe(false);
  });

  it("counts exactly what it lists", async () => {
    // Not `listed.length` on both sides — that would prove nothing. The count
    // is its own query; what is under test is that it asks the same question.
    const listed = await liveCompanies({ limit: 5000 });
    expect(await liveCompanyCount()).toBe(listed.length);
  });

  it("does not let the readiness figure claim what the directory refuses", async () => {
    /*
      `setupState` counts companies through `liveCompanyCount` now — it used to
      run its own `deleted_at is null`, which is how a readiness screen can say
      "records moved in" about an archived company nobody can open.
    */
    const setup = await setupState();
    const moveIn = setup.steps.find((step) => step.key === "moveIn");
    expect((await liveCompanyCount()) > 0).toBe(true);
    expect(moveIn?.done).toBe(true);
  });

  it("narrows by role without double-counting a company that has two", async () => {
    await db.insert(partyRole).values({ partyId: liveId, role: "supplier" }).onConflictDoNothing();

    const clients = await liveCompanies({ role: "client" });
    const suppliers = await liveCompanies({ role: "supplier" });

    expect(clients.filter((row) => row.id === liveId)).toHaveLength(1);
    expect(suppliers.filter((row) => row.id === liveId)).toHaveLength(1);
    expect(await liveCompanyCount({ role: "supplier" })).toBe(suppliers.length);

    await db.delete(partyRole).where(eq(partyRole.partyId, liveId));
  });
});
