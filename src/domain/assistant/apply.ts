import { eq } from "drizzle-orm";
import { stepFor } from "@/assistant/draft-relance";
import { proposalById } from "@/assistant/proposals";
import { can, type Role } from "@/auth/can";
import { db } from "@/db";
import { assistantProposal } from "@/db/schema/assistant";
import { auditEntry } from "@/db/schema/control";
import { assertTransition, IllegalTransition } from "@/domain/control/transitions";
import { daysLate } from "@/domain/money/ageing";
import { draftRelance, owings } from "@/domain/money/store";

/**
 * Screen 44 — what happens when a person presses approve.
 *
 * This file is deliberately NOT under `src/assistant`. That folder may not
 * write to a business table and a test enforces it; this one may, because
 * nothing here runs unless a human pressed a button. The directory boundary IS
 * the enforcement of LAW 6 — "the assistant proposes, never executes" — and
 * putting the applier inside the assistant would quietly erase it.
 *
 * What approving actually does is smaller than it sounds, and deliberately so.
 * Approving a drafted relance creates a `relance` row in **draft**. It does not
 * send anything: the ERP holds Mail.Read and a person sends from Outlook —
 * docs/DECISIONS/2026-08-28-the-erp-does-not-send.md. So the loop is
 *
 *   assistant proposes  →  nothing changes
 *   person approves     →  a record exists, still unsent
 *   person sends        →  screen 20, by hand, as it always was
 *
 * Two gates, not one, and the second is a human in their own mail client.
 */

export class ApplyRefused extends Error {
  constructor(
    readonly reason:
      | "noSuchProposal"
      | "alreadyDecided"
      | "notPermitted"
      | "unknownTool"
      | "missingSubject",
  ) {
    super(reason);
  }
}

/** Which permission it takes to approve each tool's proposal. */
const APPROVAL_PERMISSION = {
  draftRelance: "invoices.issue",
  draftEnquiryReply: "inbox.view",
} as const;

export async function decideProposal(opts: {
  proposalId: string;
  approve: boolean;
  note?: string | null;
  role: Role | null;
  actorId: string;
}): Promise<{ appliedEntity: string | null; appliedEntityId: string | null }> {
  const proposal = await proposalById(opts.proposalId);
  if (!proposal) throw new ApplyRefused("noSuchProposal");

  const needed = APPROVAL_PERMISSION[proposal.tool as keyof typeof APPROVAL_PERMISSION];
  if (!needed) throw new ApplyRefused("unknownTool");
  if (!opts.role || !can(opts.role, needed)) throw new ApplyRefused("notPermitted");

  const next = opts.approve ? "approved" : "declined";
  try {
    assertTransition("assistant_proposal", proposal.status, next);
  } catch (error) {
    if (error instanceof IllegalTransition) throw new ApplyRefused("alreadyDecided");
    throw error;
  }

  let appliedEntity: string | null = null;
  let appliedEntityId: string | null = null;

  if (opts.approve) {
    if (proposal.tool === "draftRelance") {
      if (!proposal.entityId) throw new ApplyRefused("missingSubject");

      /**
       * Which step this is, recomputed from the invoice rather than carried on
       * the proposal.
       *
       * A proposal approved a fortnight after it was written is a LATER
       * reminder than it was then, and the row should say what is true now.
       * Reading it back off the proposal's title with a regex would also work
       * on a good day and produce a first reminder for a ninety-day-old debt on
       * a bad one.
       */
      const invoice = (await owings()).find((o) => o.documentId === proposal.entityId);
      const days = daysLate(invoice?.dueOn ?? null, new Date());

      // `draftRelance` refuses an invoice that was never issued.
      appliedEntityId = await draftRelance({
        documentId: proposal.entityId,
        stepKey: stepFor(days),
        channel: "email",
        actorId: opts.actorId,
      });
      appliedEntity = "relance";
    }
    // `draftEnquiryReply` has nothing to create: the reply is text a person
    // takes into Outlook. Approving it records that they intend to, and that
    // is the whole effect. Deliberately not invented into something bigger.
  }

  await db
    .update(assistantProposal)
    .set({
      status: next,
      decidedBy: opts.actorId,
      decidedAt: new Date(),
      decisionNote: opts.note?.trim() || null,
      appliedEntity,
      appliedEntityId,
    })
    .where(eq(assistantProposal.id, opts.proposalId));

  await db.insert(auditEntry).values({
    actorId: opts.actorId,
    // The PERSON, not the assistant. The assistant proposed; a human decided,
    // and the log has to be able to tell those two apart six months later.
    actorKind: "user",
    entity: "assistant_proposal",
    entityId: opts.proposalId,
    action: "update",
    before: { status: proposal.status },
    after: {
      status: next,
      tool: proposal.tool,
      created: appliedEntity ? `${appliedEntity}:${appliedEntityId}` : null,
      note: opts.note ?? null,
    },
    sourceScreen: "44",
  });

  return { appliedEntity, appliedEntityId };
}
