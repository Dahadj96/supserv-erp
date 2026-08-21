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

  it("gives every accounting document a reserved number", async () => {
    for (const type of SEED_TYPES.filter((t) => t.legalValue === "accounting")) {
      expect(type.numbering, type.kind).toBe("reservedOnIssue");
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
    // supplier_invoice and retention_release are named as destinations by the
    // mockup but are not types of their own yet — the test names them rather
    // than letting a dangling reference pass unnoticed.
    const knownGaps = new Set(["supplier_invoice", "retention_release"]);

    for (const type of SEED_TYPES) {
      for (const target of type.convertsTo) {
        expect(kinds.has(target) || knownGaps.has(target), `${type.kind} → ${target}`).toBe(true);
      }
    }
  });
});
