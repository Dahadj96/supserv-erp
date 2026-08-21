import { describe, expect, it } from "vitest";
import { refuse } from "@/domain/users";

/**
 * Screen 30's two refusals. Both exist for the same reason: a system that can
 * be locked with all its data inside it, by one wrong click, by the only person
 * who could have unlocked it.
 */
const base = {
  targetUserId: "her",
  actorId: "him",
  current: null,
  next: "commercial",
  gerantCount: 2,
} as const;

describe("who may be given which role", () => {
  it("allows an ordinary assignment", () => {
    expect(refuse({ ...base })).toBeNull();
  });

  it("refuses to let anybody change their own role", () => {
    // Even a Gérant. Especially a Gérant — he is the one who can lock it.
    expect(refuse({ ...base, targetUserId: "him" })).toBe("self");
    expect(refuse({ ...base, targetUserId: "him", current: "gerant", next: "lecture" })).toBe(
      "self",
    );
  });

  it("refuses to take the role off the last Gérant", () => {
    expect(refuse({ ...base, current: "gerant", next: "lecture", gerantCount: 1 })).toBe(
      "lastGerant",
    );
    expect(refuse({ ...base, current: "gerant", next: null, gerantCount: 1 })).toBe("lastGerant");
  });

  it("allows demoting a Gérant once there is a second one", () => {
    expect(refuse({ ...base, current: "gerant", next: "compta", gerantCount: 2 })).toBeNull();
  });

  it("lets the last Gérant stay a Gérant", () => {
    // Re-applying the same role must not trip the guard.
    expect(refuse({ ...base, current: "gerant", next: "gerant", gerantCount: 1 })).toBeNull();
  });

  it("refuses a role the system has never heard of", () => {
    expect(refuse({ ...base, next: "administrateur" as never })).toBe("unknownRole");
  });

  it("allows taking a role away from somebody who is not a Gérant", () => {
    expect(refuse({ ...base, current: "commercial", next: null, gerantCount: 1 })).toBeNull();
  });

  it("checks the unknown role before anything else, so a typo never writes", () => {
    expect(refuse({ ...base, targetUserId: "him", next: "nonsense" as never })).toBe("unknownRole");
  });
});
