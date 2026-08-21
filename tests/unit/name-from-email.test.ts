import { describe, expect, it } from "vitest";
import { nameFromEmail } from "@/domain/merge";

/**
 * Screen 84: the losing email becomes a contact rather than being thrown away.
 * The whole risk is guessing wrong, so the guesses are pinned here.
 */
describe("a name guessed from an email address", () => {
  it("splits on a full stop and capitalises", () => {
    expect(nameFromEmail("m.belkacem@touatgaz.dz")).toBe("M. Belkacem");
  });

  it("handles underscores and hyphens", () => {
    expect(nameFromEmail("amine_haddad@x.dz")).toBe("Amine Haddad");
    expect(nameFromEmail("nadia-bensalem@x.dz")).toBe("Nadia Bensalem");
  });

  it("keeps a single name as a single name", () => {
    expect(nameFromEmail("karim@x.dz")).toBe("Karim");
  });

  it("drops trailing digits people add to make an address unique", () => {
    expect(nameFromEmail("y.saidi2@x.dz")).toBe("Y. Saidi");
  });

  // The important half. A contact card called "Contact" is worse than none —
  // somebody will eventually write "Dear Contact".
  const roles = [
    "contact@touatgaz.dz",
    "info@x.dz",
    "commercial@x.dz",
    "direction@x.dz",
    "compta@x.dz",
    "no-reply@x.dz",
    "secretariat@x.dz",
  ];
  for (const address of roles) {
    it(`refuses to invent a person from ${address}`, () => {
      expect(nameFromEmail(address)).toBeNull();
    });
  }

  it("refuses an address that is only digits", () => {
    expect(nameFromEmail("12345@x.dz")).toBeNull();
  });
});
