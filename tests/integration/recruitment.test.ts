import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { person, personCertification } from "@/db/schema/party";
import { personnelCandidate, personnelRequest } from "@/db/schema/recruitment";
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
