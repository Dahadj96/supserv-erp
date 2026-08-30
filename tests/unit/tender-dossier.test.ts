import { describe, expect, it } from "vitest";
import {
  type CredentialInput,
  dossier,
  EXPIRING_WITHIN_DAYS,
  isBlocking,
  PIECE_STATES,
  type PieceInput,
  pieceState,
} from "@/domain/tender/dossier";
import { CREDENTIAL_KEYS, SEED_PIECES, seedFor } from "@/domain/tender/pieces";

/**
 * The failure this whole screen exists for, in one sentence:
 *
 *   A CASNOS attestation valid today, expiring 30 August, deposited 2
 *   September, in a folder that is otherwise perfect.
 *
 * Every other screen in this system would call that document valid. It IS
 * valid. The bid is still thrown out at the desk, because the date that decides
 * is not today — it is the day the envelope is opened.
 *
 * `now` and `closesAt` are both arguments for that reason. A function reading
 * its own clock could not be tested against September.
 */

const NOW = new Date("2026-08-21T09:00:00Z");
const CLOSES = new Date("2026-09-02T10:00:00Z");

function piece(over: Partial<PieceInput> = {}): PieceInput {
  return {
    key: "casnos",
    section: "administratif",
    label: null,
    position: 1,
    credentialKey: "casnos",
    fileId: null,
    ...over,
  };
}

function credential(over: Partial<CredentialInput> = {}): CredentialInput {
  return {
    key: "casnos",
    reference: null,
    expiresOn: "2026-12-31",
    fileId: "papers/casnos.pdf",
    ...over,
  };
}

