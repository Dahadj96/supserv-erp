import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { blockingRule } from "@/db/schema/interface";
import { ensureRulesExist } from "@/documents/compliance";
import {
  ConfirmRefused,
  confirm,
  countProfile,
  profile,
  unconfirm,
} from "@/domain/compliance-profile";

/**
 * Screen 69 — the promise the whole design rests on:
 *
 *   "until somebody confirms it, it is marked unconfirmed and enforced as a
 *    warning only."
 *
 * So the test is the transition. A rule warns; a person puts their name to it;
 * the same rule now refuses; the person takes it back; it warns again. And at
 * no point does the system confirm anything on its own behalf.
 */
const ACTOR = "test-compliance-actor";
const STAMP = "invoice.stampDutyThreshold";
const DECREE = "invoice.clientNifMissing";

/** Whatever is configured is put back, byte for byte. */
let before: (typeof blockingRule.$inferSelect)[] = [];

beforeAll(async () => {
  before = await db.select().from(blockingRule);
  await ensureRulesExist();
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  for (const rule of before) {
    await db
      .update(blockingRule)
      .set({ confirmedBy: rule.confirmedBy, confirmedOn: rule.confirmedOn })
      .where(eq(blockingRule.code, rule.code));
  }
  // Rules this test caused to exist, that were not there before it ran.
  const known = before.map((r) => r.code);
  const now = await db.select({ code: blockingRule.code }).from(blockingRule);
  const added = now.map((r) => r.code).filter((code) => !known.includes(code));
  if (added.length > 0) await db.delete(blockingRule).where(inArray(blockingRule.code, added));
});

const find = async (code: string) => (await profile()).find((r) => r.code === code);

describe("the compliance profile", () => {
  it("writes the rules down without confirming any of them on its own behalf", async () => {
    const stamp = await find(STAMP);

    expect(stamp?.confirmedBy, "the system does not sign for the accountant").toBeNull();
    expect(stamp?.confirmedOn).toBeNull();
    expect(stamp?.enforcement).toBe("warns");
  });

  it("treats a decree as confirmed by its own text, and refuses to let a person touch it", async () => {
    const decree = await find(DECREE);

    expect(decree?.enforcement).toBe("blocks");
    expect(decree?.selfEvident, "the decree is its own authority").toBe(true);

    await expect(confirm(DECREE, "M. Kaci", "2026-08-22", ACTOR)).rejects.toMatchObject({
      reason: "selfEvident",
    });
    await expect(unconfirm(DECREE, ACTOR, "because")).rejects.toMatchObject({
      reason: "selfEvident",
    });
  });

  it("turns a warning into a refusal the moment somebody puts a name to it", async () => {
    await confirm(STAMP, "M. Kaci, comptable", "2026-08-22", ACTOR);

    const stamp = await find(STAMP);
    expect(stamp?.enforcement).toBe("blocks");
    expect(stamp?.confirmedBy).toBe("M. Kaci, comptable");
    expect(stamp?.confirmedOn).toBe("2026-08-22");
    expect(stamp?.selfEvident, "a person is not the same as the authority").toBe(false);
  });

  it("records which of our people wrote the confirmation down", async () => {
    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, STAMP))
      .orderBy(auditEntry.id);

    expect(entry?.action).toBe("confirm");
    expect(entry?.actorId, "the accountant did not sign in — one of ours did").toBe(ACTOR);
    expect(entry?.sourceScreen).toBe("69");
    expect((entry?.after as { confirmedBy: string })?.confirmedBy).toBe("M. Kaci, comptable");
  });

  it("refuses a confirmation with no name against it", async () => {
    await expect(
      confirm("proforma.validityPeriod", "   ", "2026-08-22", ACTOR),
    ).rejects.toMatchObject({ reason: "noName" });
    expect((await find("proforma.validityPeriod"))?.enforcement).toBe("warns");
  });

  it("gives the warning back when the confirmation is withdrawn, and says why", async () => {
    await unconfirm(STAMP, ACTOR, "loi de finances 2027 moved the threshold");

    expect((await find(STAMP))?.enforcement).toBe("warns");

    const entries = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, STAMP))
      .orderBy(auditEntry.id);
    const last = entries.at(-1);

    expect(last?.action).toBe("unconfirm");
    expect(last?.reason).toBe("loi de finances 2027 moved the threshold");
    expect((last?.before as { confirmedBy: string })?.confirmedBy).toBe("M. Kaci, comptable");
  });

  it("refuses a rule that is not in the profile at all", async () => {
    await expect(
      confirm("invoice.invented", "Somebody", "2026-08-22", ACTOR),
    ).rejects.toBeInstanceOf(ConfirmRefused);
  });

  it("counts what it holds rather than what the mockup said", async () => {
    const rules = await profile();
    const counts = countProfile(rules);

    expect(counts.total).toBe(rules.length);
    expect(counts.confirmed + counts.unconfirmed).toBe(counts.total);
    expect(counts.blocks).toBe(counts.confirmed);
    expect(counts.warns).toBe(counts.unconfirmed);
  });
});
