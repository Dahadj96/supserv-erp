import { and, desc, eq } from "drizzle-orm";
import type { Role } from "@/auth/can";
import { db } from "@/db";
import { assistantProposal } from "@/db/schema/assistant";
import { auditEntry } from "@/db/schema/control";
import { mayRun } from "./registry";

/**
 * Screen 44 — making a proposal, and nothing else.
 *
 * This module may write to exactly two tables: `assistant_proposal`, which is
 * the proposal itself, and `audit_entry`, which records that it was made. It
 * writes to no business table, and `tests/unit/assistant.test.ts` reads this
 * source to check that.
 *
 * Approving is somebody else's job in every sense: a person presses the button,
 * and `src/domain/assistant/apply.ts` — deliberately outside this folder — is
 * what turns an approved proposal into a record.
 */

export type Citation = { label: string; href: string };

export type Proposal = {
  id: string;
  tool: string;
  requestedBy: string;
  requestedAt: Date;
  entity: string;
  entityId: string | null;
  title: string;
  body: string;
  citations: Citation[];
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  appliedEntity: string | null;
  appliedEntityId: string | null;
};

export class ProposalRefused extends Error {
  constructor(readonly reason: "notPermitted" | "noCitations" | "emptyBody") {
    super(reason);
  }
}

function shape(row: typeof assistantProposal.$inferSelect): Proposal {
  return { ...row, citations: (row.citations ?? []) as Citation[] };
}

/**
 * Write down a proposal.
 *
 * Two refusals worth having:
 *
 * `noCitations` — a proposal whose claims cannot be checked is one a person
 * will either rubber-stamp or ignore, and both are worse than not proposing.
 * So a proposal with no citation is not a weak proposal, it is not a proposal.
 *
 * `notPermitted` — the caller's role is checked against the registry, not the
 * assistant's, because the assistant has no permissions of its own.
 */
export async function propose(opts: {
  tool: string;
  role: Role | null;
  requestedBy: string;
  entity: string;
  entityId: string | null;
  title: string;
  body: string;
  citations: Citation[];
}): Promise<Proposal> {
  if (!mayRun(opts.role, opts.tool)) throw new ProposalRefused("notPermitted");
  if (!opts.body.trim()) throw new ProposalRefused("emptyBody");
  if (opts.citations.length === 0) throw new ProposalRefused("noCitations");

  const [row] = await db
    .insert(assistantProposal)
    .values({
      tool: opts.tool,
      requestedBy: opts.requestedBy,
      entity: opts.entity,
      entityId: opts.entityId,
      title: opts.title,
      body: opts.body,
      citations: opts.citations,
    })
    .returning();

  await db.insert(auditEntry).values({
    actorId: opts.requestedBy,
    // The one place in the system that writes this, and the reason the column
    // exists. Screen 32's filter chip for `assistant` appears the moment this
    // runs for the first time.
    actorKind: "assistant",
    entity: "assistant_proposal",
    entityId: row?.id ?? null,
    action: "create",
    after: { tool: opts.tool, about: `${opts.entity}:${opts.entityId ?? ""}` },
    sourceScreen: "44",
  });

  return shape(row as typeof assistantProposal.$inferSelect);
}

export async function listProposals(status?: string): Promise<Proposal[]> {
  const rows = await db
    .select()
    .from(assistantProposal)
    .where(status ? eq(assistantProposal.status, status) : undefined)
    .orderBy(desc(assistantProposal.requestedAt))
    .limit(200);

  return rows.map(shape);
}

export async function proposalById(id: string): Promise<Proposal | null> {
  const [row] = await db
    .select()
    .from(assistantProposal)
    .where(eq(assistantProposal.id, id))
    .limit(1);
  return row ? shape(row) : null;
}

export async function waitingCount(): Promise<number> {
  const rows = await db
    .select({ id: assistantProposal.id })
    .from(assistantProposal)
    .where(and(eq(assistantProposal.status, "waiting")));
  return rows.length;
}
