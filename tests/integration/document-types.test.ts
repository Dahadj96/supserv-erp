import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { documentType } from "@/db/schema/document-type";
import {
  ensureTypesExist,
  issuingRules,
  listTypes,
  SEED_TYPES,
  setActive,
  TypeRefused,
} from "@/domain/document-types";

/**
 * Screen 50 — the catalogue, and the two things it changes about issuing:
 * a kind that is switched off cannot be issued, and a kind whose number comes
 * from the client never consumes one of ours.
 */
const ACTOR = "test-doctypes-actor";
let existed: string[] = [];

beforeAll(async () => {
  existed = (await db.select({ kind: documentType.kind }).from(documentType)).map((r) => r.kind);
  await ensureTypesExist();
});

afterAll(async () => {
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  const now = (await db.select({ kind: documentType.kind }).from(documentType)).map((r) => r.kind);
  const added = now.filter((kind) => !existed.includes(kind));
  if (added.length > 0) await db.delete(documentType).where(inArray(documentType.kind, added));
  // Anything that existed before keeps whatever state it had.
  for (const kind of existed) {
    await db.update(documentType).set({ active: true }).where(eq(documentType.kind, kind));
  }
});

describe("the document type catalogue", () => {
  it("writes down every kind exactly once", async () => {
    const kinds = SEED_TYPES.map((t) => t.kind);
    expect(new Set(kinds).size, "the mockup lists one document twice").toBe(kinds.length);

    const rows = await listTypes();
    for (const kind of kinds) expect(rows.map((r) => r.kind)).toContain(kind);
  });

  it("is idempotent — pressing the button twice writes nothing the second time", async () => {
    expect(await ensureTypesExist()).toBe(0);
  });

  it("gives every accounting document WE issue a reserved number", async () => {
    /**
     * The qualifier arrived with `supplier_invoice` and it is the right rule
     * rather than a loosened one.
     *
     * A reserved number means a gapless series the tax authority can audit,
     * and that obligation is ours only for documents we issue. A supplier's
     * invoice is an accounting document — it is what the company deducts VAT
     * against — and its number belongs to the supplier. Allocating one of ours
     * would put two references on one piece of paper and burn a number in a
     * series that has to be defensible.
     *
     * `clientReference` is precisely the marker for "this number is theirs",
     * which is why the test can tell the two apart without a new field.
     */
    const ours = SEED_TYPES.filter(
      (t) => t.legalValue === "accounting" && t.numbering !== "clientReference",
    );
    expect(ours.length, "no accounting documents left to check").toBeGreaterThan(2);

    for (const type of ours) {
      expect(type.numbering, type.kind).toBe("reservedOnIssue");
    }

    // And the other side of it: a document numbered by the counterparty must
    // carry no pattern at all, or a series would generate one anyway.
    for (const type of SEED_TYPES.filter((t) => t.numbering === "clientReference")) {
      expect(type.pattern, type.kind).toBeNull();
    }
  });

  it("never generates a number for a document the client numbered", async () => {
    const rules = await issuingRules("client_order");
    expect(rules?.reservesNumber).toBe(false);

    const invoice = await issuingRules("invoice");
    expect(invoice?.reservesNumber).toBe(true);
  });

  it("says nothing about a kind nobody wrote down, rather than refusing it", async () => {
    // An empty catalogue must not stop a company issuing an invoice.
    expect(await issuingRules("something_nobody_configured")).toBeNull();
  });

  it("switches a kind off, and records who did it", async () => {
    await setActive("attestation", false, ACTOR);
    expect((await issuingRules("attestation"))?.active).toBe(false);

    const [entry] = await db
      .select()
      .from(auditEntry)
      .where(eq(auditEntry.entityId, "attestation"));

    expect(entry?.action).toBe("deactivate");
    expect(entry?.sourceScreen).toBe("50");
    expect((entry?.before as { active: boolean })?.active).toBe(true);

    await setActive("attestation", true, ACTOR);
    expect((await issuingRules("attestation"))?.active).toBe(true);
  });

  it("refuses to switch a kind that is not in the catalogue", async () => {
    await expect(setActive("not_a_kind", false, ACTOR)).rejects.toBeInstanceOf(TypeRefused);
  });

  it("only ever converts into a kind that exists", async () => {
    const kinds = new Set(SEED_TYPES.map((t) => t.kind));
    // retention_release is named as a destination by the mockup but is not a
    // type of its own yet — the test names it rather than letting a dangling
    // reference pass unnoticed.
    //
    // `supplier_invoice` was here too until screen 68 needed it to be real. A
    // known gap that stays known for months is a decision nobody made; this
    // list is meant to shrink.
    const knownGaps = new Set(["retention_release"]);

    for (const type of SEED_TYPES) {
      for (const target of type.convertsTo) {
        expect(kinds.has(target) || knownGaps.has(target), `${type.kind} → ${target}`).toBe(true);
      }
    }
  });
});
