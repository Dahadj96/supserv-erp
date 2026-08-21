/**
 * Screen 75 — which name goes on the offer.
 *
 * "Whatever prints here is what the client accepts. If you promise the client's
 * wording and deliver what the supplier calls something else, a dispute has no
 * clear answer. Decide it once, on purpose."
 *
 * This file is the deciding. The screen that draws it is the offer builder and
 * arrives with phase 4 — but the rule, the verdict and the alias memory are
 * `item` and `item_alias` work, which is phase 1, and none of it needs a deal
 * to exist in order to be right.
 *
 * LAW: all three wordings are kept. The client's verbatim, the supplier's
 * verbatim, and what actually printed. Six months later a dispute about what
 * was supplied has an answer instead of a memory.
 */

/** The default rule, set per offer and overridable line by line. */
export const DESIGNATION_RULES = ["client", "supplier", "combined", "ours"] as const;
export type DesignationRule = (typeof DESIGNATION_RULES)[number];

/** The recommended default: the client's wording, the supplier's reference added. */
export const DEFAULT_DESIGNATION_RULE: DesignationRule = "combined";

/**
 * What the line is telling you at a glance.
 *
 * `same` — the two wordings agree, nothing to decide.
 * `ruleApplied` — they differ, and the rule resolved it cleanly.
 * `differs` — they differ in a way a person should look at.
 * `ours` — there is no supplier wording, because there is no supplier.
 */
export type DesignationVerdict = "same" | "ruleApplied" | "differs" | "ours";

export type DesignationLine = {
  /** Verbatim, never edited. What the client wrote in the RFQ. */
  clientWording: string;
  /** Verbatim, per quote. Null when SUPSERV supplies it — labour, for instance. */
  supplierWording: string | null;
  /** The supplier's article reference, when one was matched. */
  supplierReference?: string | null;
  /** What somebody here typed instead, when the rule is `ours`. */
  ourWording?: string | null;
  rule?: DesignationRule;
};

export type Designation = {
  prints: string;
  verdict: DesignationVerdict;
  rule: DesignationRule;
};

/**
 * Accents, case, punctuation and runs of spaces are noise. "Câble HP 2x1,5 mm²"
 * and "CABLE HP 2×1,5 mm2" are the same thing written by two people, and a
 * screen that flags them as differing teaches people to ignore the flag.
 */
export function normaliseWording(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[.,;:()[\]{}'"`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameWording(a: string, b: string): boolean {
  return normaliseWording(a) === normaliseWording(b);
}

/**
 * Resolve one line.
 *
 * The verdict is computed from the two wordings, not from the rule — a rule
 * cannot make two different things the same, it only decides which one prints.
 */
export function resolveDesignation(line: DesignationLine): Designation {
  const rule = line.rule ?? DEFAULT_DESIGNATION_RULE;
  const client = line.clientWording.trim();
  const supplier = line.supplierWording?.trim() || null;

  const ours = line.ourWording?.trim() || null;

  // No supplier wording means SUPSERV is supplying it. Installation, mise en
  // service, main-d'œuvre. There is nothing to reconcile.
  if (!supplier) return { prints: ours ?? client, verdict: "ours", rule };

  const identical = sameWording(client, supplier);

  const prints =
    rule === "supplier"
      ? supplier
      : rule === "client"
        ? client
        : rule === "ours"
          ? (ours ?? client)
          : combine(client, line.supplierReference ?? supplier, identical);

  if (identical) return { prints, verdict: "same", rule };

  // "Differs — check" is reserved for lines where the difference survives the
  // rule. If the rule prints both wordings, the person has already been told
  // what the supplier calls it, so there is nothing left to check.
  const verdict: DesignationVerdict = rule === "combined" ? "ruleApplied" : "differs";
  return { prints, verdict, rule };
}

/** "Amplificateur 120W 4 zones (Bluetooth inclus)" — longest, and the safest. */
function combine(client: string, supplierPart: string, identical: boolean): string {
  if (identical) return client;
  const trimmed = supplierPart.trim();
  if (!trimmed || sameWording(client, trimmed)) return client;
  return `${client} (${trimmed})`;
}

/** How many lines on an offer a person actually has to look at. */
export function countDiffering(lines: DesignationLine[]): number {
  return lines.filter((line) => resolveDesignation(line).verdict === "differs").length;
}
