import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { party, person, personCertification } from "@/db/schema/party";
import { listContactRows } from "@/domain/contact";
import { createPerson, listPeople, type PeopleCounts, peopleCounts } from "@/domain/people";

/**
 * Screen 51. "A CV is evidence, not a requirement."
 *
 * The test that matters is the one nobody writes: that a person with no CV, no
 * ID number and no wilaya can exist at all, and is counted the same as one who
 * arrived with a full dossier.
 */
const SUBBIE = "TEST-PP-SUBBIE";
const ACTOR = "test-people-actor";

let subbieId: string;
let base: PeopleCounts;
const madeIds: string[] = [];

beforeAll(async () => {
  await db.delete(party).where(eq(party.code, SUBBIE));
  base = await peopleCounts();

  const [sub] = await db
    .insert(party)
    .values({ code: SUBBIE, legalName: "ETS NADIR" })
    .returning({ id: party.id });
  subbieId = sub?.id as string;

  const made = await db
    .insert(person)
    .values([
      {
        fullName: "Walid Mezgouche",
        trade: "Soudeur / plombier",
        source: "cv",
        relationship: "candidate",
        wilaya: "Toutes",
      },
      {
        // A day labourer. No CV, no ID number, no wilaya, no phone.
        fullName: "B. Hamadi",
        trade: "Manœuvre",
        source: "direct",
        relationship: "daily",
      },
      {
        // A subcontractor's welder. He has an employer and is still not a contact.
        fullName: "A. Meziane",
        trade: "Soudeur",
        source: "subcontractor",
        relationship: "subcontractor",
        employerPartyId: subbieId,
        wilaya: "In Salah",
      },
      {
        // A buyer at the same company. Same employer, different screen.
        fullName: "Acheteur chez Nadir",
        trade: "Achats",
        source: "direct",
        relationship: "external",
        employerPartyId: subbieId,
      },
    ])
    .returning({ id: person.id });
  madeIds.push(...made.map((m) => m.id));

  const welder = made[2]?.id as string;
  await db.insert(personCertification).values([
    { personId: welder, kind: "Soudage TIG", expiresOn: "2027-05-09" },
    // Sooner, so this is the one the row must show.
    { personId: welder, kind: "Habilitation B1V", expiresOn: "2026-09-04" },
  ]);
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(personCertification).where(inArray(personCertification.personId, madeIds));
  await db.delete(person).where(inArray(person.id, madeIds));
  await db.delete(party).where(eq(party.code, SUBBIE));
});

describe("screen 51 — a CV is evidence, not a requirement", () => {
  it("holds a person who has nothing but a name and a trade", async () => {
    const rows = await listPeople("all", 500);
    const hamadi = rows.find((r) => r.fullName === "B. Hamadi");

    expect(hamadi, "a day labourer with no documents must still exist").toBeDefined();
    expect(hamadi?.trade).toBe("Manœuvre");
    expect(hamadi?.wilaya).toBeNull();
    expect(hamadi?.certification).toBeNull();
  });

  it("keeps contacts off this screen and keeps the subcontractor's welder on it", async () => {
    const people = (await listPeople("all", 500)).map((r) => r.fullName);
    const contacts = (await listContactRows("all", 500)).map((r) => r.fullName);

    expect(people).toContain("A. Meziane");
    expect(people).not.toContain("Acheteur chez Nadir");
    expect(contacts).toContain("Acheteur chez Nadir");
    expect(contacts).not.toContain("A. Meziane");
  });

  it("carries the employer, because that is what the relationship column says", async () => {
    const meziane = (await listPeople("all", 500)).find((r) => r.fullName === "A. Meziane");
    expect(meziane?.employerName).toBe("ETS NADIR");

    const hamadi = (await listPeople("all", 500)).find((r) => r.fullName === "B. Hamadi");
    expect(hamadi?.employerName, "null means SUPSERV").toBeNull();
  });

  it("shows the certification that expires first", async () => {
    const meziane = (await listPeople("all", 500)).find((r) => r.fullName === "A. Meziane");
    expect(meziane?.certification?.kind).toBe("Habilitation B1V");
    expect(meziane?.certification?.expiresOn).toBe("2026-09-04");
  });

  it("counts all four origins as equals", async () => {
    const now = await peopleCounts();
    expect(now.all - base.all, "the contact is not one of these").toBe(3);
    expect(now.cv - base.cv).toBe(1);
    expect(now.direct - base.direct).toBe(1);
    expect(now.subcontractor - base.subcontractor).toBe(1);
    expect(now.import - base.import).toBe(0);
  });

  it("filters by how somebody arrived, without treating any origin as better", async () => {
    const fromCv = await listPeople("cv", 500);
    expect(fromCv.map((r) => r.fullName)).toContain("Walid Mezgouche");
    expect(fromCv.map((r) => r.fullName)).not.toContain("B. Hamadi");
  });

  it("observes the source rather than asking for it", async () => {
    const typed = await createPerson(
      { fullName: "R. Bouzid", trade: "Chauffeur", relationship: "temporary" },
      ACTOR,
    );
    madeIds.push(typed);

    const sub = await createPerson(
      {
        fullName: "T. Saadi",
        trade: "Électricien BT",
        relationship: "subcontractor",
        employerPartyId: subbieId,
      },
      ACTOR,
    );
    madeIds.push(sub);

    const rows = await listPeople("all", 500);
    expect(rows.find((r) => r.id === typed)?.source).toBe("direct");
    expect(rows.find((r) => r.id === sub)?.source).toBe("subcontractor");
  });

  it("refuses a person with no trade, and says which field", async () => {
    await expect(
      createPerson({ fullName: "Sans métier", trade: "", relationship: "daily" }, ACTOR),
    ).rejects.toThrow(/tradeRequired/);
  });

  it("writes who added them, and from which screen", async () => {
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.sourceScreen === "51")).toBe(true);
  });
});
