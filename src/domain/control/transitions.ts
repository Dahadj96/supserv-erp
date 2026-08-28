/**
 * Screen 64 — the state machines, in one place, enforced rather than drawn.
 *
 * Nine columns in this schema are called `status`. They are not nine state
 * machines, and treating them as such would produce guards that refuse
 * legitimate edits. Two of them are not lifecycles at all:
 *
 *   `intake_channel.status`  is CONFIGURATION — live, not_connected, not_built,
 *                            considered. A person flips it in settings, in any
 *                            direction, and "not_built → live" is a deployment
 *                            rather than a transition.
 *   `item_coverage.status`   is a COMPUTED FACT — complete, missing,
 *                            not_applicable. It is recomputed from the
 *                            datasheets that exist, so there is no "from".
 *
 * The other seven are lifecycles, and they are below.
 *
 * Every machine records `unwritten`: states the schema names that no code path
 * currently produces. That list is not a to-do — it is the difference between
 * "the design says a document can be credited" and "something in this codebase
 * credits a document", and `tests/unit/transitions.test.ts` checks it stays
 * true. A state machine that quietly claims a transition nobody implemented is
 * how a screen ends up with a button that cannot work.
 */

export class IllegalTransition extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${machine}: ${from} -> ${to}`);
    this.name = "IllegalTransition";
  }
}

export type Machine = {
  /** Matches the `entity` written to `audit_entry`, so the two can be joined. */
  entity: string;
  /** What a row is when it is created. */
  initial: string;
  /** from -> where it may go. An empty list is a terminal state. */
  to: Record<string, readonly string[]>;
  /** In the schema, produced by nothing. See the note above. */
  unwritten: readonly string[];
  /** Values in rows written before a rule changed. Read, never written. */
  legacy: readonly string[];
  /**
   * A lifecycle normally ends somewhere, and one with no terminal state is
   * usually a classification wearing a lifecycle's clothes. `intake_message` is
   * the real exception and has to say so out loud — see its note.
   */
  cyclic?: true;
};

export const MACHINES = {
  /**
   * LAW 5 — an issued document is immutable.
   *
   * There is no way back to `draft`, deliberately and permanently. A mistake on
   * an issued invoice is corrected by an avoir that keeps both numbers, not by
   * editing the row somebody has already been sent.
   */
  document: {
    entity: "document",
    initial: "draft",
    to: {
      draft: ["issued"],
      issued: ["credited", "written_off"],
      credited: [],
      written_off: [],
    },
    // Both read in a dozen places — `paidStateOf`, the invoice list's tones,
    // the delivery and relance queries — and written by nothing. The avoir flow
    // that would set `credited` does not exist yet.
    unwritten: ["credited", "written_off"],
    // Phase 5 moved paid-ness to arithmetic over `payment_allocation`. Rows
    // written before that still say this; `paidStateOf` ignores them.
    legacy: ["paid", "part_paid"],
  },

  /** LAW 6 — decided once. `checkDecision` already refuses `alreadyDecided`. */
  approval_request: {
    entity: "approval_request",
    initial: "waiting",
    to: {
      waiting: ["approved", "declined", "withdrawn"],
      approved: [],
      declined: [],
      withdrawn: [],
    },
    unwritten: ["withdrawn"],
    legacy: [],
  },

  /**
   * Nothing here is terminal, on purpose.
   *
   * "An email nobody can find again is worse than one nobody read" — so
   * `dismissed` goes back to `needs_review`, and a committed message stays
   * where it can be found. The schema comment claims `archived` and `ignored`;
   * the code writes `dismissed`. The code wins.
   *
   * So this machine never finishes, and that is the one legitimate case of it:
   * a message is correspondence, not a process. Every other machine here has to
   * end somewhere, and the test enforces that — which is why the exception is a
   * flag with a reason rather than an absence nobody notices.
   */
  intake_message: {
    entity: "intake_message",
    initial: "needs_review",
    cyclic: true,
    to: {
      needs_review: ["classified", "committed", "dismissed"],
      classified: ["needs_review", "committed", "dismissed"],
      committed: ["dismissed"],
      dismissed: ["needs_review"],
    },
    unwritten: [],
    legacy: ["archived", "ignored"],
  },

  /** A reading, and whether it survived being read. */
  intake_dossier: {
    entity: "intake_dossier",
    initial: "reading",
    to: {
      reading: ["review", "failed"],
      review: ["confirmed"],
      confirmed: [],
      // Not terminal: a scan that failed can be fed through again.
      failed: ["reading"],
    },
    // The dossier row never becomes `confirmed` — confirmation happens per
    // FIELD, in `extraction_field`, and nothing rolls that up onto the parent.
    unwritten: ["confirmed"],
    legacy: [],
  },

  /**
   * LAW 2 — this is where extraction becomes fact.
   *
   * `rejected` is not a delete: "the reading stays, marked rejected. What the
   * machine got wrong is the only record of what to fix."
   */
  extraction_field: {
    entity: "extraction_field",
    initial: "proposed",
    to: {
      proposed: ["confirmed", "corrected", "rejected"],
      confirmed: [],
      corrected: [],
      rejected: [],
    },
    unwritten: [],
    legacy: [],
  },

  /** Screen 62 — "Import can be undone, within 7 days". */
  import_batch: {
    entity: "import_batch",
    initial: "mapping",
    to: {
      mapping: ["previewed"],
      previewed: ["imported"],
      imported: ["undone"],
      undone: [],
    },
    unwritten: [],
    legacy: [],
  },

  /** Screen 20 — written and not sent is a different fact from never written. */
  relance: {
    entity: "relance",
    initial: "draft",
    to: {
      draft: ["sent"],
      sent: ["replied"],
      replied: [],
    },
    unwritten: [],
    legacy: [],
  },

  /** How a supplier answered, or did not. */
  sourcing_response: {
    entity: "sourcing_response",
    initial: "asked",
    to: {
      asked: ["quoted", "declined", "no_reply", "bounced"],
      quoted: [],
      declined: [],
      // Both are "we heard nothing"; a supplier who later answers goes back to
      // asked rather than jumping straight to quoted, so the chase is recorded.
      no_reply: ["asked"],
      bounced: ["asked"],
    },
    unwritten: [],
    legacy: [],
  },
} as const satisfies Record<string, Machine>;

export type MachineName = keyof typeof MACHINES;

export const MACHINE_NAMES = Object.keys(MACHINES) as MachineName[];

/** Every state a machine knows, including the ones nothing writes. */
export function statesOf(name: MachineName): string[] {
  return Object.keys(MACHINES[name].to);
}

/**
 * Where a state may go.
 *
 * `MACHINES` is `as const`, so indexing `to` with a plain string does not
 * typecheck at the call site. This is the one place that widening happens, and
 * it happens deliberately rather than with an `any` sprinkled at each caller.
 */
export function edgesFrom(name: MachineName, state: string): readonly string[] {
  return (MACHINES[name] as Machine).to[state] ?? [];
}

export function isTerminal(name: MachineName, state: string): boolean {
  const machine = MACHINES[name] as Machine;
  return (machine.to[state]?.length ?? 0) === 0;
}

export function canGo(name: MachineName, from: string, to: string): boolean {
  const machine = MACHINES[name] as Machine;
  // A legacy value is not a state anybody may move OUT of by this route — the
  // row predates the rule, and guessing what it meant is how old data acquires
  // a history it never had.
  return (machine.to[from] ?? []).includes(to);
}

/**
 * The guard. Call it before the update, not after.
 *
 * Throwing rather than returning false is deliberate: every caller here is
 * inside a transaction that must not commit, and a boolean somebody forgets to
 * check is the bug this module exists to remove.
 *
 * `from === to` is NOT a free pass, and the first version of this function got
 * that wrong. It returned early on the grounds that re-saving a row without
 * moving it is not a move — which is true of a row and false of an EVENT.
 * Issuing is an event. With the shortcut in place, `issued -> issued` was
 * waved through, and `render()` cheerfully issued the same document a second
 * time: the integration test that has guarded LAW 5 since phase 3 caught it on
 * the first full run.
 *
 * So a self-edge has to be declared like any other. None of the seven machines
 * declares one, because none of them has a step worth repeating.
 */
export function assertTransition(name: MachineName, from: string, to: string): void {
  if (!canGo(name, from, to)) throw new IllegalTransition(name, from, to);
}
