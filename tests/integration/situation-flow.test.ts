import { mkdirSync, writeFileSync } from "node:fs";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document, documentLine, documentLink, numberingSeries } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { project, situationDetail } from "@/db/schema/project";
import { DraftRefused, saveDraft } from "@/documents/draft";
import { render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { createDeal } from "@/domain/deal/deal";
import { ensureTypesExist } from "@/domain/document-types";
import { nextFinalAccount, saveFinalAccount } from "@/domain/project/final";
import {
  amendmentDeltas,
  contractOf,
  nextSituation,
  recordSituationApproved,
  recordSituationSubmitted,
  saveAmendment,
  saveSituation,
  withAmendments,
} from "@/domain/project/situations";
import {
  createProject,
  getProject,
  recordReception,
  updateProjectTerms,
} from "@/domain/project/store";

/**
 * A marché de travaux from the client's order to the third situation, the way
 * a wilaya's engineer would check it: the cumulative columns must be the sum
 * of what was issued before, the retention must be 5 % of the HT because the
 * CCAP said so, and nothing may be issued out of order.
 */
const ACTOR = "test-situation-actor";

let clientId = "";
let dealId = "";
let contractId = "";
let projectId = "";
let lineIds: string[] = [];
const created: string[] = [];

beforeAll(async () => {
  // The catalogue says an avenant carries the CLIENT's number. Without the row
  // the engine would allocate one of ours over it.
  await ensureTypesExist();

  const [client] = await db
    .insert(party)
    .values({
      code: `CL-S${Date.now().toString().slice(-6)}`,
      legalName: "DIRECTION DES RESSOURCES EN EAU ADRAR (TEST SIT)",
      tradeName: "DRE ADRAR",
      nif: "099901000012345",
      address: "Cité administrative, Adrar",
      docLocale: "fr",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Raccordement BT de la station de pompage",
      contactPersonId: null,
      clientReference: "MAR/2026/018",
      receivedAt: new Date("2026-05-02T08:00:00Z"),
      deadlineAt: null,
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

  // The client's order, recorded and issued under THEIR number — the DQE.
  const [contract] = await db
    .insert(document)
    .values({
      kind: "client_order",
      number: "MAR/2026/018",
      partyId: clientId,
      dealId,
      locale: "fr",
      currency: "DZD",
      status: "issued",
      issuedOn: "2026-05-12",
      lockedAt: new Date("2026-05-12T10:00:00Z"),
      settlement: "virement",
      totals: { totalExcl: "4390000.00", totalIncl: "5224100.00" },
    })
    .returning({ id: document.id });
  contractId = contract?.id as string;
  created.push(contractId);

  const inserted = await db
    .insert(documentLine)
    .values([
      {
        documentId: contractId,
        position: 1,
        lineKind: "item",
        reference: "1.1",
        designation: "Fouille en tranchée",
        unit: "m3",
        qty: "400",
        unitPrice: "1200",
        vatRate: "19",
        totalExcl: "480000.00",
      },
      {
        documentId: contractId,
        position: 2,
        lineKind: "item",
        reference: "1.2",
        designation: "Câble BT 4x70 mm²",
        unit: "ml",
        qty: "1500",
        unitPrice: "2100",
        vatRate: "19",
        totalExcl: "3150000.00",
      },
      {
        documentId: contractId,
        position: 3,
        lineKind: "item",
        reference: "2.1",
        designation: "Poteau béton 9 m",
        unit: "U",
        qty: "20",
        unitPrice: "38000",
        vatRate: "19",
        totalExcl: "760000.00",
      },
    ])
    .returning({ id: documentLine.id });
  lineIds = inserted.map((l) => l.id);
});

afterAll(async () => {
  if (projectId) await db.delete(situationDetail).where(eq(situationDetail.projectId, projectId));
  if (created.length) {
    await db.delete(documentLink).where(inArray(documentLink.fromDocument, created));
    await db.delete(documentLink).where(inArray(documentLink.toDocument, created));
    await db.delete(documentLine).where(inArray(documentLine.documentId, created));
  }
  if (projectId) await db.delete(project).where(eq(project.id, projectId));
  if (created.length) await db.delete(document).where(inArray(document.id, created));
  if (dealId) await db.delete(deal).where(eq(deal.id, dealId));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
});

describe("the marché", () => {
  it("opens a project on the client's order, with the retention read off the CCAP", async () => {
    projectId = await createProject({
      dealId,
      object: "Raccordement BT de la station de pompage, Adrar",
      contractRef: "MAR/2026/018",
      wilaya: "Adrar",
      amountExcl: "4390000",
      startedOn: "2026-05-20",
      contractualEnd: "2026-11-20",
      retentionPct: "5",
      retentionBase: "excl",
      warrantyMonths: 12,
      contractDocumentId: contractId,
      actorId: ACTOR,
    });

    const contract = await contractOf(projectId);
    expect(contract?.documentId).toBe(contractId);
    expect(contract?.number).toBe("MAR/2026/018");
    expect(contract?.lines.map((l) => l.qty)).toEqual(["400", "1500", "20"]);
  });

  it("refuses a retention base that is not one of the two", async () => {
    await expect(
      createProject({ dealId, object: "x", retentionBase: "net", actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "badRetentionBase" });
  });

  it("refuses a contract that is not issued", async () => {
    const [draft] = await db
      .insert(document)
      .values({ kind: "quotation", partyId: clientId, dealId, locale: "fr", totals: {} })
      .returning({ id: document.id });
    created.push(draft?.id as string);
    await expect(
      updateProjectTerms({ projectId, contractDocumentId: draft?.id as string, actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "contractNotIssued" });
  });
});

describe("situation n° 1", () => {
  let first = "";

  it("starts from nothing claimed", async () => {
    const next = await nextSituation(projectId);
    expect(next?.sequence).toBe(1);
    expect(next?.blocked).toBeNull();
    expect(next?.draft).toBeNull();
    expect(next?.rows.every((r) => r.qtyPrevious === "0")).toBe(true);
    expect(next?.previouslyCertifiedExcl).toBe("0");
  });

  it("refuses a line that is not on the marché, and an empty claim", async () => {
    await expect(
      saveSituation({
        projectId,
        quantities: { "00000000-0000-0000-0000-000000000000": "5" },
        periodFrom: null,
        periodTo: null,
        workDone: null,
        advanceRecovered: "0",
        issuedOn: null,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "lineNotOnContract" });
    await expect(
      saveSituation({
        projectId,
        quantities: { [lineIds[0] as string]: "0" },
        periodFrom: null,
        periodTo: null,
        workDone: null,
        advanceRecovered: "0",
        issuedOn: null,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "nothingClaimed" });
  });

  it("is a draft whose lines point at the marché's and whose retention is 5 % of the HT", async () => {
    first = await saveSituation({
      projectId,
      quantities: { [lineIds[0] as string]: "250", [lineIds[1] as string]: "600" },
      periodFrom: "2026-05-20",
      periodTo: "2026-06-30",
      workDone: "Fouilles et pose du câble, tronçon 1",
      advanceRecovered: "0",
      issuedOn: "2026-07-02",
      actorId: ACTOR,
    });
    created.push(first);

    const [row] = await db.select().from(document).where(eq(document.id, first));
    expect(row?.status).toBe("draft");
    expect(row?.number).toBeNull();
    const totals = row?.totals as Record<string, string>;
    // 250×1200 + 600×2100
    expect(totals.totalExcl).toBe("1560000.00");
    expect(totals.totalVat).toBe("296400.00");
    expect(totals.totalIncl).toBe("1856400.00");
    expect(totals.retention).toBe("78000.00");
    expect(totals.dueNow).toBe("1778400.00");

    const lines = await db.select().from(documentLine).where(eq(documentLine.documentId, first));
    expect(lines.map((l) => l.sourceLineId).sort()).toEqual([lineIds[0], lineIds[1]].sort());

    const [link] = await db.select().from(documentLink).where(eq(documentLink.fromDocument, first));
    expect(link).toMatchObject({ toDocument: contractId, relation: "covers" });
  });

  it("is edited on its own screen, not in the builder", async () => {
    await expect(
      saveDraft(
        first,
        { lines: [{ lineKind: "item", designation: "x", qty: "1", unitPrice: "1" }] },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(DraftRefused);

    // Saving again rewrites the open draft rather than opening a second one.
    const again = await saveSituation({
      projectId,
      quantities: { [lineIds[0] as string]: "250", [lineIds[1] as string]: "600" },
      periodFrom: "2026-05-20",
      periodTo: "2026-06-30",
      workDone: "Fouilles et pose du câble, tronçon 1",
      advanceRecovered: "0",
      issuedOn: "2026-07-02",
      actorId: ACTOR,
    });
    expect(again).toBe(first);
    const next = await nextSituation(projectId);
    expect(next?.draft?.documentId).toBe(first);
    expect(next?.draft?.period[lineIds[0] as string]).toBe("250");
  });

  it("renders in the wilaya's form and cannot record dates before it is issued", async () => {
    const preview = await render({ documentId: first, purpose: "preview", actorId: ACTOR });
    expect(preview.situation).not.toBeNull();
    expect(preview.situation?.sequence).toBe(1);
    expect(preview.situation?.contractRef).toBe("MAR/2026/018");
    expect(preview.situation?.rows).toHaveLength(3);
    expect(preview.situation?.rows[0]).toMatchObject({ qtyPrevious: "0", qtyPeriod: "250" });
    expect(preview.situation?.periodExcl).toContain("1");
    expect(preview.totals.map((t) => t.label)).toContain("retention");
    expect(preview.amountInWords.toLowerCase()).toContain("un million");

    const pdf = await toPdf(preview);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    await expect(
      recordSituationSubmitted({ documentId: first, on: "2026-07-03", actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "notIssued" });
  });

  it("is issued with a number of ours, then submitted, then approved — in that order", async () => {
    const out = await render({ documentId: first, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^SIT-2026-\d{3}$/);

    await expect(
      recordSituationApproved({
        documentId: first,
        on: "2026-07-20",
        by: "M. Kaddour",
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "notSubmitted" });

    await recordSituationSubmitted({ documentId: first, on: "2026-07-03", actorId: ACTOR });
    await recordSituationApproved({
      documentId: first,
      on: "2026-07-20",
      by: "M. Kaddour, subdivisionnaire",
      actorId: ACTOR,
    });

    const p = await getProject(projectId, new Date("2026-08-01T00:00:00Z"));
    expect(p?.progress.situations[0]?.state).toBe("approved");
    expect(p?.progress.money.approved).toBe("1560000.00");
    expect(p?.progress.money.retentionHeld).toBe("78000.00");
    expect(p?.progress.financialPercent).toBe(35);
  });
});

describe("situations n° 2 and 3", () => {
  let second = "";
  let third = "";

  it("carries n° 1's quantities as cumul précédent", async () => {
    const next = await nextSituation(projectId);
    expect(next?.sequence).toBe(2);
    expect(next?.rows.map((r) => r.qtyPrevious)).toEqual(["250", "600", "0"]);
    expect(next?.previouslyCertifiedExcl).toBe("1560000.00");

    second = await saveSituation({
      projectId,
      quantities: { [lineIds[0] as string]: "150", [lineIds[2] as string]: "20" },
      periodFrom: "2026-07-01",
      periodTo: "2026-08-31",
      workDone: "Fin des fouilles, pose des poteaux",
      advanceRecovered: "100000",
      issuedOn: "2026-09-02",
      actorId: ACTOR,
    });
    created.push(second);

    const view = await render({ documentId: second, purpose: "preview", actorId: ACTOR });
    expect(view.situation?.rows.map((r) => r.qtyCumul)).toEqual(["400", "600", "20"]);
    // 400×1200 + 600×2100 + 20×38000 = 480 000 + 1 260 000 + 760 000
    expect(view.situation?.cumulExcl).toBe("2 500 000,00");
    expect(view.situation?.periodExcl).toBe("940 000,00");
    expect(view.situation?.percentOfContract).toBe(56);
    expect(view.totals.find((t) => t.label === "advanceDeducted")?.value).toBe("100 000,00");
  });

  it("will not open n° 3 while n° 2 is a draft, and n° 2 cannot be issued ahead of nothing", async () => {
    const next = await nextSituation(projectId);
    // The open draft IS the next one; there is no n° 3 to open.
    expect(next?.draft?.documentId).toBe(second);
    expect(next?.sequence).toBe(2);
  });

  it("issues n° 2, then a third whose cumul flags the line past the marché", async () => {
    await render({ documentId: second, purpose: "issue", actorId: ACTOR });

    third = await saveSituation({
      projectId,
      quantities: { [lineIds[2] as string]: "2", [lineIds[1] as string]: "900" },
      periodFrom: "2026-09-01",
      periodTo: "2026-09-30",
      workDone: "Câble tronçon 2, deux poteaux supplémentaires",
      advanceRecovered: "0",
      issuedOn: "2026-10-01",
      actorId: ACTOR,
    });
    created.push(third);

    const view = await render({ documentId: third, purpose: "preview", actorId: ACTOR });
    const poteaux = view.situation?.rows[2];
    expect(poteaux).toMatchObject({ qtyPrevious: "20", qtyPeriod: "2", qtyCumul: "22" });
    expect(poteaux?.overContract).toBe(true);
    expect(view.situation?.previouslyCertifiedExcl).toBe("2 500 000,00");
    const pdf = await toPdf(view);
    expect(pdf.length).toBeGreaterThan(2000);
    // Left where a person can open it: the form is judged by eye, not by size.
    mkdirSync(".logs", { recursive: true });
    writeFileSync(".logs/situation-3.pdf", pdf);
  });

  it("refuses to issue a situation whose predecessor is still a draft", async () => {
    // Force the order wrong: n° 2 back to draft would violate LAW 5, so
    // instead open a fourth and try to issue it while the third is a draft.
    // The store refuses to OPEN a fourth while the third is open, which is
    // the same rule one step earlier.
    await expect(
      saveSituation({
        projectId,
        quantities: { [lineIds[0] as string]: "1" },
        periodFrom: null,
        periodTo: null,
        workDone: null,
        advanceRecovered: "0",
        issuedOn: null,
        actorId: ACTOR,
      }),
    ).resolves.toBe(third); // rewrites the open draft, does not open another

    // And the engine's own guard, on a row inserted out of order.
    const [rogue] = await db
      .insert(document)
      .values({
        kind: "situation",
        partyId: clientId,
        dealId,
        locale: "fr",
        currency: "DZD",
        status: "draft",
        totals: { totalExcl: "1.00", totalIncl: "1.19" },
      })
      .returning({ id: document.id });
    created.push(rogue?.id as string);
    await db
      .insert(situationDetail)
      .values({ documentId: rogue?.id as string, projectId, sequence: 4 });
    await expect(
      render({ documentId: rogue?.id as string, purpose: "issue", actorId: ACTOR }),
    ).rejects.toMatchObject({ why: "previousSituationNotIssued" });
    await db.delete(situationDetail).where(eq(situationDetail.documentId, rogue?.id as string));
  });
});

/**
 * The avenant.
 *
 * A marché de travaux is changed by a signed avenant, and the two things that
 * must survive it are the situations already issued — the client holds those
 * on paper, and their columns cannot move — and the arithmetic of the ones
 * raised afterwards, which bill against the amended bordereau.
 */
describe("avenant n° 1", () => {
  let avenant = "";

  /** The situation carrying that sequence, whatever order the block wrote it in. */
  async function situationNo(sequence: number): Promise<string> {
    const [row] = await db
      .select({ id: situationDetail.documentId })
      .from(situationDetail)
      .where(and(eq(situationDetail.projectId, projectId), eq(situationDetail.sequence, sequence)))
      .limit(1);
    return row?.id as string;
  }

  it("refuses an avenant that changes nothing, and a new price with no price", async () => {
    // n° 3 is still a draft from the block above; issue it, so the marché has
    // a settled history behind it before anything is amended.
    await render({ documentId: await situationNo(3), purpose: "issue", actorId: ACTOR });

    await expect(
      saveAmendment({
        projectId,
        changes: {},
        additions: [{ designation: "", qty: "", unitPrice: "" }],
        theirNumber: null,
        signedOn: null,
        newContractualEnd: null,
        reason: null,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "nothingAmended" });

    await expect(
      saveAmendment({
        projectId,
        changes: { "00000000-0000-0000-0000-000000000000": { qty: "5" } },
        additions: [],
        theirNumber: null,
        signedOn: null,
        newContractualEnd: null,
        reason: null,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "lineNotOnContract" });

    await expect(
      saveAmendment({
        projectId,
        changes: {},
        additions: [{ designation: "Massif béton pour poteau", qty: "4", unitPrice: "" }],
        theirNumber: null,
        signedOn: null,
        newContractualEnd: null,
        reason: null,
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "additionNeedsPrice" });
  });

  it("carries only what the paper says: one quantity moved, one prix nouveau", async () => {
    const paper = {
      projectId,
      // Five more poteaux than the marché, at the marché's own price.
      changes: { [lineIds[2] as string]: { qty: "25" } },
      additions: [
        {
          reference: "3.1",
          designation: "Massif béton pour poteau, prix nouveau",
          unit: "U",
          qty: "5",
          unitPrice: "30000",
        },
      ],
      theirNumber: "AV 01/2026",
      signedOn: "2026-10-15",
      newContractualEnd: null,
      reason: "Quantités supplémentaires, terrain rocheux",
      actorId: ACTOR,
    };
    avenant = await saveAmendment(paper);
    created.push(avenant);

    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, avenant))
      .orderBy(asc(documentLine.position));
    expect(lines).toHaveLength(2);
    // The changed line points at the line of the marché it replaces; the prix
    // nouveau points at nothing, which is what makes it an addition.
    expect(lines[0]?.sourceLineId).toBe(lineIds[2]);
    expect(lines[1]?.sourceLineId).toBeNull();
    // A blank price kept the marché's own — the paper moved a quantity.
    expect(Number(lines[0]?.unitPrice)).toBe(38000);

    const [row] = await db.select().from(document).where(eq(document.id, avenant));
    expect(row?.status).toBe("draft");
    expect(row?.number).toBe("AV 01/2026");
    expect(row?.issuedOn).toBe("2026-10-15");
    // Its own total is the value of the prices it states: 25×38 000 + 5×30 000.
    expect((row?.totals as Record<string, string>)?.totalExcl).toBe("1100000.00");

    // Saving again rewrites the open avenant rather than opening a second one.
    expect(await saveAmendment(paper)).toBe(avenant);
  });

  it("changes nothing while it is a draft, and cannot be edited in the builder", async () => {
    const contract = await contractOf(projectId);
    expect(contract?.amendments).toEqual([]);
    expect(contract?.lines).toHaveLength(3);
    expect(await amendmentDeltas([projectId])).toEqual(new Map());

    await expect(
      saveDraft(
        avenant,
        { lines: [{ lineKind: "item", designation: "x", qty: "1", unitPrice: "1" }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ reason: "amendmentHasItsOwnScreen" });
  });

  it("moves the marché once it is issued, by its own arithmetic", async () => {
    const out = await render({ documentId: avenant, purpose: "issue", actorId: ACTOR });
    // LAW 5 allocates us no number here — an avenant's number is theirs.
    expect(out.number).toBe("AV 01/2026");
    expect(out.amendment).toMatchObject({ changed: 1, added: 1 });

    // Its own total is 1 100 000 — the prices it states. The three figures a
    // reader wants are printed underneath, and are not that one.
    const paper = await toPdf(out);
    expect(paper.subarray(0, 4).toString()).toBe("%PDF");
    writeFileSync(".logs/avenant-1.pdf", paper);

    const contract = await contractOf(projectId);
    expect(contract?.lines).toHaveLength(4);
    expect(contract?.lines[2]?.qty).toBe("25");
    // The amended line keeps its identity: the situations already issued point
    // at it, and their cumulative columns would break if it changed.
    expect(contract?.lines[2]?.lineId).toBe(lineIds[2]);
    expect(contract?.amendments).toHaveLength(1);
    expect(contract?.amendments[0]).toMatchObject({
      number: "AV 01/2026",
      // 25×38 000 − 20×38 000 = 190 000, plus the prix nouveau at 150 000.
      deltaExcl: "340000.00",
      changed: 1,
      added: 1,
    });

    expect(withAmendments("4390000", contract?.amendments ?? [])).toBe("4730000.00");
    expect((await amendmentDeltas([projectId])).get(projectId)).toBe("340000.00");
  });

  it("leaves the situations already issued exactly as the client signed them", async () => {
    const view = await render({
      documentId: await situationNo(1),
      purpose: "preview",
      actorId: ACTOR,
    });
    expect(view.situation?.sequence).toBe(1);
    // Three lines, and the poteaux still at the marché's own 20: this paper was
    // signed in July and the avenant is dated October.
    expect(view.situation?.rows).toHaveLength(3);
    expect(view.situation?.rows[2]?.qtyContract).toBe("20");
    expect(view.situation?.amendmentRef).toBeNull();
  });

  it("is what the next situation bills against, and what its form names", async () => {
    const next = await nextSituation(projectId);
    expect(next?.sequence).toBe(4);
    expect(next?.rows).toHaveLength(4);
    expect(next?.rows[2]).toMatchObject({ qty: "25", qtyPrevious: "20" });
    expect(next?.rows[3]?.qtyPrevious).toBe("0");

    const fourth = await saveSituation({
      projectId,
      quantities: {
        [next?.rows[2]?.lineId as string]: "3",
        [next?.rows[3]?.lineId as string]: "5",
      },
      periodFrom: "2026-10-01",
      periodTo: "2026-10-31",
      workDone: "Poteaux supplémentaires et massifs, avenant n° 1",
      advanceRecovered: "0",
      issuedOn: "2026-11-02",
      actorId: ACTOR,
    });
    created.push(fourth);

    const view = await render({ documentId: fourth, purpose: "preview", actorId: ACTOR });
    // 3×38 000 + 5×30 000
    expect(view.situation?.periodExcl).toBe("264 000,00");
    // The poteaux are no longer over the marché: the avenant raised that line.
    expect(view.situation?.rows[2]?.overContract).toBe(false);
    // "s/marché + avenant n° AV 01/2026" — what the wilaya's form prints.
    expect(view.situation?.amendmentRef).toBe("avenant n° AV 01/2026");

    const pdf = await toPdf(view);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    writeFileSync(".logs/situation-4-avenant.pdf", pdf);
  });
});

/**
 * The délai, and the pénalités that run from it.
 *
 * An avenant de prolongation carries no price at all — it is a date and a
 * reason — and the penalty clause is a figure the CLIENT may apply, which this
 * system computes only once somebody has read it off the CCAP.
 */
describe("avenant n° 2 — the délai", () => {
  let prolongation = "";
  const DEC = new Date("2026-12-01T00:00:00Z");

  async function situationNumbered(sequence: number): Promise<string> {
    const [row] = await db
      .select({ id: situationDetail.documentId })
      .from(situationDetail)
      .where(and(eq(situationDetail.projectId, projectId), eq(situationDetail.sequence, sequence)))
      .limit(1);
    return row?.id as string;
  }

  it("refuses an avenant that carries nothing at all — no price, no date", async () => {
    await expect(
      saveAmendment({
        projectId,
        changes: {},
        additions: [],
        theirNumber: null,
        signedOn: null,
        newContractualEnd: null,
        reason: "on y pense",
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ reason: "nothingAmended" });
  });

  it("computes no penalty at all while nobody has read the CCAP", async () => {
    const p = await getProject(projectId, DEC);
    expect(p?.deadline).toBe("2026-11-20");
    expect(p?.penalty.blocked).toBe("noClause");
    expect(p?.penalty.amount).toBeNull();
  });

  it("computes one against the signed délai once the clause is typed", async () => {
    await updateProjectTerms({
      projectId,
      penaltyPerMille: "1",
      penaltyCapPct: "10",
      penaltyBase: "excl",
      actorId: ACTOR,
    });

    const p = await getProject(projectId, DEC);
    expect(p?.penalty.blocked).toBeNull();
    expect(p?.penalty.daysLate).toBe(11);
    // The marché as avenant n° 1 left it: 4 730 000 × 1‰ × 11 days.
    expect(p?.penalty.basis).toBe("4730000.00");
    expect(p?.penalty.amount).toBe("52030.00");
    expect(p?.penalty.stillRunning).toBe(true);
    expect(p?.penalty.capped).toBe(false);
  });

  it("refuses a base that is neither the HT nor the TTC", async () => {
    await expect(
      updateProjectTerms({ projectId, penaltyBase: "net", actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "badPenaltyBase" });
  });

  it("is a date and a reason, and carries no money", async () => {
    prolongation = await saveAmendment({
      projectId,
      changes: {},
      additions: [],
      theirNumber: "AV 02/2026",
      signedOn: "2026-11-10",
      newContractualEnd: "2027-02-20",
      reason: "Terrain rocheux sur le tronçon 2 — prolongation de trois mois",
      actorId: ACTOR,
    });
    created.push(prolongation);

    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, prolongation));
    expect(lines).toHaveLength(0);
    const [row] = await db.select().from(document).where(eq(document.id, prolongation));
    // `{}`, not a block of noughts: this paper is not a bill for nothing.
    expect(row?.totals).toEqual({});
  });

  it("moves nothing while it is a draft", async () => {
    const p = await getProject(projectId, DEC);
    expect(p?.deadline).toBe("2026-11-20");
    expect(p?.penalty.daysLate).toBe(11);
  });

  it("moves the délai once issued, and the penalty stops with it", async () => {
    const out = await render({ documentId: prolongation, purpose: "issue", actorId: ACTOR });
    expect(out.number).toBe("AV 02/2026");
    expect(out.amendment).toMatchObject({
      changed: 0,
      added: 0,
      reason: "Terrain rocheux sur le tronçon 2 — prolongation de trois mois",
    });
    const pdf = await toPdf(out);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    writeFileSync(".logs/avenant-2-delai.pdf", pdf);

    const p = await getProject(projectId, DEC);
    // The signed marché still says November: an issued document never changes.
    expect(p?.contractualEnd).toBe("2026-11-20");
    expect(p?.deadline).toBe("2027-02-20");
    expect(p?.daysLeft).toBe(81);
    expect(p?.penalty.daysLate).toBe(0);
    expect(p?.penalty.amount).toBe("0.00");
  });

  it("names both avenants on the next situation's form", async () => {
    const view = await render({
      documentId: await situationNumbered(4),
      purpose: "preview",
      actorId: ACTOR,
    });
    expect(view.situation?.amendmentRef).toBe("avenants n° AV 01/2026, AV 02/2026");
  });
});

describe("the réceptions", () => {
  it("records the provisoire, then the définitive, and never the other way round", async () => {
    await expect(
      recordReception({ projectId, pvDefinitiveOn: "2026-12-01", actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "provisoireFirst" });

    await recordReception({ projectId, pvProvisoirePlanned: "2026-11-25", actorId: ACTOR });
    await recordReception({ projectId, pvProvisoireOn: "2026-11-28", actorId: ACTOR });

    await expect(
      recordReception({ projectId, pvDefinitiveOn: "2026-11-01", actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "definitiveBeforeProvisoire" });
    await expect(
      recordReception({ projectId, pvProvisoireOn: "2026-11-29", actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "alreadyReceived" });

    const p = await getProject(projectId, new Date("2026-12-01T00:00:00Z"));
    expect(p?.state).toBe("warranty");
    expect(p?.retentionReleases).toEqual({ on: "2027-11-28", basis: "provisional" });
  });
});

/**
 * The décompte final.
 *
 * The page that closes the marché: every situation added up, less the advance
 * recovered, less the retention withheld, less what the client has paid and
 * what the CCAP's clause allows. Nothing on it is typed, which is why every
 * figure below can be checked against the four situations above it.
 */
describe("the décompte final", () => {
  let decompte = "";

  async function situationNo(sequence: number): Promise<string> {
    const [row] = await db
      .select({ id: situationDetail.documentId })
      .from(situationDetail)
      .where(and(eq(situationDetail.projectId, projectId), eq(situationDetail.sequence, sequence)))
      .limit(1);
    return row?.id as string;
  }

  it("cannot be drawn while a situation is still a draft", async () => {
    const next = await nextFinalAccount(projectId);
    expect(next?.account.blocked).toBe("situationUnissued");
    await expect(
      saveFinalAccount({ projectId, issuedOn: null, actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "situationUnissued" });
  });

  it("waits for the client's signature on every one of them", async () => {
    await render({ documentId: await situationNo(4), purpose: "issue", actorId: ACTOR });
    // n° 1 was signed above; 2, 3 and 4 were issued and never signed.
    expect((await nextFinalAccount(projectId))?.account.blocked).toBe("situationUnapproved");

    for (const sequence of [2, 3, 4]) {
      const documentId = await situationNo(sequence);
      await recordSituationSubmitted({ documentId, on: "2026-11-03", actorId: ACTOR });
      await recordSituationApproved({
        documentId,
        on: "2026-11-15",
        by: "M. Kaddour, subdivisionnaire",
        actorId: ACTOR,
      });
    }
    expect((await nextFinalAccount(projectId))?.account.blocked).toBeNull();
  });

  it("adds up the four situations and nothing else", async () => {
    const next = await nextFinalAccount(projectId);
    const a = next?.account;
    expect(a?.counted).toHaveLength(4);
    // 1 560 000 + 940 000 + 1 200 + 264 000
    expect(a?.worksExcl).toBe("2765200.00");
    expect(a?.worksIncl).toBe("3290588.00");
    // Only n° 2 recovered any advance.
    expect(a?.advanceRecovered).toBe("100000.00");
    // 5 % of the HT of each, which is what the CCAP said.
    expect(a?.retentionHeld).toBe("138260.00");
    expect(a?.netCertified).toBe("3052328.00");
    // Nothing has been paid in this test, and the work was accepted in time.
    expect(a?.paid).toBe("0.00");
    expect(a?.penalty).toBe("0.00");
    expect(a?.balance).toBe("3052328.00");
    expect(a?.retentionToRelease).toBe("138260.00");
  });

  it("is written as a draft nobody typed, naming the papers it adds up", async () => {
    // The series is a decision the Gérant makes once on screen 50; the test
    // makes it here for the same reason it exists there.
    await db
      .insert(numberingSeries)
      .values({ kind: "final_account", pattern: "DEC/{YYYY}/{###}" })
      .onConflictDoNothing();

    decompte = await saveFinalAccount({
      projectId,
      issuedOn: "2026-12-02",
      actorId: ACTOR,
    });
    created.push(decompte);

    const lines = await db
      .select()
      .from(documentLine)
      .where(eq(documentLine.documentId, decompte))
      .orderBy(asc(documentLine.position));
    expect(lines).toHaveLength(4);
    expect(lines[0]?.designation).toContain("Situation n° 1");
    expect(lines[0]?.reference).toMatch(/^SIT-2026-\d{3}$/);

    const [row] = await db.select().from(document).where(eq(document.id, decompte));
    expect(row?.status).toBe("draft");
    const totals = row?.totals as Record<string, string>;
    expect(totals.totalIncl).toBe("3290588.00");
    expect(totals.retention).toBe("138260.00");
    expect(totals.advanceDeducted).toBe("100000.00");
    expect(totals.dueNow).toBe("3052328.00");

    // `closes`, on the marché itself.
    const [link] = await db
      .select()
      .from(documentLink)
      .where(and(eq(documentLink.fromDocument, decompte), eq(documentLink.relation, "closes")));
    expect(link?.toDocument).toBe(contractId);

    // Drawing it again rewrites the same draft rather than opening a second.
    expect(await saveFinalAccount({ projectId, issuedOn: "2026-12-02", actorId: ACTOR })).toBe(
      decompte,
    );
  });

  it("cannot be edited by hand, because every figure on it is computed", async () => {
    await expect(
      saveDraft(
        decompte,
        { lines: [{ lineKind: "item", designation: "x", qty: "1", unitPrice: "1" }] },
        ACTOR,
      ),
    ).rejects.toMatchObject({ reason: "finalAccountIsComputed" });
  });

  it("is issued under a number of ours, and closes the marché", async () => {
    const out = await render({ documentId: decompte, purpose: "issue", actorId: ACTOR });
    expect(out.number).toMatch(/^DEC\/2026\/\d{3}$/);
    // The totals block subtracts in the order a reader subtracts in.
    expect(out.totals.map((t) => t.label)).toEqual([
      "totalExcl",
      "totalVat",
      "totalIncl",
      "retention",
      "advanceDeducted",
      "dueNow",
    ]);
    const pdf = await toPdf(out);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    writeFileSync(".logs/decompte-final.pdf", pdf);

    await expect(
      saveFinalAccount({ projectId, issuedOn: null, actorId: ACTOR }),
    ).rejects.toMatchObject({ reason: "alreadyClosed" });
  });
});
