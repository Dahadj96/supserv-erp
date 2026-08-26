import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What a client component is allowed to reach.
 *
 * A file marked "use client" and everything it imports is compiled into the
 * BROWSER bundle. If any of it eventually imports `@/db`, the bundler follows
 * the chain to `postgres`, then to `node:tls`, finds no such module in a
 * browser, and the page 500s at render time.
 *
 * That is not caught by `tsc`, and it is not caught by any test that imports
 * modules directly under Node — both of which passed while /capture was dead.
 * The only thing that catches it is walking the import graph, so this walks it.
 */

const SRC = "src";

/** Modules a client component may never end up importing, however indirectly. */
const SERVER_ONLY = ["@/db", "@/auth/session", "@/auth/index", "drizzle-orm", "postgres"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Local imports only — a bare package name is resolved by the `SERVER_ONLY` list. */
function importsOf(file: string): { specs: string[]; source: string } {
  const source = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of source.matchAll(/^\s*import\s+(?:type\s+)?[^"';]*from\s+"([^"]+)"/gm)) {
    // `import type` is erased before bundling and cannot drag anything in.
    if (/^\s*import\s+type\s/.test(m[0] ?? "")) continue;
    if (m[1]) specs.push(m[1]);
  }
  return { specs, source };
}

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? join(from, "..", spec)
      : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

/** Follows every runtime import from a client component and reports the chain. */
function reach(entry: string): string[][] {
  const bad: string[][] = [];
  const seen = new Set<string>();

  const visit = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);

    const { specs } = importsOf(file);
    for (const spec of specs) {
      if (SERVER_ONLY.some((s) => spec === s || spec.startsWith(`${s}/`))) {
        bad.push([...chain, file, spec]);
        continue;
      }
      const next = resolve(spec, file);
      // A server action file is a boundary, not an import: Next replaces it
      // with a fetch, so what it reaches never enters the browser bundle.
      if (!next) continue;
      if (readFileSync(next, "utf8").startsWith('"use server"')) continue;
      visit(next, [...chain, file]);
    }
  };

  visit(entry, []);
  return bad;
}

describe("nothing a browser loads may reach the database", () => {
  const files = walk(SRC);
  const clientComponents = files.filter((f) => readFileSync(f, "utf8").startsWith('"use client"'));

  it("finds the client components to check", () => {
    // If this ever goes to zero the test below is passing vacuously.
    expect(clientComponents.length).toBeGreaterThan(0);
  });

  it.each(clientComponents)("%s stays out of the database", (file) => {
    const chains = reach(file);
    // Printed as a chain, because "something imports the db" is not actionable
    // and "box.tsx → capture/quick.ts → @/db" is.
    expect(chains.map((c) => c.join(" → "))).toEqual([]);
  });
});
