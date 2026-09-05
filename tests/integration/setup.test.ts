import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { bankAccount, COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { numberingSeries } from "@/db/schema/document";
import {
  addBankAccount,
  addSeries,
  addVatRate,
  identityInput,
  previewNumber,
  rateOn,
  SERIES_KINDS,
  saveIdentity,
  suggestedPattern,
} from "@/domain/company";
import { assertCanIssue, CannotIssueYet, identityComplete, setupState } from "@/domain/setup";

/**
 * Screen 85 — Day one.
 *
 * "Until the first four rows are done, no invoice can be issued at all." That
 * sentence is the whole test. Everything else on this screen is a form; this is
 * the thing that has to hold when somebody is in a hurry on a Thursday.
 */
const ACTOR = "test-setup-actor";
/**
 * Real kinds, because a series can no longer be created for an invented one.
 *
 * These two are in the catalogue, take a number of ours, and are not used by
 * any other test — `attestation` and `cover_letter`. The test used to say
 * `test_invoice` and `test_offer`, which is precisely what stopped anybody
 * noticing that the day-one screen offered `offer`, a kind this ERP does not
 * have.
 */
const KINDS = ["attestation", "cover_letter"];

const GOOD = {
  legalName: "SARL SUPSERV (TEST)",
  tradeName: "",
  legalForm: "SARL",
  capital: "",
  rc: "01/00-1234567 B 15",
  nif: "000116001234567",
  nis: "000116001234567001",
  ai: "16050123456",
  address: "Zone industrielle, Adrar",
  wilaya: "Adrar",
  phone: "",
  email: "",
  website: "",
};

/**
 * The whole row, not a boolean.
 *
 * One of the tests below sets `ai` to null to prove the day-one gate notices a
 * missing article d'imposition. With only a boolean recorded, teardown put
 * nothing back — so on a database where the company details existed, this test
 * blanked a field that goes on every invoice and left it blank.
 *
 * The suite runs against `<database>_test` now and cannot reach the real row,
 * but the snapshot is the actual fix: a test may borrow state, and then it has
 * to give it back.
 */
let previousIdentity: typeof companyIdentity.$inferSelect | undefined;

beforeAll(async () => {
  [previousIdentity] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID));
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(numberingSeries).where(inArray(numberingSeries.kind, KINDS));
  await db.delete(vatRate).where(like(vatRate.authority, "TEST %"));
  await db.delete(bankAccount).where(like(bankAccount.bankName, "TEST %"));

  if (previousIdentity) {
    await db
      .update(companyIdentity)
      .set(previousIdentity)
      .where(eq(companyIdentity.id, COMPANY_ID));
  } else {
    await db.delete(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID));
  }
});

