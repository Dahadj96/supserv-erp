import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { payment, paymentAllocation } from "@/db/schema/money";
import { party, partyRole, person, personCertification } from "@/db/schema/party";
import { project, projectCaution, projectCrew, situationDetail } from "@/db/schema/project";
import { createDeal } from "@/domain/deal/deal";
import {
  addCrew,
  createProject,
  getProject,
  listProjects,
  ProjectRefused,
  projectCounts,
  saveCaution,
  setPhysicalProgress,
} from "@/domain/project/store";

/**
 * Screens 15 and 16 against a real database.
 *
 * The two things only a database can prove: that a situation's approval date
 * and its payment come from two different tables and still add up, and that a
 * welder's certificate expiry — which lives on `person_certification`, three
 * joins away — reaches the crew row that says whether he may work tomorrow.
 */
const ACTOR = "test-project-actor";
const NOW = new Date("2026-08-21T09:00:00Z");

let clientId = "";
let dealId = "";
let projectId = "";
let welderId = "";
const documents: string[] = [];
const payments: string[] = [];

async function situation(opts: {
  sequence: number;
  amount: string;
  submittedOn: string;
  approvedOn: string | null;
  paid?: string;
}) {
  const [doc] = await db
    .insert(document)
    .values({
      kind: "situation",
      number: `SIT-2026-000${opts.sequence}`,
      partyId: clientId,
      dealId,
      locale: "fr",
      currency: "DZD",
      status: "issued",
      issuedOn: opts.submittedOn,
      totals: { totalExcl: opts.amount, totalIncl: opts.amount },
    })
    .returning({ id: document.id });
  const id = doc?.id as string;
  documents.push(id);

  await db.insert(situationDetail).values({
    documentId: id,
    projectId,
    sequence: opts.sequence,
    submittedOn: opts.submittedOn,
    approvedOn: opts.approvedOn,
    workDone: `Lot ${opts.sequence}`,
  });

  if (opts.paid) {
    const [p] = await db
      .insert(payment)
      .values({
        partyId: clientId,
        method: "virement",
        amount: opts.paid,
        receivedOn: opts.submittedOn,
        recordedBy: ACTOR,
      })
      .returning({ id: payment.id });
    payments.push(p?.id as string);
    await db
      .insert(paymentAllocation)
      .values({ paymentId: p?.id as string, documentId: id, amount: opts.paid });
  }

  return id;
}

