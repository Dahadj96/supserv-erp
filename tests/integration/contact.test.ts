import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { party, partyRole, person } from "@/db/schema/party";
import {
  type ContactCounts,
  type ContactQuality,
  contactCounts,
  contactQuality,
  contactStatus,
  createContact,
  listContactRows,
  markContactVerified,
} from "@/domain/contact";

/**
 * Screen 76. Two things are being proved here.
 *
 * One: a contact is a person at ANOTHER company. SUPSERV's own staff and the
 * contacts of a company that has been binned, archived or merged away all stay
 * off this screen, and each of those is a separate way to get it wrong.
 *
 * Two: Active / Unverified / Bouncing is computed (LAW 1). Nothing writes a
 * status column, so nothing can forget to update one.
 */
const CLIENT = "TEST-CT-CLIENT";
const SUPPLIER = "TEST-CT-SUPPLIER";
const GONE = "TEST-CT-BINNED";
const ACTOR = "test-contact-actor";

let clientId: string;
let supplierId: string;
let goneId: string;
let base: ContactCounts;
let baseQuality: ContactQuality;
const madeIds: string[] = [];

const company = async (code: string, legalName: string, role: string, binned = false) => {
  const [row] = await db
    .insert(party)
    .values({ code, legalName, deletedAt: binned ? new Date() : null })
    .returning({ id: party.id });
  const id = row?.id as string;
  await db.insert(partyRole).values({ partyId: id, role });
  return id;
};

beforeAll(async () => {
  await db.delete(party).where(inArray(party.code, [CLIENT, SUPPLIER, GONE]));

  // The numbers this database already holds. Everything below is asserted as a
  // delta, so the suite keeps passing on the day real contacts exist.
  base = await contactCounts();
  baseQuality = await contactQuality();

  clientId = await company(CLIENT, "TEST CLIENT SPA", "client");
  supplierId = await company(SUPPLIER, "TEST SUPPLIER SARL", "supplier");
  goneId = await company(GONE, "TEST BINNED SARL", "client", true);

  const made = await db
    .insert(person)
    .values([
      {
        fullName: "Hamza Kaddour Benkada",
        trade: "Purchasing",
        employerPartyId: clientId,
        email: "h.benkada@test-client.dz",
        phone: "+213 49 00 00 01",
        prefers: "email",
        verifiedAt: new Date(),
        lastContactAt: new Date(),
        source: "direct",
        relationship: "external",
      },
      {
        fullName: "Direction commerciale",
        trade: "Commercial",
        employerPartyId: supplierId,
        email: "contact@test-supplier.dz",
        bouncedAt: new Date(),
        source: "import",
        relationship: "external",
      },
      {
        // Neither an email nor a phone, and never contacted. Both counted.
        fullName: "M. Chergui",
        trade: "Gérant",
        employerPartyId: supplierId,
        source: "direct",
        relationship: "external",
      },
      {
        // SUPSERV's own — screen 51, not this one.
        fullName: "Ouvrier interne",
        trade: "Soudeur",
        employerPartyId: null,
        source: "cv",
        relationship: "employee",
      },
      {
        // At a binned company. Leaves the list with it.
        fullName: "Contact chez la binnée",
        trade: "Achats",
        employerPartyId: goneId,
        source: "direct",
        relationship: "external",
      },
    ])
    .returning({ id: person.id });
  madeIds.push(...made.map((m) => m.id));
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(person).where(inArray(person.employerPartyId, [clientId, supplierId, goneId]));
  await db.delete(person).where(inArray(person.id, madeIds));
  await db.delete(partyRole).where(inArray(partyRole.partyId, [clientId, supplierId, goneId]));
  await db.delete(party).where(inArray(party.code, [CLIENT, SUPPLIER, GONE]));
});

describe("screen 76 — a contact is a person at another company", () => {
  it("computes the status rather than storing one", () => {
    expect(contactStatus({ verifiedAt: null, bouncedAt: null })).toBe("unverified");
    expect(contactStatus({ verifiedAt: new Date(), bouncedAt: null })).toBe("active");
    // A bounce beats anything we believed yesterday.
    expect(contactStatus({ verifiedAt: new Date(), bouncedAt: new Date() })).toBe("bouncing");
  });

  it("leaves out our own staff and the contacts of a binned company", async () => {
    const rows = await listContactRows("all", 500);
    const names = rows.map((r) => r.fullName);

    expect(names).toContain("Hamza Kaddour Benkada");
    expect(names, "SUPSERV's own people belong to screen 51").not.toContain("Ouvrier interne");
    expect(names, "the company was binned, so its contacts go with it").not.toContain(
      "Contact chez la binnée",
    );
  });

  it("carries the company through, because that is the second column", async () => {
    const rows = await listContactRows("all", 500);
    const row = rows.find((r) => r.fullName === "Hamza Kaddour Benkada");
    expect(row?.companyName).toBe("TEST CLIENT SPA");
    expect(row?.companyId).toBe(clientId);
    expect(row?.status).toBe("active");
  });

  it("filters by what the employer is, not by what the contact is", async () => {
    const clients = await listContactRows("clients", 500);
    const suppliers = await listContactRows("suppliers", 500);

    expect(clients.map((r) => r.fullName)).toContain("Hamza Kaddour Benkada");
    expect(clients.map((r) => r.fullName)).not.toContain("M. Chergui");
    expect(suppliers.map((r) => r.fullName)).toContain("M. Chergui");
  });

  it("finds the bouncing one on its own chip", async () => {
    const bouncing = await listContactRows("bouncing", 500);
    expect(bouncing.map((r) => r.fullName)).toContain("Direction commerciale");
    expect(bouncing.every((r) => r.status === "bouncing")).toBe(true);
  });

  it("counts three new contacts, not five", async () => {
    const now = await contactCounts();
    // Five people were inserted. Two of them are not contacts.
    expect(now.all - base.all).toBe(3);
    expect(now.clients - base.clients).toBe(1);
    expect(now.suppliers - base.suppliers).toBe(2);
    expect(now.bouncing - base.bouncing).toBe(1);
    // Unverified excludes the bouncing one — a bounce is not "not yet checked".
    expect(now.unverified - base.unverified).toBe(1);
  });

  it("counts the gaps somebody can go and fix", async () => {
    const now = await contactQuality();
    expect(now.total - baseQuality.total).toBe(3);
    expect(now.withEmail - baseQuality.withEmail).toBe(2);
    expect(now.withPhone - baseQuality.withPhone).toBe(1);
    expect(now.neither - baseQuality.neither, "M. Chergui has neither").toBe(1);
    expect(now.neverContacted - baseQuality.neverContacted).toBe(2);
  });

  it("starts a new contact unverified, and turns it active when they reply", async () => {
    const id = await createContact(
      {
        fullName: "Yacine Gourari",
        job: "Project manager",
        companyId: clientId,
        email: "y.gourari@test-client.dz",
        phone: "",
        prefers: "email",
      },
      ACTOR,
    );
    madeIds.push(id);

    const before = (await listContactRows("all", 500)).find((r) => r.id === id);
    expect(before?.status, "nobody has confirmed the address reaches him").toBe("unverified");

    await markContactVerified(id, ACTOR);

    const after = (await listContactRows("all", 500)).find((r) => r.id === id);
    expect(after?.status).toBe("active");
  });

  it("writes who added the contact, and from which screen", async () => {
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.actorId, ACTOR));
    const created = entries.find((e) => e.action === "create");
    expect(created?.entity).toBe("person");
    expect(created?.sourceScreen).toBe("76");
  });
});