describe("one piece of paper, against the day of the deposit", () => {
  it("is ready when it is on file and expires long after", () => {
    const state = pieceState({
      piece: piece(),
      credential: credential(),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).toBe("ready");
  });

  it("is missing when nobody has filed the company's copy", () => {
    const state = pieceState({
      piece: piece(),
      credential: credential({ fileId: null }),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).toBe("missing");
  });

  it("is missing when the company holds no such paper at all", () => {
    const state = pieceState({ piece: piece(), credential: undefined, now: NOW, closesAt: CLOSES });
    expect(state.state).toBe("missing");
  });

  it("is ready when the paper does not expire", () => {
    // The statuts, the registre de commerce. A null expiry is not a missing
    // date to be chased — it is a fact about the document.
    const state = pieceState({
      piece: piece({ key: "statuts", credentialKey: "statuts" }),
      credential: credential({ key: "statuts", expiresOn: null }),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).toBe("ready");
    expect(state.daysLeft).toBeNull();
  });

  it("EXPIRES BEFORE DEPOSIT — valid today, useless on the day it matters", () => {
    const state = pieceState({
      piece: piece(),
      credential: credential({ expiresOn: "2026-08-30" }),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).toBe("expiresBeforeDeposit");
    expect(state.daysLeft).toBe(9); // still nine days of validity left, and useless
    expect(isBlocking(state.state)).toBe(true);
  });

  it("does not soften that into 'expiring soon' just because it is within thirty days", () => {
    // Both are true of the same paper. Reporting the gentler one would put the
    // row that ends the bid below four amber rows that do not.
    const state = pieceState({
      piece: piece(),
      credential: credential({ expiresOn: "2026-08-30" }),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).not.toBe("expiring");
  });

  it("is merely expiring when it outlives the deposit but not by much", () => {
    const state = pieceState({
      piece: piece(),
      credential: credential({ expiresOn: "2026-09-14" }),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).toBe("expiring");
    expect(isBlocking(state.state)).toBe(false);
  });

  it("is expired when the day has already passed", () => {
    const state = pieceState({
      piece: piece(),
      credential: credential({ expiresOn: "2026-08-01" }),
      now: NOW,
      closesAt: CLOSES,
    });
    expect(state.state).toBe("expired");
    expect(state.daysLeft).toBeLessThan(0);
  });

  it("falls back to the thirty-day warning when no closing date is recorded", () => {
    // A tender with no deadline yet still has to say a paper is about to go.
    const soon = pieceState({
      piece: piece(),
      credential: credential({ expiresOn: "2026-09-10" }),
      now: NOW,
      closesAt: null,
    });
    expect(soon.state).toBe("expiring");

    const far = pieceState({
      piece: piece(),
      credential: credential({ expiresOn: "2027-01-01" }),
      now: NOW,
      closesAt: null,
    });
    expect(far.state).toBe("ready");
  });

  it("treats a tender-specific piece as on file or not, and never as expiring", () => {
    const missing = pieceState({
      piece: piece({ key: "planning", credentialKey: null }),
      credential: undefined,
      now: NOW,
      closesAt: CLOSES,
    });
    expect(missing.state).toBe("missing");

    const there = pieceState({
      piece: piece({ key: "planning", credentialKey: null, fileId: "t/planning.pdf" }),
      credential: undefined,
      now: NOW,
      closesAt: CLOSES,
    });
    expect(there.state).toBe("ready");
    expect(there.expiresOn).toBeNull();
  });

  it("never invents a state the screen has no label for", () => {
    const cases: Array<CredentialInput | undefined> = [
      undefined,
      credential(),
      credential({ expiresOn: null }),
      credential({ expiresOn: "2026-08-21" }),
      credential({ fileId: null }),
    ];
    for (const one of cases) {
      const state = pieceState({ piece: piece(), credential: one, now: NOW, closesAt: CLOSES });
      expect(PIECE_STATES).toContain(state.state);
    }
  });

  it("has a warning window worth having", () => {
    // Renewing a CNAS attestation is a morning at a counter, not a click.
    expect(EXPIRING_WITHIN_DAYS).toBeGreaterThanOrEqual(14);
  });
});

describe("the folder as a whole", () => {
  const pieces: PieceInput[] = [
    piece({ key: "declaration_souscrire", credentialKey: null, fileId: "a.pdf", position: 1 }),
    piece({ key: "rc_copy", credentialKey: "rc_copy", position: 2 }),
    piece({ key: "cnas", credentialKey: "cnas", position: 3 }),
    piece({ key: "casnos", credentialKey: "casnos", position: 4 }),
    piece({ key: "casier_judiciaire", credentialKey: "casier_judiciaire", position: 5 }),
    piece({ key: "planning", section: "technique", credentialKey: null, position: 6 }),
    piece({
      key: "bpu",
      section: "financier",
      credentialKey: null,
      fileId: "bpu.pdf",
      position: 7,
    }),
  ];

  const credentials: CredentialInput[] = [
    credential({ key: "rc_copy", expiresOn: null }),
    credential({ key: "cnas", expiresOn: "2026-09-14" }), // expiring, but survives the deposit
    credential({ key: "casnos", expiresOn: "2026-08-30" }), // dead by the deposit
    // casier_judiciaire: not held at all
  ];

  const folder = dossier({ pieces, credentials, now: NOW, closesAt: CLOSES });

  it("counts only what is ready, and floors the percentage", () => {
    // Ready: declaration, rc_copy, bpu. Not ready: cnas (expiring), casnos,
    // casier, planning. 3 of 7 is 42.857…
    expect(folder.ready).toBe(3);
    expect(folder.total).toBe(7);
    expect(folder.percent).toBe(42);
  });

  it("does not round a folder that will be refused up to the next number", () => {
    // The frame prints 78 % over 7 of 9, which is 77.7 rounded up. The one
    // figure everybody reads should not flatter.
    const seven = dossier({
      pieces: Array.from({ length: 9 }, (_, i) =>
        piece({ key: `k${i}`, credentialKey: null, fileId: i < 7 ? "f" : null, position: i }),
      ),
      credentials: [],
      now: NOW,
      closesAt: CLOSES,
    });
    expect(seven.percent).toBe(77);
  });

  it("breaks the count down by envelope", () => {
    const admin = folder.sections.find((s) => s.section === "administratif");
    expect(admin).toEqual({ section: "administratif", ready: 2, total: 5 });
  });

  it("shows no section that has nothing in it", () => {
    // A consultation with no financial envelope should not print an empty
    // heading reading 0 / 0.
    const only = dossier({
      pieces: [piece({ credentialKey: null, fileId: "a" })],
      credentials: [],
      now: NOW,
      closesAt: CLOSES,
    });
    expect(only.sections.map((s) => s.section)).toEqual(["administratif"]);
  });

  it("lists what ends the bid, worst first", () => {
    expect(folder.blocking.map((p) => p.key)).toEqual([
      "casier_judiciaire", // missing
      "planning", // missing
      "casnos", // expires before deposit
    ]);
  });

  it("leaves the merely expiring one out of the blocking list", () => {
    expect(folder.blocking.map((p) => p.key)).not.toContain("cnas");
    expect(folder.pieces.find((p) => p.key === "cnas")?.state).toBe("expiring");
  });

  it("has something to say about an empty folder rather than dividing by zero", () => {
    const empty = dossier({ pieces: [], credentials: [], now: NOW, closesAt: CLOSES });
    expect(empty.percent).toBe(0);
    expect(empty.sections).toEqual([]);
    expect(empty.blocking).toEqual([]);
  });

  it("keeps the order the office put the pieces in", () => {
    const shuffled = dossier({
      pieces: [...pieces].reverse(),
      credentials,
      now: NOW,
      closesAt: CLOSES,
    });
    expect(shuffled.pieces.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("the list a new tender starts from", () => {
  it("points every credential-backed piece at a paper the company can hold", () => {
    const known = new Set<string>(CREDENTIAL_KEYS);
    for (const seed of SEED_PIECES) {
      if (seed.credentialKey) expect(known, seed.key).toContain(seed.credentialKey);
    }
  });

  it("names each piece once", () => {
    const keys = SEED_PIECES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries all three envelopes for a public procedure", () => {
    const sections = new Set(seedFor("aonr").map((s) => s.section));
    expect([...sections].sort()).toEqual(["administratif", "financier", "technique"]);
  });

  it("does not carry a bid bond into a consultation", () => {
    // Four permanent red rows on a screen where nothing is wrong is how people
    // learn to ignore red rows.
    const keys = seedFor("consultation").map((s) => s.key);
    expect(keys).not.toContain("caution");
    expect(keys).not.toContain("qualification");
    expect(seedFor("aonr").map((s) => s.key)).toContain("caution");
  });
});
