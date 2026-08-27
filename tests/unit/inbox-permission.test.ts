import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { can, ROLES } from "@/auth/can";

/**
 * Who may read the company's mail.
 *
 * This is a test because for a while the answer was "everybody with a login".
 * `listInbox()` takes no user, and `src/auth/can.ts` did not mention the inbox
 * at all — so `lecture`, a role whose entire purpose is to look and not touch,
 * could read every message ever sent to contact@. Nothing was hidden and
 * nothing was wrong on screen; the permission simply did not exist.
 *
 * It mattered the moment real mail arrived: 39 messages, of which 31 were
 * unclassified correspondence. It matters much more when recrutement@ (CVs,
 * salary expectations) and commercial@ (prices, margins) are connected, which
 * is the plan.
 */
describe("inbox.view", () => {
  it("is held by the roles whose work arrives by email", () => {
    expect(can("gerant", "inbox.view")).toBe(true);
    expect(can("commercial", "inbox.view")).toBe(true);
    expect(can("achats", "inbox.view")).toBe(true);
    expect(can("compta", "inbox.view")).toBe(true);
  });

  it("is NOT held by site staff or by read-only", () => {
    // `lecture` is read-only over RECORDS. A mailbox is not a record - it is
    // everything anybody has ever sent the company, sorted by nobody.
    expect(can("lecture", "inbox.view")).toBe(false);
    expect(can("chantier", "inbox.view")).toBe(false);
  });

  it("is not accidentally granted by a future role", () => {
    // Any role added later starts without it, deliberately. Whoever adds one
    // has to come here and say so - which is the point of the test.
    const holders = Object.entries(ROLES)
      .filter(([, permissions]) => (permissions as readonly string[]).includes("inbox.view"))
      .map(([role]) => role)
      .sort();

    expect(holders).toEqual(["achats", "commercial", "compta", "gerant"]);
  });
});

/**
 * A server action is a public HTTP endpoint. Gating the page without gating the
 * action leaves the buttons hidden and the endpoint they posted to answering.
 */
describe("the inbox server actions check it too", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "..", "src/app/[locale]/(app)/inbox/actions.ts"),
    "utf8",
  );

  it("has a guard that checks the permission, not just the session", () => {
    expect(source).toContain('can(session.role, "inbox.view")');
  });

  it("routes every exported action through that guard", () => {
    const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.length).toBeGreaterThan(0);

    // Split on the export keyword so each function's body is checked alone; an
    // action that forgot the guard cannot borrow its neighbour's.
    const bodies = source.split(/export async function /).slice(1);
    const missing = bodies
      .filter((body) => !body.includes("requireInbox(locale)"))
      .map((body) => body.slice(0, body.indexOf("(")));

    expect(missing, "these actions do not check inbox.view").toEqual([]);
  });
});
