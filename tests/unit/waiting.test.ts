import { describe, expect, it } from "vitest";
import {
  neverAsked,
  QUIET_TOO_LONG,
  quietDays,
  tooLong,
  type Waiting,
  type WaitingGroup,
  waitingOn,
} from "@/domain/waiting/list";

/**
 * Screen 58 — Waiting on, with the frame's own rows.
 *
 *   Suppliers   ETS Boumediene      asked 16 Aug   quiet 3 days    chased 1×
 *               Vanne Algérie SPA   asked 16 Aug   quiet 3 days    chased 1×
 *               Import Sud SARL     asked 11 Aug   quiet 8 days    chased 2×  stopped
 *               Techno Fluides SNC  asked 18 Aug   quiet 1 day     —
 *   Clients     URBACON             since 12 May   quiet 128 days  chased 3×
 *               GCB — DR Ouest      since 01 Jun   quiet 108 days  chased 2×
 *               BALADNA             since 08 Aug   quiet 11 days   chased 1×
 *
 * Read against 19 August 2026, every "quiet for" on the frame is days since the
 * date in its own Since column — so its clock runs from the ASK, and it does
 * not restart when somebody chases. This code restarts it, deliberately: a
 * supplier chased this morning is not eight days quiet, and a page that insists
 * otherwise sends the same person three emails in a week. Where the frame and
 * this disagree, the frame has simply not been chased recently.
 *
 * Techno Fluides is the frame's own illustration of the other rule — screen 67:
 * "A bounced address is not a slow supplier — it is a broken record."
 */

const NOW = new Date("2026-08-19T09:00:00Z");
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

const row = (over: Partial<Waiting> & { id: string; group: WaitingGroup }): Waiting => ({
  who: over.id,
  what: "",
  forRef: null,
  forHref: null,
  askedAt: null,
  chased: 0,
  lastChasedAt: null,
  autoChaseAt: null,
  broken: false,
  ...over,
});

const BOUMEDIENE = row({
  id: "boumediene",
  group: "supplier",
  who: "ETS Boumediene",
  askedAt: at("2026-08-16"),
  chased: 1,
});
const IMPORT_SUD = row({
  id: "importsud",
  group: "supplier",
  who: "Import Sud SARL",
  askedAt: at("2026-08-11"),
  chased: 2,
});
const URBACON = row({
  id: "urbacon",
  group: "client",
  who: "URBACON (UCC)",
  askedAt: at("2026-05-12"),
  chased: 3,
});
const BADR = row({ id: "badr", group: "authority", who: "BADR Adrar" });

describe("how long the silence has run", () => {
  it("counts from the ask when nobody has chased", () => {
    expect(quietDays(BOUMEDIENE, NOW)).toBe(3);
    expect(quietDays(IMPORT_SUD, NOW)).toBe(8);
    expect(quietDays(URBACON, NOW)).toBe(99);
  });

  it("restarts the clock when somebody chases", () => {
    // The one place this departs from the frame, and on purpose: a supplier
    // chased this morning is not eight days quiet.
    const chasedYesterday = { ...IMPORT_SUD, lastChasedAt: at("2026-08-18") };
    expect(quietDays(chasedYesterday, NOW)).toBe(1);
  });

  it("says nothing rather than nought when we never actually asked", () => {
    // The frame prints "not requested" for the BADR caution. Zero days quiet
    // would read as "they answered immediately".
    expect(neverAsked(BADR)).toBe(true);
    expect(quietDays(BADR, NOW)).toBeNull();
  });

  it("never reports negative days for a date in the future", () => {
    expect(quietDays({ ...BOUMEDIENE, askedAt: at("2026-08-25") }, NOW)).toBe(0);
  });
});

describe("what counts as too long", () => {
  it("keeps a different clock for each kind of counterparty", () => {
    // A supplier silent for three days is slow; a bank silent for three days is
    // normal. One threshold would either shout about the bank every week or let
    // a supplier sit for a fortnight.
    expect(QUIET_TOO_LONG.supplier).toBeLessThan(QUIET_TOO_LONG.client);
    expect(QUIET_TOO_LONG.client).toBeLessThan(QUIET_TOO_LONG.authority);
  });

  it("marks the supplier at three days and not the client at three days", () => {
    expect(tooLong(BOUMEDIENE, NOW)).toBe(true);
    const clientThreeDays = row({ id: "c", group: "client", askedAt: at("2026-08-16") });
    expect(tooLong(clientThreeDays, NOW)).toBe(false);
  });

  it("does not mark a bounced address as quiet too long", () => {
    // It is not a slow supplier, it is a broken record, and chasing it forever
    // is how one quietly drops off the list.
    const bounced = { ...IMPORT_SUD, broken: true };
    expect(tooLong(bounced, NOW)).toBe(false);
  });

  it("does not mark something nobody ever asked for", () => {
    expect(tooLong(BADR, NOW)).toBe(false);
  });
});

describe("the page", () => {
  const view = waitingOn([BOUMEDIENE, IMPORT_SUD, URBACON, { ...BADR, broken: true }], NOW);

  it("groups by who owes the answer, in the frame's order", () => {
    expect(view.groups.map((g) => g.group)).toEqual(["supplier", "client", "authority"]);
  });

  it("puts the longest silence at the top of its group", () => {
    expect(view.groups[0]?.rows.map((r) => r.id)).toEqual(["importsud", "boumediene"]);
  });

  it("counts the total and how many are quiet too long", () => {
    expect(view.total).toBe(4);
    // Boumediene at 3 days, Import Sud at 8, Urbacon at 99. BADR is broken.
    expect(view.overdue).toBe(3);
  });

  it("counts dead ends apart from silences", () => {
    // A bounced address needs a different action from a chase — somebody has to
    // find the right address — so it is counted separately rather than swelling
    // a number that means "chase these".
    expect(view.broken).toBe(1);
    expect(view.overdue + view.broken).toBe(view.total);
  });

  it("drops a group with nothing in it rather than printing an empty heading", () => {
    expect(waitingOn([URBACON], NOW).groups.map((g) => g.group)).toEqual(["client"]);
  });

  it("says nothing is waiting when nothing is", () => {
    const empty = waitingOn([], NOW);
    expect(empty.total).toBe(0);
    expect(empty.groups).toEqual([]);
  });
});
