import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyIdentity } from "@/db/schema/company";
import { document } from "@/db/schema/document";
import { blockingRule } from "@/db/schema/interface";
import { party, partyRole } from "@/db/schema/party";
import { check, type Finding } from "@/documents/compliance";
import { type ProfileRule, profile, STRUCTURAL } from "@/domain/compliance-profile";
import { liveParty } from "@/domain/deletion";
import { type SetupState, setupState } from "@/domain/setup";

/**
 * Screen 27 — Compliance.
 *
 * Screen 69 is the PROFILE: which rules exist, who confirmed each, and what
 * authority it names. This is the operational half — what those rules are
 * doing to the company right now.
 *
 * The two questions it answers are different, and the second one is the reason
 * the screen is worth opening:
 *
 *   What would be refused today?     Drafts with a failing CONFIRMED rule.
 *   What would NOT be refused, and
 *   probably should be?              Drafts failing a rule nobody has confirmed.
 *
 * The second is invisible everywhere else in the system, on purpose: an
 * unconfirmed rule warns and lets you proceed, because the software must not
 * assert a law on its own authority. The cost of that decision is a quiet
 * exposure, and this is where it stops being quiet.
 */

export type DraftFinding = {
  documentId: string;
  kind: string;
  counterparty: string | null;
  total: string;
  /** Only the ones that failed. A pass is not news on this screen. */
  failing: Finding[];
  worst: "block" | "warn";
};

export type NifGap = {
  id: string;
  code: string;
  legalName: string;
  /** Documents already issued to them. Non-zero means it has already happened. */
  issued: number;
};

export type ComplianceStatus = {
  setup: SetupState;
  rules: ProfileRule[];
  structural: typeof STRUCTURAL;
  /** Confirmed and therefore refusing; unconfirmed and therefore only warning. */
  confirmedCount: number;
  unconfirmedCount: number;
  drafts: DraftFinding[];
  blockedCount: number;
  warnedCount: number;
  clientsWithoutNif: NifGap[];
  draftsChecked: number;
};

export async function complianceStatus(): Promise<ComplianceStatus> {
  const [setup, rules, ruleRows, [company]] = await Promise.all([
    setupState(),
    profile(),
    db.select().from(blockingRule),
    db.select().from(companyIdentity).limit(1),
  ]);

  /**
   * Every unissued document, with the party it is for.
   *
   * `status = 'draft'` rather than `number is null`: after screen 64 the state
   * is what says whether a document has been issued, and a kind numbered by
   * client reference has no number either way.
   */
  const drafts = await db
    .select({
      id: document.id,
      kind: document.kind,
      totals: document.totals,
      partyId: document.partyId,
      settlement: document.settlement,
    })
    .from(document)
    .where(eq(document.status, "draft"))
    .orderBy(desc(document.createdAt))
    .limit(200);

  const partyIds = [...new Set(drafts.map((d) => d.partyId).filter(Boolean))] as string[];
  const parties =
    partyIds.length > 0 ? await db.select().from(party).where(inArray(party.id, partyIds)) : [];
  const byId = new Map(parties.map((p) => [p.id, p]));

  const found: DraftFinding[] = [];
  for (const draft of drafts) {
    const counterparty = draft.partyId ? (byId.get(draft.partyId) ?? null) : null;
    const totals = draft.totals as { totalIncl?: string; stampDuty?: string } | null;
    const total = Number(totals?.totalIncl ?? 0);

    // `ruleRows` is passed in so this loop reads `blocking_rule` once rather
    // than once per draft.
    const findings = await check(
      {
        kind: draft.kind,
        company: company ?? null,
        counterparty,
        total,
        // This used to be `false`, with a note saying the settlement was not a
        // column on `document` and so the stamp-duty rule could not be swept.
        // It is a column now — `settlement`, set on screen 47 — so the sweep
        // reads what the draft says and the rule is evaluated for real.
        settlementInCash: draft.settlement === "especes",
        stampDuty: Number(totals?.stampDuty ?? 0),
      },
      ruleRows,
    );

    const failing = findings.filter((f) => f.severity !== "pass");
    if (failing.length === 0) continue;

    found.push({
      documentId: draft.id,
      kind: draft.kind,
      counterparty: counterparty?.legalName ?? null,
      total: totals?.totalIncl ?? "0",
      failing,
      worst: failing.some((f) => f.severity === "block") ? "block" : "warn",
    });
  }

  /**
   * Clients with no NIF.
   *
   * `invoice.clientNifMissing` is confirmed by décret 05-468 itself, so this is
   * not a maybe — every one of these is an invoice that will be refused at the
   * moment somebody tries to issue it, which is the worst moment to find out.
   * `issued` counts what already went out, because a non-zero number there is a
   * different and more urgent conversation.
   */
  const clientsWithoutNif = await db
    .select({
      id: party.id,
      code: party.code,
      legalName: party.legalName,
      issued: sql<number>`(
        select count(*)::int from ${document}
        where ${document.partyId} = ${party.id} and ${document.number} is not null
      )`,
    })
    .from(party)
    .innerJoin(partyRole, eq(partyRole.partyId, party.id))
    .where(and(eq(partyRole.role, "client"), or(isNull(party.nif), eq(party.nif, "")), liveParty))
    .orderBy(party.legalName)
    .limit(100);

  return {
    setup,
    rules,
    structural: STRUCTURAL,
    confirmedCount: rules.filter((r) => r.enforcement === "blocks").length,
    unconfirmedCount: rules.filter((r) => r.enforcement === "warns").length,
    drafts: found.sort((a, b) => (a.worst === b.worst ? 0 : a.worst === "block" ? -1 : 1)),
    blockedCount: found.filter((f) => f.worst === "block").length,
    warnedCount: found.filter((f) => f.worst === "warn").length,
    clientsWithoutNif,
    draftsChecked: drafts.length,
  };
}
