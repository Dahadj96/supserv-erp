import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listProposals, ProposalRefused, propose } from "@/assistant/proposals";
import { db } from "@/db";
import { assistantProposal } from "@/db/schema/assistant";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { relance } from "@/db/schema/money";
import { party, partyRole } from "@/db/schema/party";
import { ApplyRefused, decideProposal } from "@/domain/assistant/apply";

/**
 * PLAN §7, second half: "cannot change anything without a human pressing
 * approve".
 *
 * The test that matters is the third one. Making a proposal must leave the
 * business exactly as it was — no relance, no payment, nothing — and only the
 * approval may create anything.
 */
const ACTOR = "test-proposal-actor";
const CLIENT = "TEST-PR-CLIENT";

let clientId: string;
let invoiceId: string;
const proposalIds: string[] = [];

beforeAll(async () => {
  await db.delete(party).where(eq(party.code, CLIENT));

  const [made] = await db
    .insert(party)
    .values({ code: CLIENT, legalName: "SADEG TEST PR", docLocale: "fr" })
    .returning({ id: party.id });
  clientId = made?.id as string;
  await db.insert(partyRole).values({ partyId: clientId, role: "client" });

  const [invoice] = await db
    .insert(document)
    .values({
      kind: "invoice",
      partyId: clientId,
      locale: "fr",
      status: "issued",
      number: "TEST/PR/0001",
      currency: "DZD",
      totals: { totalExcl: "100000.00", totalIncl: "119000.00" },
      dueOn: "2026-01-01",
      issuedOn: "2025-12-01",
    })
    .returning({ id: document.id });
  invoiceId = invoice?.id as string;
});

afterAll(async () => {
  if (proposalIds.length) {
    await db.delete(assistantProposal).where(inArray(assistantProposal.id, proposalIds));
  }
  await db.delete(relance).where(eq(relance.documentId, invoiceId));
  await db.delete(document).where(eq(document.id, invoiceId));
  await db.delete(auditEntry).where(eq(auditEntry.actorId, ACTOR));
  await db.delete(partyRole).where(eq(partyRole.partyId, clientId));
  await db.delete(party).where(eq(party.id, clientId));
});

async function make(over: Partial<Parameters<typeof propose>[0]> = {}) {
  const created = await propose({
    tool: "draftRelance",
    role: "gerant",
    requestedBy: ACTOR,
    entity: "document",
    entityId: invoiceId,
    title: "SADEG TEST PR — TEST/PR/0001 · 60 d",
    body: "Madame, Monsieur,\n\nSauf erreur de notre part…",
    citations: [{ label: "TEST/PR/0001", href: "/payments/ageing" }],
    ...over,
  });
  proposalIds.push(created.id);
  return created;
}

describe("a proposal changes nothing", () => {
  it("creates no relance", async () => {
    const before = await db.select().from(relance).where(eq(relance.documentId, invoiceId));
    await make();
    const after = await db.select().from(relance).where(eq(relance.documentId, invoiceId));

    expect(after.length).toBe(before.length);
  });

  it("leaves the invoice untouched", async () => {
    const [before] = await db.select().from(document).where(eq(document.id, invoiceId));
    await make();
    const [after] = await db.select().from(document).where(eq(document.id, invoiceId));

    expect(after).toEqual(before);
  });

  it("records itself as the assistant, not as a person", async () => {
    // Screen 32's `assistant` filter chip exists because of this row, and it is
    // the only place in the system that writes `actorKind: "assistant"`.
    const created = await make();
    const [entry] = await db.select().from(auditEntry).where(eq(auditEntry.entityId, created.id));

    expect(entry?.actorKind).toBe("assistant");
    expect(entry?.action).toBe("create");
  });
});

describe("a proposal has to be checkable", () => {
  it("refuses one with no citations", async () => {
    // Not a weak proposal — not a proposal. A person who cannot check it will
    // either rubber-stamp it or ignore it, and both are worse than silence.
    await expect(make({ citations: [] })).rejects.toBeInstanceOf(ProposalRefused);
  });

  it("refuses an empty body", async () => {
    await expect(make({ body: "   " })).rejects.toBeInstanceOf(ProposalRefused);
  });

  it("refuses a caller who does not hold the permission", async () => {
    // `draftRelance` needs `invoices.issue`. A Commercial does not have it.
    await expect(make({ role: "commercial" })).rejects.toBeInstanceOf(ProposalRefused);
  });
});

describe("approving is the only thing that creates", () => {
  it("creates a relance, in draft, unsent", async () => {
    const created = await make();

    const result = await decideProposal({
      proposalId: created.id,
      approve: true,
      role: "gerant",
      actorId: ACTOR,
    });

    expect(result.appliedEntity).toBe("relance");

    const [made] = await db
      .select()
      .from(relance)
      .where(eq(relance.id, result.appliedEntityId as string));

    // The whole point. Approving records the intention; sending is still a
    // person, in Outlook, because the ERP holds Mail.Read and nothing more.
    expect(made?.status).toBe("draft");
    expect(made?.sentAt).toBeNull();
  });

  it("creates nothing when declined", async () => {
    const created = await make();
    const before = await db.select().from(relance).where(eq(relance.documentId, invoiceId));

    const result = await decideProposal({
      proposalId: created.id,
      approve: false,
      role: "gerant",
      actorId: ACTOR,
    });

    expect(result.appliedEntity).toBeNull();
    const after = await db.select().from(relance).where(eq(relance.documentId, invoiceId));
    expect(after.length).toBe(before.length);
  });

  it("keeps a declined proposal rather than deleting it", async () => {
    // "The assistant suggested chasing them on the 3rd and I said no" is worth
    // having in November.
    const all = await listProposals("declined");
    expect(all.length).toBeGreaterThan(0);
  });

  it("refuses a second decision on the same proposal", async () => {
    const created = await make();
    await decideProposal({ proposalId: created.id, approve: true, role: "gerant", actorId: ACTOR });

    await expect(
      decideProposal({ proposalId: created.id, approve: false, role: "gerant", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(ApplyRefused);
  });

  it("refuses a decider without the permission", async () => {
    const created = await make();
    await expect(
      decideProposal({ proposalId: created.id, approve: true, role: "commercial", actorId: ACTOR }),
    ).rejects.toBeInstanceOf(ApplyRefused);
  });

  it("records the decision as the PERSON, not the assistant", async () => {
    const created = await make();
    await decideProposal({ proposalId: created.id, approve: true, role: "gerant", actorId: ACTOR });

    const entries = await db.select().from(auditEntry).where(eq(auditEntry.entityId, created.id));

    const decision = entries.find((entry) => entry.action === "update");
    // Six months later the log has to be able to say the assistant proposed and
    // a human decided. One `actorKind` for both would lose exactly that.
    expect(decision?.actorKind).toBe("user");
  });
});