beforeAll(async () => {
  const [client] = await db
    .insert(party)
    .values({
      code: `CL-T7${Date.now().toString().slice(-5)}`,
      legalName: "SADEG DD ADRAR (TEST PROJECT)",
      tradeName: "SADEG",
    })
    .returning({ id: party.id });
  clientId = client?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  dealId = await createDeal(
    {
      partyId: clientId,
      subject: "Raccordement BT lot 4",
      contactPersonId: null,
      clientReference: "MAR/2026/018",
      receivedAt: NOW,
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

  projectId = await createProject({
    dealId,
    object: "Raccordement BT lot 4, Adrar centre",
    contractRef: "MAR/2026/018",
    wilaya: "Adrar",
    amountExcl: "5180000",
    startedOn: "2026-05-12",
    contractualEnd: "2026-09-30",
    retentionPct: "5",
    warrantyMonths: 12,
    actorId: ACTOR,
  });

  await situation({
    sequence: 1,
    amount: "620000",
    submittedOn: "2026-06-04",
    approvedOn: "2026-06-20",
    paid: "589000",
  });
  await situation({
    sequence: 2,
    amount: "720000",
    submittedOn: "2026-07-03",
    approvedOn: "2026-07-18",
    paid: "684000",
  });
  await situation({ sequence: 3, amount: "1840000", submittedOn: "2026-07-28", approvedOn: null });

  const [welder] = await db
    .insert(person)
    .values({
      fullName: "H. Ferhat (TEST)",
      trade: "Soudeur",
      source: "manual",
      relationship: "employee",
    })
    .returning({ id: person.id });
  welderId = welder?.id as string;
  await db.insert(personCertification).values([
    { personId: welderId, kind: "Soudage arc", expiresOn: "2026-08-30" },
    { personId: welderId, kind: "Habilitation B1V", expiresOn: "2027-11-21" },
  ]);

  await addCrew({ projectId, personId: welderId, onSiteSince: "2026-05-12", actorId: ACTOR });

  await saveCaution({
    projectId,
    kind: "bonne_execution",
    pct: "5",
    amount: "259000",
    bankName: "BEA",
    expiresOn: "2026-08-29",
    actorId: ACTOR,
  });
});

afterAll(async () => {
  if (projectId) {
    await db.delete(projectCrew).where(eq(projectCrew.projectId, projectId));
    await db.delete(projectCaution).where(eq(projectCaution.projectId, projectId));
    await db.delete(situationDetail).where(eq(situationDetail.projectId, projectId));
  }
  if (payments.length) {
    await db.delete(paymentAllocation).where(inArray(paymentAllocation.paymentId, payments));
    await db.delete(payment).where(inArray(payment.id, payments));
  }
  if (documents.length) await db.delete(document).where(inArray(document.id, documents));
  if (projectId) await db.delete(project).where(eq(project.id, projectId));
  if (dealId) await db.delete(deal).where(eq(deal.id, dealId));
  if (welderId) {
    await db.delete(personCertification).where(eq(personCertification.personId, welderId));
    await db.delete(person).where(eq(person.id, welderId));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  if (clientId) {
    await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
    await db.delete(party).where(eq(party.id, clientId));
  }
});

describe("a project belongs to a deal", () => {
  it("takes a code of its own and keeps the enquiry behind it", async () => {
    const p = await getProject(projectId, NOW);
    expect(p?.code).toMatch(/^PRJ-\d{4}-\d{3}$/);
    expect(p?.dealRef).toMatch(/^ENQ-\d{4}-\d{4}$/);
    expect(p?.contractRef).toBe("MAR/2026/018");
  });

  it("refuses a project with no deal behind it", async () => {
    await expect(
      createProject({
        dealId: "00000000-0000-0000-0000-000000000000",
        object: "Nowhere",
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ProjectRefused);
  });

  it("refuses a project with no object", async () => {
    await expect(createProject({ dealId, object: "   ", actorId: ACTOR })).rejects.toBeInstanceOf(
      ProjectRefused,
    );
  });
});

describe("the situations, across three tables", () => {
  it("counts only what the client signed as progress", async () => {
    const p = await getProject(projectId, NOW);
    expect(p?.progress.money.approved).toBe("1340000.00");
    expect(p?.progress.money.awaitingApproval).toBe("1840000.00");
    expect(p?.progress.financialPercent).toBe(25);
  });

  it("reads the payments off the allocations, not off the situation", async () => {
    const p = await getProject(projectId, NOW);
    expect(p?.progress.money.paid).toBe("1273000.00");
  });

  it("holds retention on the approved ones only", async () => {
    const p = await getProject(projectId, NOW);
    expect(p?.progress.money.retentionHeld).toBe("67000.00");
  });

  it("names the situation that has been waiting for a signature", async () => {
    const p = await getProject(projectId, NOW);
    expect(p?.progress.longestWait?.sequence).toBe(3);
    expect(p?.progress.longestWait?.waitingDays).toBe(24);
  });
});

describe("the crew and their tickets", () => {
  it("brings the SOONEST-expiring certification through, not the latest", async () => {
    // The welder holds two. Whether he may work tomorrow is decided by the one
    // that runs out first, and picking the other would say he is fine.
    const p = await getProject(projectId, NOW);
    const member = p?.crew[0];
    expect(member?.certification).toBe("Soudage arc");
    expect(member?.certificationExpiresOn).toBe("2026-08-30");
    expect(member?.state).toBe("expiring");
  });

  it("refuses to put the same person on the same site twice", async () => {
    await expect(addCrew({ projectId, personId: welderId, actorId: ACTOR })).rejects.toBeInstanceOf(
      ProjectRefused,
    );
  });
});

describe("the bank guarantee", () => {
  it("expires before the acceptance and says so", async () => {
    // No PV yet and no planned date, so the fallback is the expiring window —
    // which still catches it, 8 days out.
    const p = await getProject(projectId, NOW);
    expect(p?.cautions[0]?.state).toBe("expiring");
    expect(p?.cautionsNeedingAttention).toBe(1);
  });

  it("turns critical once an acceptance date exists that it does not reach", async () => {
    await db
      .update(project)
      .set({ pvProvisoirePlanned: "2026-10-05" })
      .where(eq(project.id, projectId));

    const p = await getProject(projectId, NOW);
    expect(p?.cautions[0]?.state).toBe("expiresBeforeAcceptance");
  });
});

describe("physical progress is somebody's estimate", () => {
  it("is stored with a name against it, and shows the gap", async () => {
    await setPhysicalProgress({ projectId, percent: 62, actorId: ACTOR });

    const p = await getProject(projectId, NOW);
    expect(p?.progress.physicalPercent).toBe(62);
    // 62 estimated against 25 billed: 37 points of work not yet asked for.
    expect(p?.progress.aheadOfBilling).toBe(37);
  });

  it("refuses a percentage that is not one", async () => {
    await expect(
      setPhysicalProgress({ projectId, percent: 140, actorId: ACTOR }),
    ).rejects.toBeInstanceOf(ProjectRefused);
  });
});

describe("the list", () => {
  it("shows the project as active while nothing has been accepted", async () => {
    const rows = await listProjects(NOW);
    const mine = rows.find((r) => r.id === projectId);
    expect(mine?.state).toBe("active");
    expect(mine?.situationsApproved).toBe(2);
    expect(mine?.situationsTotal).toBe(3);
  });

  it("moves it to warranty once accepted while the retention is still held", async () => {
    await db.update(project).set({ pvProvisoireOn: "2026-08-15" }).where(eq(project.id, projectId));

    const rows = await listProjects(NOW);
    expect(rows.find((r) => r.id === projectId)?.state).toBe("warranty");

    await db.update(project).set({ pvProvisoireOn: null }).where(eq(project.id, projectId));
  });

  it("adds the retention across every project for the header", async () => {
    const counts = await projectCounts(NOW);
    expect(Number(counts.retentionHeld)).toBeGreaterThanOrEqual(67000);
    expect(counts.waiting).toBeGreaterThan(0);
  });
});
