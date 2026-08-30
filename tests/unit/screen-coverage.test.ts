import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Does every screen in the map have a route that exists?
 *
 * This test exists because of a specific mistake. Phase 7's last two screens
 * were finished and the plan was about to be declared done — and a coverage
 * check written at that moment found SEVENTEEN screens with no route, three of
 * them dead links in the sidebar people were meant to use every day.
 *
 * Some of the seventeen were the map lying about where a screen had been built.
 * The rest were real holes. Both are the same failure: a map nobody checks
 * against the filesystem drifts, and everybody keeps reading it as if it had
 * not.
 *
 * So the map is checked, on every run, and "the plan is finished" stops being a
 * sentence anybody has to take on trust.
 */
const root = join(import.meta.dirname, "..", "..");
const APP = join(root, "src/app/[locale]/(app)");

type Row = { n: string; name: string; route: string; phase: string };

const SCREENS = readFileSync(join(root, "docs/SCREENS.md"), "utf8");

/** Routes that exist and are not Figma screens, each with the screen it serves. */
const supporting = new Set(
  (SCREENS.split(/^## Supporting routes$/m)[1] ?? "")
    .split(/^## /m)[0]
    ?.split(/\r?\n/)
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1] as string),
);

const rows: Row[] = SCREENS.split(/\r?\n/)
  .map((line) => line.match(/^\|\s*(\d{2})\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/))
  .filter((m): m is RegExpMatchArray => m !== null)
  .map((m) => ({
    n: m[1] as string,
    name: m[2] as string,
    route: m[3] as string,
    phase: (m[4] as string).replace(/\*/g, "").trim(),
  }));

function pageFor(route: string): string | null {
  const rel = route.replace(/^\//, "");
  for (const candidate of [
    join(APP, rel, "page.tsx"),
    join(root, "src/app/[locale]", rel, "page.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every directory under the app group that has a page.tsx, as its route. */
function onDisk(): string[] {
  const found: string[] = [];
  (function walk(dir: string, prefix: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      if (existsSync(join(full, "page.tsx"))) found.push(`${prefix}/${name}`);
      walk(full, `${prefix}/${name}`);
    }
  })(APP, "");
  return found;
}

/** `(pattern)`, `(reference)`, `(overlay)` and friends have no route by design. */
const routed = rows.filter((row) => !/^\(/.test(row.route) && row.phase !== "later");

describe("the screen map matches the filesystem", () => {
  it("read the map at all", () => {
    // A regex that stopped matching would make every assertion below vacuous.
    expect(rows.length).toBe(86);
    expect(routed.length).toBeGreaterThan(50);
    // Same for the supporting table: an empty set would make "accounted for
    // nowhere" fail loudly rather than pass quietly, but a set that silently
    // stopped parsing would take the staleness check down with it.
    expect(supporting.size).toBeGreaterThan(5);
    expect(onDisk().length).toBeGreaterThan(50);
  });

  it("every screen that should have a route has one", () => {
    const missing = routed.filter((row) => pageFor(row.route) === null);
    expect(
      missing.map((row) => `${row.n} ${row.name} → ${row.route}`),
      "screens in the map with no page on disk",
    ).toEqual([]);
  });

  it("every nav entry goes somewhere", () => {
    // The three dead sidebar links — /dashboard, /sourcing, /orders — were live
    // in the nav for weeks. A dead link in the rail is worse than a missing
    // one: it teaches people the app is broken.
    const nav = readFileSync(join(root, "src/components/layout/nav-items.ts"), "utf8");
    const hrefs = [...nav.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1] as string);

    expect(hrefs.length).toBeGreaterThan(15);

    const parked = new Set(rows.filter((row) => row.phase === "later").map((row) => row.route));

    const dead = hrefs.filter((href) => !parked.has(href) && pageFor(href) === null);
    expect(dead, "nav entries with no page and no parked row in the map").toEqual([]);
  });

  it("every route on disk is written down somewhere", () => {
    // The check in reverse. A map that only asks "is every documented screen
    // built" goes green while routes nobody agreed to accumulate beside it —
    // and the first person to find one has no way to tell a deliberate
    // supporting route from something left behind by an abandoned attempt.
    const mapped = new Set(rows.map((row) => row.route));
    const unaccounted = onDisk().filter((r) => !mapped.has(r) && !supporting.has(r));

    expect(
      unaccounted,
      "routes on disk that are neither a screen row nor a supporting route",
    ).toEqual([]);
  });

  it("no supporting route is written down for a page that is gone", () => {
    const present = new Set(onDisk());
    const stale = [...supporting].filter((route) => !present.has(route));

    expect(stale, "supporting routes documented but not on disk").toEqual([]);
  });
});
