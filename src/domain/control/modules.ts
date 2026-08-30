import { PHASES } from "./phases";

/**
 * Screen 31 — Modules.
 *
 * The frame draws switches. There are none, and that is the decision this file
 * records rather than the corner it cuts.
 *
 * A module switch has to mean something when it is off, and there are only two
 * honest meanings. Either the screens vanish — and then a person who opened
 * Deliveries yesterday finds it gone with no explanation, and the rows are
 * still in the database being counted by every report — or the screens stay and
 * the switch does nothing, which is a lie with a toggle on it.
 *
 * What people actually want from this screen is the answer to "what does this
 * system do, and what does it not do yet". So that is what it shows: every
 * module, whether it is built, and for the ones that are not, the honest reason.
 * `parked` is not "coming soon" — it is a decision recorded in PLAN §7, and the
 * screen names it as such.
 *
 * If a real switch is ever needed — a company that genuinely does not do
 * tenders — the honest shape is a per-module PERMISSION, not a global on/off,
 * because the question is always "who may" and never "does it exist".
 */

export type ModuleState = "built" | "parked";

export type Module = {
  key: string;
  state: ModuleState;
  /** Where it lives, when it lives anywhere. */
  href: string | null;
  /** The phase that built it, or would. */
  phase: string;
};

export const MODULES: Module[] = [
  { key: "capture", state: "built", href: "/inbox", phase: "2" },
  { key: "records", state: "built", href: "/companies", phase: "1" },
  { key: "documents", state: "built", href: "/settings/templates", phase: "3" },
  { key: "sell", state: "built", href: "/deals", phase: "4" },
  { key: "sourcing", state: "built", href: "/sourcing", phase: "4" },
  { key: "money", state: "built", href: "/invoices", phase: "5" },
  { key: "deliveries", state: "built", href: "/deliveries", phase: "5" },
  { key: "organisation", state: "built", href: "/today", phase: "6" },
  { key: "control", state: "built", href: "/compliance", phase: "7" },
  { key: "assistant", state: "built", href: "/assistant", phase: "7" },

  // Built 30 Aug. Screens 07 and 08 - the tender list and the dossier that says
  // whether a folder will be accepted at the desk. Screen 42, the BPU import,
  // is the part of this module still parked.
  { key: "tenders", state: "built", href: "/tenders", phase: "4" },

  // Built 30 Aug. Screens 15 and 16 - situations, retention and the bank
  // guarantees, which is what happens between winning work and being paid for
  // it, and which for a company doing travaux is most of the year.
  { key: "projects", state: "built", href: "/projects", phase: "5" },

  // PLAN §7, "Later, deliberately parked". Named here so that "the system does
  // not do this" is visible rather than discovered.
  { key: "recruitment", state: "parked", href: null, phase: "later" },
  { key: "supplierScorecard", state: "parked", href: null, phase: "later" },
  { key: "websiteForms", state: "parked", href: null, phase: "later" },
  { key: "arabic", state: "parked", href: null, phase: "later" },
];

export function moduleCounts() {
  return {
    built: MODULES.filter((m) => m.state === "built").length,
    parked: MODULES.filter((m) => m.state === "parked").length,
    phases: PHASES.length,
  };
}
