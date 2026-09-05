import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, queryCount, resetQueryCount } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document, documentLine, documentLink } from "@/db/schema/document";
import { party, partyRole } from "@/db/schema/party";
import { amendmentDetail, project, situationDetail } from "@/db/schema/project";
import { render } from "@/documents/engine";
import { createDeal } from "@/domain/deal/deal";
import { ensureTypesExist } from "@/domain/document-types";
import { nextFinalAccount } from "@/domain/project/final";
import {
  nextAmendment,
  nextSituation,
  saveAmendment,
  saveSituation,
} from "@/domain/project/situations";
import { createProject, getProject, listProjects } from "@/domain/project/store";

/**
 * What each screen costs, in round trips.
 *
 * The ERP runs on a mini PC in an office in Adrar. Six people, one Postgres in
 * Docker on the same machine, and a page that opens quickly today can be doing
 * it by making eighty queries that each take a millisecond — until the day the
 * disk is busy, or somebody opens it over the tunnel from a phone.
 *
 * The number that goes wrong is never one query becoming slow. It is one
 * function calling another that re-reads what the caller already had: screen
 * 16 composed the marché in `getProject`, again on the page, and a third time
 * in the décompte, and each composition costs a round trip PER AVENANT.
 *
 * So the budgets below are ceilings with the measured number in the comment.
 * They are deliberately not tight to the unit — a query added for a good
 * reason should not fail a test — but they are tight enough that a read
 * accidentally done twice does.
 */
const ACTOR = "test-budget-actor";

let clientId = "";
let dealId = "";
let contractId = "";
let projectId = "";
let lineIds: string[] = [];
const created: string[] = [];

/** Queries made while running `work`, counted honestly. */
async function cost(work: () => Promise<unknown>): Promise<number> {
  resetQueryCount();
  await work();
  return queryCount();
}

beforeAll(async () => {
  await ensureTypesExist();

  const [client] = await db
    .insert(party)
    .values({
      code: `CL-Q${Date.now().toString().slice(-6)}`,
      legalName: "DIRECTION DES TRAVAUX PUBLICS (TEST BUDGET)",
      nif: "099901000099999",
      docLocale: "fr",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Réfection de la piste, lot 2",
      contactPersonId: null,
      clientReference: "MAR/2026/099",
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

  const [contract] = await db
    .insert(document)
    .values({
      kind: "client_order",
      number: "MAR/2026/099",
      partyId: clientId,
      dealId,
      locale: "fr",
      currency: "DZD",
      status: "issued",
      issuedOn: "2026-05-12",
      lockedAt: new Date("2026-05-12T10:00:00Z"),
      settlement: "virement",
      totals: { totalExcl: "2000000.00", totalIncl: "2380000.00" },
    })
    .returning({ id: document.id });
  contractId = contract?.id as string;
  created.push(contractId);

  // Ten prices: a small bordereau, and enough that a per-line query would show.
  const inserted = await db
    .insert(documentLine)
    .values(
      Array.from({ length: 10 }, (_, i) => ({
        documentId: contractId,
        position: i + 1,
        lineKind: "item",
        reference: `1.${i + 1}`,
        designation: `Prix n° ${i + 1}`,
        unit: "ml",
        qty: "100",
        unitPrice: "2000",
        vatRate: "19",
        totalExcl: "200000.00",
      })),
    )
    .returning({ id: documentLine.id });
  lineIds = inserted.map((l) => l.id);

  projectId = await createProject({
    dealId,
    object: "Réfection de la piste, lot 2",
    contractRef: "MAR/2026/099",
    wilaya: "Adrar",
    amountExcl: "2000000",
    startedOn: "2026-05-20",
    contractualEnd: "2026-11-20",
    retentionPct: "5",
    retentionBase: "excl",
    warrantyMonths: 12,
    contractDocumentId: contractId,
    actorId: ACTOR,
  });

  // Two issued situations and three issued avenants: the shape where an
  // O(avenants²) composition starts to show.
  for (const [n, qty] of [
    [1, "30"],
    [2, "20"],
  ] as [number, string][]) {
    const id = await saveSituation({
      projectId,
      quantities: Object.fromEntries(lineIds.map((lineId) => [lineId, qty])),
      periodFrom: null,
      periodTo: null,
      workDone: `Période ${n}`,
      advanceRecovered: "0",
      issuedOn: `2026-0${6 + n}-01`,
      actorId: ACTOR,
    });
    created.push(id);
    await render({ documentId: id, purpose: "issue", actorId: ACTOR });
  }

  for (const n of [1, 2, 3]) {
    const id = await saveAmendment({
      projectId,
      changes: { [lineIds[n] as string]: { qty: String(100 + n * 10) } },
      additions: [],
      theirNumber: `AV 0${n}/2026`,
      signedOn: `2026-09-0${n}`,
      newContractualEnd: null,
      reason: null,
      actorId: ACTOR,
    });
    created.push(id);
    await render({ documentId: id, purpose: "issue", actorId: ACTOR });
  }
});

afterAll(async () => {
  if (projectId) {
    await db.delete(amendmentDetail).where(eq(amendmentDetail.projectId, projectId));
    await db.delete(situationDetail).where(eq(situationDetail.projectId, projectId));
  }
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

describe("what a screen costs", () => {
  it("counts what it is told to count and nothing else", async () => {
    const one = await cost(() => db.select({ id: project.id }).from(project).limit(1));
    expect(one).toBe(1);
  });

  it("opens a project — screen 16's own read", async () => {
    // 9 on 5 September: the row, the situations, four for the avenants, the
    // cautions, the crew, the délai. It was 14 before the avenants were read
    // in bulk. The ceiling is the measurement with room, not a target.
    const n = await cost(() => getProject(projectId));
    expect(n, `getProject made ${n} queries`).toBeLessThanOrEqual(12);
  });

  it("lists the projects — screen 15, with every project's avenants", async () => {
    // 7, and it does not grow with the number of projects: that is the whole
    // point of `amendmentDeltas` reading in bulk. It used to be six queries
    // per project plus one per avenant.
    const n = await cost(() => listProjects());
    expect(n, `listProjects made ${n} queries`).toBeLessThanOrEqual(10);
  });

  it("opens the next situation — screen 16b", async () => {
    // 9: composing the marché is six of them.
    const n = await cost(() => nextSituation(projectId));
    expect(n, `nextSituation made ${n} queries`).toBeLessThanOrEqual(12);
  });

  it("opens the avenant screen — 16c", async () => {
    const n = await cost(() => nextAmendment(projectId));
    expect(n, `nextAmendment made ${n} queries`).toBeLessThanOrEqual(11);
  });

  it("computes the décompte final — 16d", async () => {
    // 14, of which 9 are the project it reads for the penalty and the PV.
    const n = await cost(() => nextFinalAccount(projectId));
    expect(n, `nextFinalAccount made ${n} queries`).toBeLessThanOrEqual(18);
  });

  it("and charges screen 16 nothing twice for the project it already has", async () => {
    const loaded = await getProject(projectId);
    const n = await cost(() => nextFinalAccount(projectId, loaded));
    // Five: the situations, the marché's id, the two décompte lookups, the
    // number it would take. The page reads the project once, not twice.
    expect(n, `nextFinalAccount(loaded) made ${n} queries`).toBeLessThanOrEqual(7);
  });
});
