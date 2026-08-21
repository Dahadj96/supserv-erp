import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { item, itemAlias } from "@/db/schema/item";
import { party, person } from "@/db/schema/party";
import { createItem, rememberMatch } from "@/domain/item";
import { searchItems, searchPeople } from "@/domain/search";

/**
 * Screen 82, the other two scopes.
 *
 * "Somebody typing a name does not know or care which of the two screens the
 * person is on." A contact and one of ours come back from the same search, each
 * labelled, and an item is found by whatever anybody has ever called it.
 */
const COMPANY = "TEST-SR-COMPANY";
const ACTOR_ITEM = "Régulateur de pression 16 bar";

let companyId: string;
let itemId: string;
const personIds: string[] = [];

beforeAll(async () => {
  await db.delete(party).where(eq(party.code, COMPANY));

  const [c] = await db
    .insert(party)
    .values({ code: COMPANY, legalName: "SOCIETE DE TEST RECHERCHE" })
    .returning({ id: party.id });
  companyId = c?.id as string;

  const made = await db
    .insert(person)
    .values([
      {
        fullName: "Hamza Kaddour Benkada",
        trade: "Purchasing",
        email: "h.benkada@test-search.dz",
        employerPartyId: companyId,
        source: "direct",
        relationship: "external",
      },
      {
        fullName: "S. Lounis",
        trade: "Chef de chantier",
        source: "direct",
        relationship: "employee",
      },
    ])
    .returning({ id: person.id });
  personIds.push(...made.map((m) => m.id));

  const created = await createItem({ designation: ACTOR_ITEM, kind: "good", brand: "Nardi" });
  itemId = created.id;
  await rememberMatch({
    itemId,
    clientWording: ACTOR_ITEM,
    supplierWording: "Détendeur 16 bar NARDI DR-16",
  });
});

afterAll(async () => {
  await db.delete(person).where(inArray(person.id, personIds));
  await db.delete(party).where(eq(party.code, COMPANY));
  await db.delete(itemAlias).where(eq(itemAlias.itemId, itemId));
  await db.delete(item).where(eq(item.id, itemId));
});

describe("screen 82 — people, contacts and items", () => {
  it("returns a contact and one of ours from the same search", async () => {
    const contact = (await searchPeople("Kaddour", 50)).find(
      (h) => h.fullName === "Hamza Kaddour Benkada",
    );
    const ours = (await searchPeople("Lounis", 50)).find((h) => h.fullName === "S. Lounis");

    expect(contact?.relationship, "labelled so the row says which screen it is on").toBe(
      "external",
    );
    expect(contact?.companyName).toBe("SOCIETE DE TEST RECHERCHE");
    expect(ours?.relationship).toBe("employee");
    expect(ours?.companyName, "null means SUPSERV").toBeNull();
  });

  it("finds a person by their trade, not only by their name", async () => {
    const hits = await searchPeople("chef de chantier", 50);
    const hit = hits.find((h) => h.fullName === "S. Lounis");
    expect(hit).toBeDefined();
    expect(hit?.matchedOn).toBe("trade");
  });

  it("finds a contact by the email address, and says so", async () => {
    const hits = await searchPeople("benkada@test-search", 50);
    const hit = hits.find((h) => h.fullName === "Hamza Kaddour Benkada");
    expect(hit?.matchedOn).toBe("email");
  });

  it("finds an item by its own designation and by its reference", async () => {
    const byName = await searchItems("regulateur de pression", 50);
    expect(byName.map((h) => h.id)).toContain(itemId);

    const [row] = await db.select({ code: item.code }).from(item).where(eq(item.id, itemId));
    const byCode = await searchItems(row?.code ?? "", 50);
    expect(byCode[0]?.id).toBe(itemId);
    expect(byCode[0]?.matchedOn).toBe("code");
  });

  it("finds an item by what the supplier calls it, and says which alias matched", async () => {
    const hits = await searchItems("Détendeur 16 bar NARDI", 50);
    const hit = hits.find((h) => h.id === itemId);
    expect(hit, "the supplier's wording must find the client's item").toBeDefined();
    expect(hit?.matchedOn).toBe("alias");
    expect(hit?.matchedAlias).toBe("Détendeur 16 bar NARDI DR-16");
  });

  it("ignores a term too short to mean anything", async () => {
    // One letter would match most of the database and help nobody.
    expect(await searchPeople("a")).toEqual([]);
    expect(await searchItems("x")).toEqual([]);
  });

  it("returns both scopes for one term, so nobody has to guess which screen", async () => {
    const [people, items] = await Promise.all([
      searchPeople("Benkada", 50),
      searchItems("pression", 50),
    ]);
    expect(people.length).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
  });
});
