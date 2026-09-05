import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { person, personCertification } from "@/db/schema/party";
import { personnelCandidate, personnelRequest } from "@/db/schema/recruitment";
import { CertificationRefused, saveCertification, setCertificationVerified } from "@/domain/people";
import {
  candidateCounts,
  createRequest,
  decideCandidate,
  getCandidate,
  hire,
  listCandidates,
  listRequests,
  RecruitmentRefused,
  requestCounts,
  setCandidateStage,
  shortlist,
} from "@/domain/recruitment/store";

/**
 * Screens 24, 25 and 26 against a real database.
 *
 * The thing only a database can prove: that a welding attestation on
 * `person_certification` reaches the headcount on a personnel request, and that
 * when it lapses before the start date the man stops counting.
 */
const ACTOR = "test-recruitment-actor";
const NOW = new Date("2026-08-18T09:00:00Z");
const START = "2026-08-24";

const people: string[] = [];
const requests: string[] = [];

async function makePerson(opts: {
  name: string;
  trade: string;
  expiresOn?: string | null;
  relationship?: string;
}) {
  const [row] = await db
    .insert(person)
    .values({
      fullName: opts.name,
      trade: opts.trade,
      source: "cv",
      relationship: opts.relationship ?? "candidate",
      stage: "new",
      appliedFor: opts.trade,
      mobility: "Toutes wilayas",
    })
    .returning({ id: person.id });
  const id = row?.id as string;
  people.push(id);

  if (opts.expiresOn !== undefined && opts.expiresOn !== null) {
    await db.insert(personCertification).values([
      { personId: id, kind: "Soudage arc", expiresOn: opts.expiresOn },
      // A second, later one. The join must pick the SOONEST.
      { personId: id, kind: "Habilitation B1V", expiresOn: "2028-01-01" },
    ]);
  }
  return id;
}

let goodWelder = "";
let lapsingWelder = "";
let labourer = "";
let requestId = "";

beforeAll(async () => {
  goodWelder = await makePerson({
    name: "W. Mezgouche (TEST)",
    trade: "Soudeur",
    expiresOn: "2027-03-12",
  });
  lapsingWelder = await makePerson({
    name: "H. Ferhat (TEST)",
    trade: "Soudeur",
    expiresOn: "2026-08-22",
  });
  labourer = await makePerson({ name: "F. Zerrouki (TEST)", trade: "Manoeuvre" });

  requestId = await createRequest({
    role: "Soudeur",
    wilaya: "In Salah",
    needed: 2,
    startOn: START,
    certificationRequired: true,
    actorId: ACTOR,
  });
  requests.push(requestId);

  await shortlist({ requestId, personId: goodWelder, stage: "confirmed", actorId: ACTOR });
  await shortlist({ requestId, personId: lapsingWelder, stage: "confirmed", actorId: ACTOR });
});

afterAll(async () => {
  if (requests.length) {
    await db.delete(personnelCandidate).where(inArray(personnelCandidate.requestId, requests));
    await db.delete(personnelRequest).where(inArray(personnelRequest.id, requests));
  }
  if (people.length) {
    await db.delete(personCertification).where(inArray(personCertification.personId, people));
    await db.delete(person).where(inArray(person.id, people));
  }
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
});

describe("a request counts who can actually go", () => {
  it("takes the SOONEST-expiring certification, not the latest", async () => {
    const rows = await listRequests(NOW);
    const mine = rows.find((r) => r.id === requestId);
    const lapsing = mine?.shortlist.find((s) => s.personId === lapsingWelder);
    expect(lapsing?.certification).toBe("Soudage arc");
    expect(lapsing?.certificationExpiresOn).toBe("2026-08-22");
  });

  it("does not count the man whose ticket lapses before the start", async () => {
    const rows = await listRequests(NOW);
    const mine = rows.find((r) => r.id === requestId);
    expect(mine?.request.confirmed).toBe(2);
    expect(mine?.request.usable).toBe(1);
    expect(mine?.request.blocked).toHaveLength(1);
    expect(mine?.request.state).toBe("urgent");
  });

  it("counts him again the moment the certificate is renewed", async () => {
    await db
      .update(personCertification)
      .set({ expiresOn: "2027-06-30" })
      .where(eq(personCertification.personId, lapsingWelder));

    const rows = await listRequests(NOW);
    const mine = rows.find((r) => r.id === requestId);
    expect(mine?.request.usable).toBe(2);
    expect(mine?.request.state).toBe("filled");

    // Put it back for the rest.
    await db
      .update(personCertification)
      .set({ expiresOn: "2026-08-22" })
      .where(eq(personCertification.personId, lapsingWelder));
  });

  it("refuses a request for nobody, and one with no role", async () => {
    await expect(createRequest({ role: "  ", actorId: ACTOR })).rejects.toBeInstanceOf(
      RecruitmentRefused,
    );
    await expect(
      createRequest({ role: "Soudeur", needed: 0, actorId: ACTOR }),
    ).rejects.toBeInstanceOf(RecruitmentRefused);
  });

  it("refuses to put the same person on one shortlist twice", async () => {
    await expect(
      shortlist({ requestId, personId: goodWelder, actorId: ACTOR }),
    ).rejects.toBeInstanceOf(RecruitmentRefused);
  });

  it("counts the positions still to fill for the header", async () => {
    const counts = await requestCounts(NOW);
    expect(counts.positions).toBeGreaterThanOrEqual(1);
    expect(counts.withinSeven).toBeGreaterThanOrEqual(1);
  });
});

