import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal, dealLine } from "@/db/schema/deal";
import { party, partyRole } from "@/db/schema/party";
import { companyCredential, tender, tenderPiece } from "@/db/schema/tender";
import { createDeal } from "@/domain/deal/deal";
import {
  credentials,
  getTender,
  listTenders,
  makeTender,
  markSubmitted,
  removePiece,
  saveCredential,
  TenderRefused,
  tenderCounts,
} from "@/domain/tender/store";

/**
 * Screens 07 and 08 against a real database.
 *
 * The case it is built around: a CASNOS attestation valid today, expiring 30
 * August, on a tender that closes 2 September. Every other screen in this
 * system calls that document valid. The bid is thrown out at the desk.
 */
const ACTOR = "test-tender-actor";
const NOW = new Date("2026-08-21T09:00:00Z");
const CLOSES = new Date("2026-09-02T10:00:00Z");

let clientId = "";
let dealId = "";
const made: string[] = [];
const credKeys = ["cnas", "casnos", "rc_copy", "statuts"];

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({
      code: `CL-8${Date.now().toString().slice(-5)}`,
      legalName: "SADEG — DIRECTION DISTRIBUTION ADRAR (TEST)",
      tradeName: "SADEG",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Travaux de raccordement BT lot 5",
      contactPersonId: null,
      clientReference: "AONR 12/2026",
      receivedAt: NOW,
      deadlineAt: CLOSES,
      submissionMethod: "deposit_sealed",
      currency: "DZD",
      ownerId: null,
      source: "manual",
      intakeMessageId: null,
      expectedValue: null,
      clientInstructions: null,
    },
    ACTOR,
  );
  made.push(dealId);

  await makeTender({
    dealId,
    procedure: "aonr",
    submissionPlace: "DD Adrar, bureau des marchés",
    cautionAmount: "84200",
    actorId: ACTOR,
  });

  // The company's papers. CASNOS is the one that ends the bid.
  await saveCredential({
    key: "rc_copy",
    reference: "RC 01/00-0123456 B 09",
    expiresOn: null,
    fileId: "p/rc.pdf",
    actorId: ACTOR,
  });
  await saveCredential({
    key: "statuts",
    expiresOn: null,
    fileId: "p/statuts.pdf",
    actorId: ACTOR,
  });
  await saveCredential({
    key: "cnas",
    expiresOn: "2026-09-14",
    fileId: "p/cnas.pdf",
    actorId: ACTOR,
  });
  await saveCredential({
    key: "casnos",
    expiresOn: "2026-08-30",
    fileId: "p/casnos.pdf",
    actorId: ACTOR,
  });
});

afterAll(async () => {
  if (made.length) {
    await db.delete(tenderPiece).where(inArray(tenderPiece.dealId, made));
    await db.delete(tender).where(inArray(tender.dealId, made));
    await db.delete(dealLine).where(inArray(dealLine.dealId, made));
    await db.delete(deal).where(inArray(deal.id, made));
  }
  await db.delete(companyCredential).where(inArray(companyCredential.key, credKeys));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
  await db.delete(party).where(like(party.legalName, "%(TEST)%"));
});

describe("a tender is a deal with a procedure", () => {
  it("keeps the enquiry it was made from, reference and all", async () => {
    const view = await getTender(dealId, NOW);
    expect(view?.clientReference).toBe("AONR 12/2026");
    expect(view?.object).toBe("Travaux de raccordement BT lot 5");
    expect(view?.authority).toBe("SADEG");
    expect(view?.ref).toMatch(/^ENQ-\d{4}-\d{4}$/);
  });

  it("refuses to make the same deal a tender twice", async () => {
    await expect(makeTender({ dealId, procedure: "aonr", actorId: ACTOR })).rejects.toBeInstanceOf(
      TenderRefused,
    );
  });

  it("refuses a deal that does not exist", async () => {
    await expect(
      makeTender({
        dealId: "00000000-0000-0000-0000-000000000000",
        procedure: "aonr",
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(TenderRefused);
  });

  it("seeds the folder and records who said the tender asks for it", async () => {
    const pieces = await db.select().from(tenderPiece).where(eq(tenderPiece.dealId, dealId));
    expect(pieces.length).toBeGreaterThan(10);
    expect(pieces.every((p) => p.addedBy === ACTOR)).toBe(true);
  });
});

describe("the folder, judged against the day of the deposit", () => {
  it("marks the CASNOS attestation as expiring before the deposit", async () => {
    const view = await getTender(dealId, NOW);
    const casnos = view?.folder.pieces.find((p) => p.key === "casnos");
    expect(casnos?.state).toBe("expiresBeforeDeposit");
    expect(casnos?.daysLeft).toBe(9);
  });

  it("leaves the CNAS attestation merely expiring, because it survives the day", async () => {
    const view = await getTender(dealId, NOW);
    expect(view?.folder.pieces.find((p) => p.key === "cnas")?.state).toBe("expiring");
    expect(view?.folder.blocking.map((p) => p.key)).not.toContain("cnas");
  });

  it("counts the papers nobody has filed as blocking", async () => {
    const view = await getTender(dealId, NOW);
    const blocking = view?.folder.blocking.map((p) => p.key) ?? [];
    expect(blocking).toContain("casnos");
    expect(blocking).toContain("extrait_role");
    expect(blocking).toContain("bpu");
  });

  it("puts the ready ones at 100% of nothing rather than dividing by zero", async () => {
    const view = await getTender(dealId, NOW);
    expect(view?.folder.percent).toBeGreaterThan(0);
    expect(view?.folder.percent).toBeLessThan(100);
  });

  it("changes its mind when the paper is renewed, with nothing else touched", async () => {
    await saveCredential({
      key: "casnos",
      expiresOn: "2027-01-31",
      fileId: "p/casnos-new.pdf",
      actorId: ACTOR,
    });
    const view = await getTender(dealId, NOW);
    expect(view?.folder.pieces.find((p) => p.key === "casnos")?.state).toBe("ready");

    // Put it back for the tests below.
    await saveCredential({
      key: "casnos",
      expiresOn: "2026-08-30",
      fileId: "p/casnos.pdf",
      actorId: ACTOR,
    });
  });

  it("holds the company's papers once, not once per tender", async () => {
    const held = await credentials();
    expect(held.filter((c) => c.key === "casnos")).toHaveLength(1);
  });

  it("records who changed an expiry date, because somebody will ask", async () => {
    const entries = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entity, "company_credential"));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.actorId === ACTOR)).toBe(true);
  });
});

