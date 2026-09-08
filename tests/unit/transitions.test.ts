import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canGo,
  edgesFrom,
  IllegalTransition,
  isTerminal,
  MACHINE_NAMES,
  MACHINES,
  type MachineName,
  statesOf,
} from "@/domain/control/transitions";

/**
 * Screen 64 — the state machines.
 *
 * Two kinds of test here. The first checks the graphs are coherent: no edge to
 * a state that does not exist, no state that cannot be reached, no machine
 * without a way to finish.
 *
 * The second is the one that earns its keep. It reads every `status: "..."`
 * literal out of `src/` and insists each is a declared state of some machine —
 * so a new status invented in a store, with no thought given to what it may
 * become, fails here rather than in six months when a screen filters on it.
 */
const root = join(import.meta.dirname, "..", "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("every graph is coherent", () => {
  for (const name of MACHINE_NAMES) {
    const machine = MACHINES[name];
    const states = statesOf(name);

    it(`${name}: every edge points at a state it declares`, () => {
      for (const [from, targets] of Object.entries(machine.to)) {
        for (const to of targets) {
          expect(states, `${name}: ${from} -> ${to}`).toContain(to);
        }
      }
    });

    it(`${name}: the initial state is one of its states`, () => {
      expect(states).toContain(machine.initial);
    });

    it(`${name}: every state is reachable from the initial one`, () => {
      const seen = new Set<string>([machine.initial]);
      const queue: string[] = [machine.initial];
      while (queue.length > 0) {
        const at = queue.shift() as string;
        for (const next of edgesFrom(name, at)) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...states].sort(), `${name}: unreachable states`).toEqual([...seen].sort());
    });

    it(`${name}: can finish, unless it says why it cannot`, () => {
      // A lifecycle with no terminal state is usually a classification wearing
      // a lifecycle's clothes. `intake_message` is the real exception — a
      // message is correspondence, not a process, and a dismissed one can
      // always come back. The exception has to be declared, so that the next
      // machine without an ending is a decision somebody made rather than one
      // nobody noticed.
      const ends = states.some((state) => isTerminal(name, state));
      if ("cyclic" in machine && machine.cyclic) {
        expect(ends, `${name} declares itself cyclic but has a terminal state`).toBe(false);
      } else {
        expect(ends, `${name} never finishes — declare cyclic, with a reason`).toBe(true);
      }
    });

    it(`${name}: no state is both declared unwritten and legacy`, () => {
      for (const state of machine.unwritten) {
        expect(machine.legacy, `${name}: ${state}`).not.toContain(state);
      }
    });

    it(`${name}: a legacy value is not a state`, () => {
      // Legacy values are read in old rows, never written and never moved out
      // of. Declaring one as a state would invite a guard to allow it.
      for (const state of machine.legacy) {
        expect(states, `${name}: ${state}`).not.toContain(state);
      }
    });
  }
});

describe("the guard", () => {
  it("allows a declared move", () => {
    expect(() => assertTransition("document", "draft", "issued")).not.toThrow();
  });

  it("refuses an undeclared one, and says which", () => {
    try {
      assertTransition("document", "issued", "draft");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransition);
      const illegal = error as IllegalTransition;
      expect(illegal.machine).toBe("document");
      expect(illegal.from).toBe("issued");
      expect(illegal.to).toBe("draft");
    }
  });

  it("refuses a state to itself unless a self-edge is declared", () => {
    // The first version of `assertTransition` returned early on `from === to`,
    // reasoning that re-saving a row without moving it is not a move. True of a
    // row, false of an EVENT — and issuing is an event. That shortcut waved
    // `issued -> issued` through and let `render()` issue the same document
    // twice. The integration test guarding LAW 5 caught it; this is the unit
    // test that stops it coming back.
    expect(() => assertTransition("document", "issued", "issued")).toThrow(IllegalTransition);

    for (const name of MACHINE_NAMES) {
      for (const state of statesOf(name)) {
        expect(canGo(name, state, state), `${name}: ${state} -> itself`).toBe(false);
      }
    }
  });

  it("refuses to move out of a legacy value", () => {
    // `paid` predates the rule that paid-ness is arithmetic. Nothing should be
    // able to transition a row out of it and give it a history it never had.
    expect(canGo("document", "paid", "issued")).toBe(false);
    expect(() => assertTransition("document", "paid", "credited")).toThrow(IllegalTransition);
  });
});

