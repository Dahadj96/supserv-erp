import { globSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WHAT CAN BE READ WITHOUT SIGNING IN.
 *
 * `src/proxy.ts` is next-intl only — it routes locales, it does not
 * authenticate. Nothing global checks a session. Protection comes from
 * `src/app/[locale]/(app)/layout.tsx`, which calls `getSession()` and
 * redirects, and every page underneath inherits it.
 *
 * That is a fine design and it is also one `git mv` away from disaster: move a
 * page out of the `(app)` group, or add a route handler — which gets no layout
 * at all — and it is served to anybody who asks. On 22 Aug 2026 the ERP was
 * published at erp.supserv-dz.com, so "anybody who asks" now means the
 * internet. This test is what makes that safe to have done.
 */
const root = resolve(import.meta.dirname, "../..");

/** A file counts as guarded if it, or any layout above it, resolves a session. */
function guards(file: string): boolean {
  const src = readFileSync(file, "utf8");
  return src.includes("getSession") || src.includes("requireOwner");
}

function guardedByAncestorLayout(file: string): boolean {
  let dir = dirname(file);
  const stop = resolve(root, "src/app");

  while (dir.startsWith(stop)) {
    for (const name of ["layout.tsx", "layout.ts"]) {
      const layout = resolve(dir, name);
      try {
        if (guards(layout)) return true;
      } catch {
        // no layout at this level; keep walking up
      }
    }
    if (dir === stop) break;
    dir = dirname(dir);
  }
  return false;
}

/**
 * The two things that MUST be reachable without a session, and why:
 *   · the sign-in page — otherwise there is no way to sign in;
 *   · Better Auth's own handler — it is what performs the sign-in, and the
 *     Entra callback arrives here with no session by definition.
 *
 * Anything else appearing in this list is a mistake, not a decision.
 */
const PUBLIC_ON_PURPOSE = [
  "src/app/[locale]/sign-in/page.tsx",
  "src/app/api/auth/[...all]/route.ts",
];

describe("what the internet can reach", () => {
  const files = globSync("src/app/**/{page,route}.{ts,tsx}", { cwd: root })
    .map((file) => resolve(root, file))
    .filter((file) => !file.includes("sign-in") || true);

  it("finds routes to check at all", () => {
    // A glob that silently matches nothing would make every test below pass.
    expect(files.length).toBeGreaterThan(20);
  });

  it("serves nothing without a session except the sign-in flow", () => {
    const open = files
      .filter((file) => !guards(file) && !guardedByAncestorLayout(file))
      .map((file) => relative(root, file).replace(/\\/g, "/"));

    expect(open.sort()).toEqual([...PUBLIC_ON_PURPOSE].sort());
  });

  it("checks the session in every route handler itself, since a handler has no layout", () => {
    const handlers = files.filter((file) => file.endsWith("route.ts"));
    const unguarded = handlers
      .filter((file) => !guards(file))
      .map((file) => relative(root, file).replace(/\\/g, "/"));

    expect(unguarded).toEqual(["src/app/api/auth/[...all]/route.ts"]);
  });

  it("still has the layout that protects everything else", () => {
    const layout = resolve(root, "src/app/[locale]/(app)/layout.tsx");
    const src = readFileSync(layout, "utf8");

    expect(src).toContain("getSession");
    expect(src, "and it redirects rather than rendering an empty shell").toContain("redirect(");
    expect(src, "signed in with no role is not the same as signed in").toContain("session.role");
  });
});