describe("deciding about a person", () => {
  it("refuses a rejection with no reason, the same rule the go/no-go card follows", async () => {
    const rows = await listRequests(NOW);
    const entry = rows
      .find((r) => r.id === requestId)
      ?.shortlist.find((s) => s.personId === lapsingWelder);

    await expect(
      decideCandidate({ candidateId: entry?.id as string, stage: "rejected", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(RecruitmentRefused);
  });

  it("records the rejection and its reason against the request", async () => {
    const rows = await listRequests(NOW);
    const entry = rows
      .find((r) => r.id === requestId)
      ?.shortlist.find((s) => s.personId === lapsingWelder);

    await decideCandidate({
      candidateId: entry?.id as string,
      stage: "rejected",
      reason: "Attestation expires before the start and the renewal will not be back in time",
      actorId: ACTOR,
    });

    const after = await listRequests(NOW);
    const mine = after.find((r) => r.id === requestId);
    expect(mine?.request.confirmed).toBe(1);

    const entries = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entity, "personnel_request"));
    expect(entries.some((e) => (e.after as { reason?: string })?.reason?.includes("expires"))).toBe(
      true,
    );
  });
});

describe("a candidate is a person", () => {
  it("lists them with their pipeline stage and their soonest ticket", async () => {
    const rows = await listCandidates(NOW);
    const mine = rows.find((r) => r.id === goodWelder);
    expect(mine?.stage).toBe("new");
    expect(mine?.certification).toBe("Soudage arc");
    expect(mine?.hired).toBe(false);
  });

  it("moves along the pipeline, and says who moved them", async () => {
    await setCandidateStage({ personId: goodWelder, stage: "shortlisted", actorId: ACTOR });
    await setCandidateStage({ personId: goodWelder, stage: "interview", actorId: ACTOR });
    const rows = await listCandidates(NOW);
    expect(rows.find((r) => r.id === goodWelder)?.stage).toBe("interview");
  });

  it("refuses a jump the state machine does not declare", async () => {
    // new -> hired is not an edge. Screen 64's graph is enforced here, not
    // drawn: somebody is interviewed before they are employed, or the pipeline
    // means nothing.
    await expect(
      setCandidateStage({ personId: labourer, stage: "hired", actorId: ACTOR }),
    ).rejects.toThrow();
  });

  it("keeps the row, the trade and every certification when they are hired", async () => {
    const before = await getCandidate(goodWelder, NOW);
    await hire({ personId: goodWelder, actorId: ACTOR });
    const after = await getCandidate(goodWelder, NOW);

    expect(after?.id).toBe(before?.id);
    expect(after?.trade).toBe(before?.trade);
    expect(after?.certifications).toHaveLength(before?.certifications.length ?? 0);
    expect(after?.hired).toBe(true);
  });

  it("keeps a hired person in the list, so the Hired chip is not always zero", async () => {
    const rows = await listCandidates(NOW);
    expect(rows.map((r) => r.id)).toContain(goodWelder);

    const counts = await candidateCounts(NOW);
    expect(counts.hired).toBeGreaterThan(0);
  });

  it("refuses to hire somebody who is not a candidate", async () => {
    await expect(hire({ personId: goodWelder, actorId: ACTOR })).rejects.toBeInstanceOf(
      RecruitmentRefused,
    );
  });

  it("shows what a person is being considered for, from the shortlists", async () => {
    const c = await getCandidate(lapsingWelder, NOW);
    expect(c?.considered).toHaveLength(1);
    expect(c?.considered[0]?.stage).toBe("rejected");
  });

  it("counts an expiring certification for the banner", async () => {
    const counts = await candidateCounts(NOW);
    // The lapsing welder's ticket runs out on 22 Aug, four days out.
    expect(counts.expiring).toBeGreaterThan(0);
  });

  it("says nothing about a labourer who holds no ticket at all", async () => {
    const rows = await listCandidates(NOW);
    const mine = rows.find((r) => r.id === labourer);
    expect(mine?.certification).toBeNull();
    expect(mine?.daysLeft).toBeNull();
  });
});

/**
 * The tickets, written down.
 *
 * Screen 25 read `person_certification` from the day it was built, screen 51
 * puts the soonest-expiring one on every row, and screen 16's crew panel
 * decides off it whether a man may work tomorrow. Nothing in the application
 * could write one: the only inserts in the repository were in files like this
 * one. The company's welders held habilitations and the ERP had nowhere to
 * type them.
 */
describe("writing a man's tickets down", () => {
  it("records one against the person, with who typed it", async () => {
    const id = await saveCertification(
      labourer,
      {
        kind: "CACES R482 cat. A",
        number: "CAC/2026/119",
        issuedBy: "CFPA Adrar",
        issuedOn: "2026-02-10",
        expiresOn: "2031-02-10",
      },
      ACTOR,
    );

    const c = (await getCandidate(labourer, NOW))?.certifications.find((x) => x.id === id);
    expect(c?.kind).toBe("CACES R482 cat. A");
    expect(c?.number).toBe("CAC/2026/119");
    expect(c?.issuedBy).toBe("CFPA Adrar");
    // And it reaches the OTHER screens, which is the whole point.
    expect((await listCandidates(NOW)).find((r) => r.id === labourer)?.certification).toBe(
      "CACES R482 cat. A",
    );
  });

  it("takes a ticket with no expiry, because a diploma does not have one", async () => {
    const id = await saveCertification(labourer, { kind: "CAP électricité" }, ACTOR);
    const c = (await getCandidate(labourer, NOW))?.certifications.find((x) => x.id === id);
    expect(c?.expiresOn).toBeNull();
    // Null, not a nought or a date this system chose. Screen 25 says
    // "n'expire pas" for it.
    expect(c?.daysLeft).toBeNull();
  });

  it("refuses a ticket that expired before it was issued", async () => {
    // A typo the screen would otherwise draw as a man permanently barred.
    await expect(
      saveCertification(
        labourer,
        { kind: "Habilitation B1V", issuedOn: "2026-05-01", expiresOn: "2025-05-01" },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(CertificationRefused);
  });

  it("is not checked until somebody says they have seen the original", async () => {
    const id = await saveCertification(labourer, { kind: "Habilitation B0" }, ACTOR);
    const before = (await getCandidate(labourer, NOW))?.certifications.find((x) => x.id === id);
    // The badge said this on every ticket in the company for as long as the
    // screen existed, because `is_verified` was a boolean nothing could set.
    expect(before?.verified).toBe(false);

    await setCertificationVerified({
      certificationId: id,
      verified: true,
      actorId: ACTOR,
      now: new Date("2026-08-18T11:00:00Z"),
    });

    const after = (await getCandidate(labourer, NOW))?.certifications.find((x) => x.id === id);
    expect(after?.verified).toBe(true);
    expect(after?.verifiedOn).toBe("2026-08-18");
    // The actor here is a test string and not a user row: LEFT join, so a check
    // made by somebody who has since left is still a check that was made.
    expect(after?.verifiedByName).toBeNull();
  });

  it("lets a check be withdrawn, because one given in error must not be permanent", async () => {
    const id = await saveCertification(labourer, { kind: "Habilitation H0" }, ACTOR);
    await setCertificationVerified({ certificationId: id, verified: true, actorId: ACTOR });
    await setCertificationVerified({ certificationId: id, verified: false, actorId: ACTOR });

    const c = (await getCandidate(labourer, NOW))?.certifications.find((x) => x.id === id);
    expect(c?.verified).toBe(false);
    expect(c?.verifiedOn).toBeNull();

    // Both directions are in the audit trail: the withdrawal is a fact too.
    const trail = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, id))
      .orderBy(asc(auditEntry.at));
    expect(trail.map((e) => (e.after as { verified?: boolean }).verified)).toEqual([
      undefined,
      true,
      false,
    ]);
  });

  it("refuses to check a ticket that does not exist", async () => {
    await expect(
      setCertificationVerified({
        certificationId: "00000000-0000-4000-8000-000000000000",
        verified: true,
        actorId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(CertificationRefused);
  });
});
