import type { Finding } from "./compliance";
import type { RenderedDocument } from "./engine";

/**
 * Screen 18 — "Before issuing".
 *
 * Ten rows, one of them red. The screen exists to say *we looked*, so it lists
 * what passed as loudly as what failed: a checklist showing only failures lets
 * somebody believe the other nine things were never checked.
 *
 * Two kinds of row, and the difference matters more than it looks:
 *
 *   · a RULE row comes from `compliance.check()`. It carries an authority, the
 *     name of whoever confirmed it and the date, and it is the only kind that
 *     can refuse an issue.
 *   · a FACT row is this file reading the rendered document and reporting what
 *     will be printed. It never blocks, and when the value is missing it says
 *     "not recorded" — not "required". Nobody has told us the buyer's NIS is
 *     obligatory, so the checklist does not say so. That is screen 69's job,
 *     and the day somebody confirms such a rule it arrives here as a rule row.
 *
 * The design's row 7 ("TVA rate — confirm 9% does not apply") and row 9
 * ("Situation n°3 approved by client") have no rule and no data behind them
 * yet; they are not faked here. See docs/DECISIONS.
 */

export type RowState = "pass" | "warn" | "block" | "note";

export type ChecklistRow = {
  /** i18n label key suffix under `checklist.row.` */
  key: string;
  state: RowState;
  /** A literal value that will appear on the document. Never translated. */
  value: string | null;
  /** i18n key under `checklist.note.`, when there is no value to show. */
  noteKey: string | null;
  /** Rule provenance. Null on a fact row — a fact has no authority. */
  authority: string | null;
  confirmedBy: string | null;
  confirmedOn: string | null;
  fixRoute: string | null;
};

const FACT: Pick<ChecklistRow, "authority" | "confirmedBy" | "confirmedOn" | "fixRoute"> = {
  authority: null,
  confirmedBy: null,
  confirmedOn: null,
  fixRoute: null,
};

/** A value we hold → pass and print it. A value we do not → say so, quietly. */
function fact(key: string, value: string | null): ChecklistRow {
  return value
    ? { key, state: "pass", value, noteKey: null, ...FACT }
    : { key, state: "note", value: null, noteKey: "notRecorded", ...FACT };
}

function fromFinding(key: string, finding: Finding, value: string | null): ChecklistRow {
  return {
    key,
    state: finding.severity,
    value: finding.severity === "pass" ? value : null,
    noteKey: finding.severity === "pass" ? null : `fail.${finding.code}`,
    authority: finding.authority,
    confirmedBy: finding.confirmedBy,
    confirmedOn: finding.confirmedOn,
    fixRoute: finding.fixRoute,
  };
}

/**
 * The spine: which rule owns which position in the list. A rule not named here
 * still appears — appended, never dropped. A checklist that silently omits a
 * rule is worse than one that orders them oddly.
 */
const SPINE: Record<string, string> = {
  "invoice.clientNifMissing": "clientNif",
  "invoice.companyIdentityIncomplete": "ourIdentifiers",
};

export function checklist(doc: RenderedDocument): ChecklistRow[] {
  const byCode = new Map(doc.findings.map((f) => [f.code, f]));
  const placed = new Set<string>();

  const ruleRow = (code: string, value: string | null): ChecklistRow | null => {
    const finding = byCode.get(code);
    if (!finding) return null;
    placed.add(code);
    return fromFinding(SPINE[code] ?? code, finding, value);
  };

  const rows: ChecklistRow[] = [];

  // 1 — the client's NIF. A rule when one exists, a plain fact when it does not,
  //     so the row never vanishes just because the rule table is empty.
  rows.push(
    ruleRow("invoice.clientNifMissing", doc.counterparty.nif) ??
      fact("clientNif", doc.counterparty.nif),
  );

  // 2-4 — what else we will print about them.
  rows.push(fact("clientNis", doc.counterparty.nis));
  rows.push(fact("clientRc", doc.counterparty.rc));
  rows.push(fact("clientAddress", doc.counterparty.address));

  // 5 — our own four identifiers, which the décret does make obligatory.
  const ours = [doc.company.nif, doc.company.nis, doc.company.rc, doc.company.ai];
  rows.push(
    ruleRow("invoice.companyIdentityIncomplete", ours.every(Boolean) ? ours.join(" · ") : null) ??
      fact("ourIdentifiers", ours.every(Boolean) ? ours.join(" · ") : null),
  );

  // 6 — the sentence itself, not a claim that one was produced.
  rows.push(fact("amountInWords", doc.amountInWords || null));

  // 7 — every other rule that ran, in the order the profile returned them.
  for (const finding of doc.findings) {
    if (placed.has(finding.code)) continue;
    rows.push(fromFinding(finding.code, finding, null));
  }

  // 8 — LAW 5, stated on the screen rather than only in the code.
  rows.push(
    doc.number
      ? { key: "documentNumber", state: "pass", value: doc.number, noteKey: null, ...FACT }
      : {
          key: "documentNumber",
          state: "note",
          value: null,
          noteKey: "numberOnIssue",
          ...FACT,
        },
  );

  return rows;
}

export type ChecklistSummary = { blockers: number; warnings: number; canIssue: boolean };

export function summarise(rows: ChecklistRow[]): ChecklistSummary {
  const blockers = rows.filter((r) => r.state === "block").length;
  const warnings = rows.filter((r) => r.state === "warn").length;
  return { blockers, warnings, canIssue: blockers === 0 };
}