describe("LAW 5 — an issued document never goes back", () => {
  it("has no edge from issued to draft, from anywhere", () => {
    for (const state of statesOf("document")) {
      if (state === "draft") continue;
      expect(canGo("document", state, "draft"), `${state} -> draft`).toBe(false);
    }
  });

  it("ends at credited and written_off", () => {
    expect(isTerminal("document", "credited")).toBe(true);
    expect(isTerminal("document", "written_off")).toBe(true);
  });

  it("issuing is guarded by the STATUS, not by the number", () => {
    // The bug this machine was built to find. `render` used to refuse a
    // re-issue only when `record.number` was set, and `client_order` is
    // `numbering: "clientReference"` — it never gets one of our numbers, so
    // the check saw null and let it through. Every re-issue rewrote `lockedAt`
    // and `renderSnapshot` on a commitment the client already holds.
    const engine = readFileSync(join(root, "src/documents/engine.ts"), "utf8");
    expect(engine).toContain('assertTransition("document", record.status, "issued")');

    // Comments stripped first: the fix is explained by quoting the line it
    // replaced, and a test that cannot tell code from prose would fail on the
    // explanation of its own bug.
    const code = engine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, "the number check must not come back").not.toContain(
      'purpose === "issue" && record.number',
    );
  });
});

describe("LAW 6 — an approval is decided once", () => {
  it("leaves nowhere to go once decided", () => {
    for (const state of ["approved", "declined", "withdrawn"]) {
      expect(isTerminal("approval_request", state), state).toBe(true);
    }
  });

  it("agrees with the refusal `checkDecision` already returns", () => {
    // `gates.ts` refuses anything whose status is not `waiting`. That rule and
    // this graph have to say the same thing or one of them is decoration.
    const gates = readFileSync(join(root, "src/domain/approval/gates.ts"), "utf8");
    expect(gates).toContain('opts.request.status !== "waiting"');
    for (const state of statesOf("approval_request")) {
      if (state === "waiting") continue;
      expect(edgesFrom("approval_request", state)).toEqual([]);
    }
  });
});

describe("every status written in src/ is a declared state", () => {
  /**
   * Columns called `status` that are not lifecycles, and the values they hold.
   * Named here rather than silently allowed, because the reason they are exempt
   * is the interesting part — see the header of `transitions.ts`.
   */
  const NOT_LIFECYCLES = new Set([
    // intake_channel.status — configuration a person flips in settings.
    "live",
    "not_connected",
    "not_built",
    "considered",
    // item_coverage.status — recomputed from the datasheets that exist.
    "complete",
    "missing",
    "not_applicable",
  ]);

  const declared = new Set(MACHINE_NAMES.flatMap((name) => statesOf(name as MachineName)));

  const found = new Map<string, string[]>();
  for (const file of walk(join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bstatus:\s*"([^"]+)"/g)) {
      const value = match[1] as string;
      const rel = file.slice(root.length + 1).replaceAll("\\", "/");
      found.set(value, [...(found.get(value) ?? []), rel]);
    }
  }

  it("found the literals at all", () => {
    expect(found.size).toBeGreaterThan(10);
  });

  it("declares each one, or exempts it on purpose", () => {
    for (const [value, files] of found) {
      if (NOT_LIFECYCLES.has(value)) continue;
      expect(declared, `status: "${value}" written in ${files.join(", ")}`).toContain(value);
    }
  });

  it("does not exempt a value that is also a real state", () => {
    // An exemption that shadows a lifecycle state would silence the check for
    // the machine that needs it.
    for (const value of NOT_LIFECYCLES) {
      expect(declared, `${value} is exempt and also declared`).not.toContain(value);
    }
  });
});

describe("states nothing writes are named as such", () => {
  it("document: written_off is read everywhere and written nowhere", () => {
    // `credited` was on this list until 8 September 2026 and is not any more —
    // `cancelByCreditNote` writes it, which is what task 0.8 built. The list
    // shrinking is the point: it is the difference between a state the design
    // names and a state something in this codebase produces.
    expect(MACHINES.document.unwritten).toEqual(["written_off"]);

    const written = new Set<string>();
    for (const file of walk(join(root, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bstatus:\s*"([^"]+)"/g))
        written.add(match[1] as string);
    }

    for (const state of MACHINES.document.unwritten) {
      expect(written, `${state} is written now — remove it from unwritten`).not.toContain(state);
    }
  });

  it("intake_dossier: confirmation happens per field, not on the parent", () => {
    expect(MACHINES.intake_dossier.unwritten).toContain("confirmed");
  });
});
