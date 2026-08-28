import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mayRun, NEVER, TOOLS, toolsFor } from "@/assistant/registry";
import { assistantPermissions, PERMISSIONS, ROLES, type Role } from "@/auth/can";

/**
 * Screens 43, 44, 45 — LAW 6, made checkable.
 *
 * "The assistant proposes, never executes" is a slogan until something fails
 * when it stops being true. These are that something.
 */
const root = join(import.meta.dirname, "..", "..");

const load = (locale: string) =>
  JSON.parse(readFileSync(`${root}/src/i18n/messages/${locale}.json`, "utf8"));

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, part) => {
    if (typeof o !== "object" || o === null) return undefined;
    return (o as Record<string, unknown>)[part];
  }, obj);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("nothing in src/assistant writes to a business table", () => {
  /**
   * The load-bearing test. Every file under `src/assistant` is read and checked
   * for the three Drizzle verbs that change data.
   *
   * A tool that inserted into `document` or updated `payment` would pass a type
   * check, pass a permission check, and quietly break the only law that makes
   * an assistant safe to point at a real company's data. It would not pass this.
   */
  const files = walk(join(root, "src/assistant"));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(1);
  });

  for (const file of files) {
    const rel = file.slice(root.length + 1).replaceAll("\\", "/");

    it(`${rel} does not write`, () => {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      for (const verb of ["db.insert(", "db.update(", "db.delete(", "tx.insert(", "tx.update("]) {
        expect(source, `${rel} contains ${verb}`).not.toContain(verb);
      }
    });
  }
});

describe("the registry", () => {
  it("declares only read and propose", () => {
    // There is no third kind, and adding one is how "never executes" ends.
    for (const tool of TOOLS) {
      expect(["read", "propose"], tool.name).toContain(tool.kind);
    }
  });

  it("names a real permission, or none", () => {
    for (const tool of TOOLS) {
      if (tool.permission === null) continue;
      expect(PERMISSIONS, tool.name).toContain(tool.permission);
    }
  });

  it("gives every tool somewhere to cite", () => {
    for (const tool of TOOLS) {
      expect(tool.cites, tool.name).toMatch(/^\//);
    }
  });

  it("has no duplicate names", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never asks for a permission the assistant is not allowed to hold", () => {
    // `assistantPermissions` strips `records.delete` from every role. A tool
    // gated on it could never run, which would be a dead row pretending to be
    // a capability.
    for (const tool of TOOLS) {
      expect(tool.permission, tool.name).not.toBe("records.delete");
    }
  });
});

describe("the assistant holds exactly the caller's permissions", () => {
  const roles = Object.keys(ROLES) as Role[];

  it("gives a role nothing its permissions do not already allow", () => {
    for (const role of roles) {
      const held = new Set<string>(assistantPermissions(role));
      for (const tool of toolsFor(role)) {
        if (tool.permission === null) continue;
        expect(held, `${role} got ${tool.name}`).toContain(tool.permission);
      }
    }
  });

  it("never lets the assistant do more than the person", () => {
    for (const role of roles) {
      for (const tool of TOOLS) {
        if (!mayRun(role, tool.name)) continue;
        if (tool.permission === null) continue;
        expect(
          ROLES[role] as readonly string[],
          `${role} may run ${tool.name} without holding ${tool.permission}`,
        ).toContain(tool.permission);
      }
    }
  });

  it("gives lecture and chantier only the tools that need no permission", () => {
    // Both hold no permissions at all. They still get the unrestricted reads,
    // which is correct — those answer from screens they can already open.
    for (const role of ["lecture", "chantier"] as const) {
      for (const tool of toolsFor(role)) {
        expect(tool.permission, `${role} got ${tool.name}`).toBeNull();
      }
    }
  });

  it("refuses an unknown tool and a missing role", () => {
    expect(mayRun("gerant", "deleteEverything")).toBe(false);
    expect(mayRun(null, "whatIsLate")).toBe(false);
  });
});

describe("what it can never do is named, and absent", () => {
  it("lists refusals specifically enough to be checkable", () => {
    expect(NEVER.length).toBeGreaterThan(4);
  });

  it("has no tool implementing any of them", () => {
    const names = new Set(TOOLS.map((tool) => tool.name));
    for (const forbidden of NEVER) {
      expect(names, `${forbidden} exists as a tool`).not.toContain(forbidden);
    }
  });

  it("says each one in both languages", () => {
    const en = load("en");
    const fr = load("fr");
    for (const forbidden of NEVER) {
      expect(get(en, `assistantSafety.never.${forbidden}`), `${forbidden} (English)`).toBeTypeOf(
        "string",
      );
      expect(get(fr, `assistantSafety.never.${forbidden}`), `${forbidden} (French)`).toBeTypeOf(
        "string",
      );
    }
  });
});

describe("every tool reads as a sentence", () => {
  const en = load("en");
  const fr = load("fr");

  it("names each one in both languages", () => {
    for (const tool of TOOLS) {
      expect(get(en, `assistantSafety.tool.${tool.name}`), `${tool.name} (English)`).toBeTypeOf(
        "string",
      );
      expect(get(fr, `assistantSafety.tool.${tool.name}`), `${tool.name} (French)`).toBeTypeOf(
        "string",
      );
    }
  });
});