describe("depositing the envelope", () => {
  it("refuses while a piece would have the bid thrown out", async () => {
    await expect(markSubmitted({ dealId, actorId: ACTOR, now: NOW })).rejects.toBeInstanceOf(
      TenderRefused,
    );
  });

  it("refuses a deliberate incomplete deposit with no reason given", async () => {
    await expect(
      markSubmitted({ dealId, actorId: ACTOR, force: true, now: NOW }),
    ).rejects.toBeInstanceOf(TenderRefused);
  });

  it("allows it with a reason, and freezes what was blocking at the time", async () => {
    // A company does sometimes deposit an incomplete folder to be seen to have
    // bid. That is a decision, and the log has to carry both it and its cost.
    await markSubmitted({
      dealId,
      actorId: ACTOR,
      force: true,
      reason: "Deposited incomplete to be seen to have bid — CASNOS renewal ordered",
      depositReceiptRef: "DD/2026/0412",
      now: NOW,
    });

    const view = await getTender(dealId, NOW);
    expect(view?.submittedAt).not.toBeNull();
    expect(view?.depositReceiptRef).toBe("DD/2026/0412");

    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entity, "tender"))
      .orderBy(auditEntry.at);
    expect(entry).toBeDefined();

    const submit = (await db.select().from(auditEntry).where(eq(auditEntry.action, "submit"))).find(
      (e) => e.entityId === dealId,
    );
    expect((submit?.after as { blockingAtDeposit: string[] })?.blockingAtDeposit).toContain(
      "casnos",
    );
  });

  it("refuses a second deposit of the same envelope", async () => {
    await expect(
      markSubmitted({ dealId, actorId: ACTOR, force: true, reason: "again", now: NOW }),
    ).rejects.toBeInstanceOf(TenderRefused);
  });
});

describe("the list", () => {
  it("shows the tender with its folder computed, not stored", async () => {
    const rows = await listTenders(NOW);
    const mine = rows.find((r) => r.dealId === dealId);
    expect(mine?.blocking).toBeGreaterThan(0);
    expect(mine?.percent).toBeLessThan(100);
    expect(mine?.cautionAmount).toBe("84200.00");
  });

  it("counts a deposited tender as submitted rather than open", async () => {
    const counts = await tenderCounts(NOW);
    expect(counts.submitted).toBeGreaterThan(0);
  });

  it("stops counting a deposited tender's folder as an incomplete one to chase", async () => {
    // The folder is still incomplete. Chasing it is pointless — the envelope
    // has gone.
    const counts = await tenderCounts(NOW);
    const rows = await listTenders(NOW);
    const mine = rows.find((r) => r.dealId === dealId);
    expect(mine?.submittedAt).not.toBeNull();
    expect(counts.incomplete).toBe(0);
  });

  it("lets a piece this tender does not ask for be removed", async () => {
    const before = await getTender(dealId, NOW);
    const piece = before?.folder.pieces.find((p) => p.key === "casier_judiciaire");
    const [row] = await db
      .select()
      .from(tenderPiece)
      .where(eq(tenderPiece.dealId, dealId))
      .then((rows) => rows.filter((r) => r.key === piece?.key));

    await removePiece({ dealId, pieceId: row?.id as string, actorId: ACTOR });

    const after = await getTender(dealId, NOW);
    expect(after?.folder.pieces.map((p) => p.key)).not.toContain("casier_judiciaire");
    expect(after?.folder.total).toBe((before?.folder.total ?? 0) - 1);
  });
});
