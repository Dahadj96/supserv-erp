import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { blockingRule } from "@/db/schema/interface";

/**
 * Screen 69 — the compliance profile.
 *
 * "The software enforces these rules. It does not assert that they are the law.
 * Each one names its source and the person who confirmed it — and until someone
 * does, it is marked unconfirmed and enforced as a warning only."
 *
 * That paragraph is the reason this file exists, and the reason every legal
 * string elsewhere in the system was rewritten. A screen that says "article 42
 * CTCA requires this" is the software making a legal claim on its own
 * authority; if the article is renumbered in a finance act, the software is
 * confidently wrong somewhere nobody thinks to look. The behaviour is the same
 * either way — the invoice is still refused without a NIF — but the reason is
 * attributed, dated, and reviewable.
 */

export type Enforcement = "blocks" | "warns" | "always";

/** A rule somebody can confirm, and whose confirmation changes what happens. */
export type ProfileRule = {
  code: string;
  messageKey: string;
  appliesTo: string;
  authority: string | null;
  confirmedBy: string | null;
  confirmedOn: string | null;
  fixRoute: string | null;
  enforcement: Enforcement;
  /** True when the confirmation came from the text of the rule itself. */
  selfEvident: boolean;
};

/**
 * Guarantees that hold because of how the system is BUILT, not because anybody
 * confirmed them. They are listed on the same screen because a reader asking
 * "what does this software enforce" deserves the whole answer — but they are
 * not confirmable, and pretending they were would invite somebody to switch one
 * off in a place where the switch does not exist.
 */
export const STRUCTURAL = [
  { key: "chronological", where: "src/documents/numbering.ts" },
  { key: "neverReuse", where: "src/documents/numbering.ts" },
  { key: "neverEditIssued", where: "src/documents/engine.ts" },
  { key: "oneRenderer", where: "src/documents/pdf.ts" },
  { key: "numberOnIssue", where: "src/documents/engine.ts" },
  { key: "amountInWords", where: "src/documents/amount-in-words.ts" },
] as const;

/** A decree confirms itself; a person confirms everything else. */
function isSelfEvident(rule: { confirmedBy: string | null; authority: string | null }): boolean {
  return Boolean(rule.confirmedBy && rule.authority && rule.confirmedBy === rule.authority);
}

export async function profile(): Promise<ProfileRule[]> {
  const rules = await db.select().from(blockingRule).orderBy(blockingRule.code);

  return rules.map((rule) => ({
    code: rule.code,
    messageKey: rule.messageKey,
    appliesTo: rule.appliesTo,
    authority: rule.authority,
    confirmedBy: rule.confirmedBy,
    confirmedOn: rule.confirmedOn,
    fixRoute: rule.fixRoute,
    enforcement: rule.confirmedOn ? "blocks" : "warns",
    selfEvident: isSelfEvident(rule),
  }));
}

export type ProfileCounts = {
  total: number;
  confirmed: number;
  unconfirmed: number;
  blocks: number;
  warns: number;
  structural: number;
};

export function countProfile(rules: ProfileRule[]): ProfileCounts {
  const confirmed = rules.filter((r) => r.confirmedOn).length;
  return {
    total: rules.length,
    confirmed,
    unconfirmed: rules.length - confirmed,
    blocks: rules.filter((r) => r.enforcement === "blocks").length,
    warns: rules.filter((r) => r.enforcement === "warns").length,
    structural: STRUCTURAL.length,
  };
}

export class ConfirmRefused extends Error {
  constructor(readonly reason: "noSuchRule" | "noName" | "selfEvident") {
    super(reason);
  }
}

/**
 * A person, with a name and a date, turns a warning into a refusal.
 *
 * `who` is free text on purpose. The person who settles whether the droit de
 * timbre applies is an accountant outside the company, and forcing that name
 * through the user table would either exclude him or create a login for
 * somebody who will never sign in. What matters is that the row says who, and
 * that the audit entry says which of OUR people wrote it down.
 */
export async function confirm(
  code: string,
  who: string,
  on: string,
  actorId: string,
): Promise<void> {
  const name = who.trim();
  if (!name) throw new ConfirmRefused("noName");

  const [rule] = await db.select().from(blockingRule).where(eq(blockingRule.code, code)).limit(1);
  if (!rule) throw new ConfirmRefused("noSuchRule");
  if (isSelfEvident(rule)) throw new ConfirmRefused("selfEvident");

  await db
    .update(blockingRule)
    .set({ confirmedBy: name, confirmedOn: on })
    .where(eq(blockingRule.code, code));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "blocking_rule",
    entityId: code,
    action: "confirm",
    before: { confirmedBy: rule.confirmedBy, confirmedOn: rule.confirmedOn },
    after: { confirmedBy: name, confirmedOn: on },
    sourceScreen: "69",
  });
}

/**
 * Take a confirmation back.
 *
 * Reversible on purpose: a confirmation is somebody's judgement, and judgements
 * are revised — a finance act changes a threshold, or the accountant was asked
 * the wrong question. What is NOT reversed is any document already issued under
 * the rule. LAW 5 covers that, and it is why un-confirming is safe: it changes
 * what happens next, never what already happened.
 */
export async function unconfirm(code: string, actorId: string, reason: string): Promise<void> {
  const [rule] = await db.select().from(blockingRule).where(eq(blockingRule.code, code)).limit(1);
  if (!rule) throw new ConfirmRefused("noSuchRule");
  if (isSelfEvident(rule)) throw new ConfirmRefused("selfEvident");

  await db
    .update(blockingRule)
    .set({ confirmedBy: null, confirmedOn: null })
    .where(eq(blockingRule.code, code));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "blocking_rule",
    entityId: code,
    action: "unconfirm",
    before: { confirmedBy: rule.confirmedBy, confirmedOn: rule.confirmedOn },
    after: { confirmedBy: null, confirmedOn: null },
    reason: reason.trim() || null,
    sourceScreen: "69",
  });
}
