import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { deal, dealLine } from "@/db/schema/deal";
import { document, documentLine } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { createDeal } from "@/domain/deal/deal";
import { discardDocument, restoreDocument } from "@/domain/deletion";
import type { BpuLine } from "@/domain/tender/bpu";
import { applyErratum, bpu, importBpu, reviewErratum } from "@/domain/tender/bpu-store";
import { makeTender } from "@/domain/tender/store";

/**
 * Screen 42 meets screen 18.
 *
 * Since a draft document can be discarded, "the draft quotation on this deal"
 * stopped being answerable by `number is null`: a binned draft has no number
 * either, and it is the newest, so it is exactly the row that lookup picks.
 *
 * The consequence is not cosmetic. `bpu()` hands that id to the screen's
 * "Build the offer" button, and `applyErratum` writes into every draft on the
 * deal — so the first time somebody bins a draft quotation and then works the
 * bordereau on the same deal, the prices land in a document nothing lists.
 */
const ACTOR = "test-bpu-bin-actor";
const stamp = Date.now().toString().slice(-6);

let clientId = "";
let dealId = "";
let binnedDraftId = "";
let liveDraftId = "";
/** The line the erratum rewords, so it is the one that loses its price. */
let secondLineId = "";

const IMPORTED: BpuLine[] = [
  {
    position: 1,
    reference: "P-01",
    designation: "Fourniture et pose de canalisation",
    unit: "ml",
    qty: "1200",
  },
  { position: 2, reference: "P-02", designation: "Vanne papillon DN80", unit: "U", qty: "12" },
];

/** Position 2 is reworded into a different valve — a DN80 price is not a DN100 price. */
const ERRATUM: BpuLine[] = [
  IMPORTED[0] as BpuLine,
  { position: 2, reference: "P-02", designation: "Vanne papillon DN100", unit: "U", qty: "12" },
];

/**
 * A draft quotation on the deal, carrying a price on the line the erratum moves.
 *
 * `createdAt` is given rather than defaulted because `bpu()` picks the newest
 * draft, and two rows inserted a millisecond apart make that an ordering the
 * test would be trusting rather than stating.
 */
async function draftQuotation(createdAt: Date): Promise<string> {
  const [row] = await db
    .insert(document)
    .values({
      kind: "quotation",
      partyId: clientId,
      dealId,
      currency: "DZD",
      locale: "fr",
      totals: {},
      createdAt,
    })
    .returning({ id: document.id });

  await db.insert(documentLine).values({
    documentId: row?.id as string,
    position: 1,
    lineKind: "item",
    dealLineId: secondLineId,
    designation: "Vanne papillon DN80",
    qty: "12",
    unitPrice: "25636",
  });

  return row?.id as string;
}

const priceOn = async (documentId: string): Promise<string | null> => {
  const [line] = await db
    .select({ unitPrice: documentLine.unitPrice })
    .from(documentLine)
    .where(eq(documentLine.documentId, documentId));
  return line?.unitPrice ?? null;
};

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({ code: `CL-BB${stamp}`, legalName: "TEST BPU BIN — SONELGAZ ADRAR" })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Bordereau avec un brouillon à la corbeille",
      contactPersonId: null,
      clientReference: `AONR ${stamp}-B`,
      receivedAt: new Date("2026-08-01T08:00:00Z"),
      deadlineAt: new Date("2026-09-02T10:00:00Z"),
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

  await makeTender({
    dealId,
    procedure: "aonr",
    submissionPlace: "DD Adrar",
    cautionPct: "1",
    actorId: ACTOR,
  });

  await importBpu({ dealId, lines: IMPORTED, filename: "BPU.xls", actorId: ACTOR });

  const [second] = await db
    .select({ id: dealLine.id })
    .from(dealLine)
    .where(and(eq(dealLine.dealId, dealId), eq(dealLine.position, 2)));
  secondLineId = second?.id as string;
});

describe("a binned draft is not the draft on this deal", () => {
  it("stops offering it once it is in the bin", async () => {
    binnedDraftId = await draftQuotation(new Date("2026-08-02T09:00:00Z"));
    expect((await bpu(dealId))?.draftOfferId).toBe(binnedDraftId);

    await discardDocument({
      id: binnedDraftId,
      reason: "Mauvais client",
      actorId: ACTOR,
    });

    // Not "the oldest live one instead": there is no live one, and the screen
    // greys "Build the offer" rather than sending anybody into the bin.
    expect((await bpu(dealId))?.draftOfferId).toBeNull();
  });

  it("picks the live draft, never the binned one, when both exist", async () => {
    liveDraftId = await draftQuotation(new Date("2026-08-05T09:00:00Z"));
    expect((await bpu(dealId))?.draftOfferId).toBe(liveDraftId);
  });

  it("counts only the live draft's lines as prices an erratum would cost", async () => {
    const review = await reviewErratum(dealId, ERRATUM);
    // Two documents carry a price on the reworded line; one of them is binned.
    expect(review?.draftLinesLosingPrice).toBe(1);
  });

  it("clears the price on the live draft and does not touch the binned row", async () => {
    const result = await applyErratum({
      dealId,
      incoming: ERRATUM,
      actorId: ACTOR,
      reason: "Erratum du 14 août",
      now: new Date("2026-08-14T09:00:00Z"),
    });

    expect(result.draftPricesCleared).toBe(1);
    expect(await priceOn(liveDraftId)).toBeNull();
    // The whole point. A row in the bin is not a working document, and nothing
    // on screen 42 may write into one.
    expect(await priceOn(binnedDraftId)).toBe("25636.0000");
  });

  it("hands the restored draft back exactly as it went in", async () => {
    await restoreDocument({ id: binnedDraftId, actorId: ACTOR });

    // Restoring makes it a candidate again — the newest live draft wins, which
    // is still the one built after it.
    expect((await bpu(dealId))?.draftOfferId).toBe(liveDraftId);
    expect(await priceOn(binnedDraftId)).toBe("25636.0000");

    const [row] = await db.select({ id: deal.id }).from(deal).where(eq(deal.id, dealId));
    expect(row?.id).toBe(dealId);
  });
});