describe("screen 85 — until the first four are done, nothing can be issued", () => {
  it("counts three of the four legal identifiers as incomplete, not as nearly done", () => {
    // décret 05-468 requires all four. "Mostly compliant" is not a state that
    // exists at the tax office.
    expect(
      identityComplete({
        ...GOOD,
        id: COMPANY_ID,
        ai: null,
        capital: null,
        logoPath: null,
        tradeName: null,
        legalForm: null,
        wilaya: null,
        phone: null,
        email: null,
        website: null,
        updatedAt: new Date(),
        updatedBy: null,
      }),
    ).toBe(false);
  });

  it("refuses a NIF that is not fifteen digits", () => {
    expect(() => identityInput.parse({ ...GOOD, nif: "0001160012" })).toThrow(/nifFifteenDigits/);
  });

  it("refuses to let anything be issued while a blocking step is open", async () => {
    const before = await setupState();
    if (!before.canIssue) {
      await expect(assertCanIssue()).rejects.toBeInstanceOf(CannotIssueYet);
      // And it names which ones, so the message can say why rather than "no".
      const error = await assertCanIssue().then(
        () => null,
        (e: unknown) => e as CannotIssueYet,
      );
      expect(error?.missing.length).toBeGreaterThan(0);
    }
  });

  it("saves the identity and reopens nothing that was already done", async () => {
    await saveIdentity(GOOD, ACTOR);
    const state = await setupState();
    const identity = state.steps.find((s) => s.key === "identity");
    expect(identity?.done).toBe(true);
    expect(identity?.blocking).toBe(true);
  });

  it("computes the checklist rather than storing it", async () => {
    await saveIdentity({ ...GOOD, ai: "" } as never, ACTOR).catch(() => {
      /* rejected by the schema, which is the point */
    });

    // Break it at the database level, the way a bad migration or a person with
    // psql would. A stored "step 1 complete" flag would survive this.
    await db.update(companyIdentity).set({ ai: null }).where(eq(companyIdentity.id, COMPANY_ID));
    const broken = await setupState();
    expect(broken.steps.find((s) => s.key === "identity")?.done).toBe(false);
    expect(broken.canIssue).toBe(false);

    await saveIdentity(GOOD, ACTOR);
    const fixed = await setupState();
    expect(fixed.steps.find((s) => s.key === "identity")?.done).toBe(true);
  });

  it("closes the previous rate instead of editing it", async () => {
    await addVatRate(
      { rate: "17", kind: "normal", startsOn: "2015-01-01", authority: "TEST loi 2015" },
      ACTOR,
    );
    await addVatRate(
      { rate: "19", kind: "normal", startsOn: "2017-01-01", authority: "TEST loi 2017" },
      ACTOR,
    );

    // An invoice issued in 2016 must still recompute at 17%. That is only true
    // because the old row kept its dates.
    expect(await rateOn("normal", "2016-06-01")).toBe(17);
    expect(await rateOn("normal", "2026-06-01")).toBe(19);
    // And before either rate existed, there is no rate — not a guess.
    expect(await rateOn("normal", "2014-01-01")).toBeNull();
  });

  it("refuses a numbering pattern with no year or no counter", async () => {
    await expect(
      addSeries({ kind: "attestation", pattern: "SUP/0001", reset: "yearly" }, ACTOR),
    ).rejects.toThrow(/patternNeedsYear/);

    await expect(
      addSeries({ kind: "attestation", pattern: "SUP/{YYYY}", reset: "yearly" }, ACTOR),
    ).rejects.toThrow(/patternNeedsCounter/);
  });

  it("refuses a kind the catalogue does not have", async () => {
    // "offer" is the one that mattered: it was on the day-one screen for weeks,
    // and this ERP calls a devis `quotation`. A series for it would have
    // allocated numbers nothing ever printed.
    await expect(
      addSeries({ kind: "offer", pattern: "OFF/{YYYY}/{####}", reset: "yearly" }, ACTOR),
    ).rejects.toThrow(/kindUnknown/);
  });

  it("refuses a kind that carries the counterparty's number", async () => {
    // An avenant is drawn by the wilaya and arrives with the wilaya's number on
    // it. LAW 5 does not allocate against somebody else's paper.
    await expect(
      addSeries({ kind: "amendment", pattern: "AV/{YYYY}/{####}", reset: "yearly" }, ACTOR),
    ).rejects.toThrow(/kindIsTheirs/);
  });

  it("offers the two a marché needs, and never the ones that are theirs", () => {
    // The day-one screen is driven by this list. `final_account` (the décompte
    // that closes a marché) and `retention_release` (asking for the retenue de
    // garantie back) were missing from the five names typed into the screen, so
    // a company doing marchés publics met the refusal on the day it needed the
    // document.
    expect(SERIES_KINDS).toContain("final_account");
    expect(SERIES_KINDS).toContain("retention_release");
    expect(SERIES_KINDS).not.toContain("client_order");
    expect(SERIES_KINDS).not.toContain("amendment");
    expect(SERIES_KINDS).not.toContain("supplier_invoice");
    expect(suggestedPattern("final_account")).toMatch(/\{#+\}/);
    expect(suggestedPattern("amendment"), "theirs, so nothing to suggest").toBeNull();
  });

  it("refuses a second series for a kind that already has one", async () => {
    // Two rows for one kind is two shapes of number in one year, and the
    // allocator would take whichever the database handed back first. The test
    // database had thirty-five rows for `final_account` when this was written,
    // put there by an `onConflictDoNothing()` with nothing to conflict on.
    await addSeries({ kind: "cover_letter", pattern: "LT/{YYYY}/{###}", reset: "yearly" }, ACTOR);

    await expect(
      addSeries({ kind: "cover_letter", pattern: "LTR-{YYYY}-{###}", reset: "yearly" }, ACTOR),
    ).rejects.toThrow(/kindTaken/);

    const rows = await db
      .select()
      .from(numberingSeries)
      .where(eq(numberingSeries.kind, "cover_letter"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pattern, "the first one stands").toBe("LT/{YYYY}/{###}");
  });

  it("shows the next number before anything is allocated", () => {
    expect(previewNumber("SUP/{YYYY}/{####}", 1, 2026)).toBe("SUP/2026/0001");
    expect(previewNumber("FA-{YYYY}-{###}", 42, 2026)).toBe("FA-2026-042");
    expect(previewNumber("{YY}/{#####}", 7, 2026)).toBe("26/00007");
  });

  it("makes the first bank account the default without asking", async () => {
    const before = await db.select().from(bankAccount);
    const id = await addBankAccount(
      { bankName: "TEST BEA", agency: "Adrar", rib: "00300123456789012345", currency: "DZD" },
      ACTOR,
    );
    const [created] = await db.select().from(bankAccount).where(eq(bankAccount.id, id));
    expect(created?.isDefault).toBe(before.length === 0);
    expect(created?.rib, "spaces stripped, twenty digits kept").toBe("00300123456789012345");
  });

  it("refuses a RIB that is not twenty digits", async () => {
    await expect(
      addBankAccount({ bankName: "TEST BNA", rib: "123", currency: "DZD" }, ACTOR),
    ).rejects.toThrow(/ribTwentyDigits/);
  });

  it("never writes the full RIB into the audit trail", async () => {
    const entries = await db.select().from(auditEntry).where(eq(auditEntry.entity, "bank_account"));
    const mine = entries.filter((e) => e.actorId === ACTOR);
    for (const entry of mine) {
      expect(JSON.stringify(entry.after)).not.toContain("00300123456789012345");
    }
  });
});
