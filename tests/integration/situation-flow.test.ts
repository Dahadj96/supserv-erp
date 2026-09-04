import { mkdirSync, writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { project, situationDetail } from "@/db/schema/project";
import { DraftRefused, saveDraft } from "@/documents/draft";
import { render } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";
import { createDeal } from "@/domain/deal/deal";
import {
  contractOf,
  nextSituation,
  recordSituationApproved,
  recordSituationSubmitted,
  saveSituation,
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
