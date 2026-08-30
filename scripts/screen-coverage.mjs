import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Does every screen in docs/SCREENS.md have a route that exists?
 *
 * The map is a claim. This checks it against the filesystem, so "the plan is
 * finished" is something anybody can verify in two seconds rather than
 * something they have to take on trust from a commit message.
 *
 * `(pattern)`, `(reference)`, `(overlay)`, `(proof)` and `(responsive)` have no
 * route by design and are counted separately. `later` is the parked list.
 */
const ROOT = join(import.meta.dirname, "..");
const APP = join(ROOT, "src/app/[locale]/(app)");

const SCREENS = readFileSync(join(ROOT, "docs/SCREENS.md"), "utf8");

/**
 * The other direction: routes that exist and are not screens. Each is written
 * down in the "Supporting routes" table with the screen it serves, so a route
 * built with no line explaining it fails this check rather than accumulating
 * quietly.
 */
const supporting = new Set(
  (SCREENS.split(/^## Supporting routes$/m)[1] ?? "")
    .split(/^## /m)[0]
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter(Boolean)
    .map((m) => m[1]),
);

const rows = SCREENS
  .split(/\r?\n/)
  .map((line) => line.match(/^\|\s*(\d{2})\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/))
  .filter(Boolean)
  .map((m) => ({ n: m[1], name: m[2], route: m[3], phase: m[4].replace(/\*/g, "").trim() }));

function pageFor(route) {
  // `/deals/[id]/prices` -> src/app/[locale]/(app)/deals/[id]/prices/page.tsx
  const rel = route.replace(/^\//, "");
  for (const candidate of [
    join(APP, rel, "page.tsx"),
    join(ROOT, "src/app/[locale]", rel, "page.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const noRoute = [];
const parked = [];
const built = [];
const missing = [];

for (const row of rows) {
  if (/^\(/.test(row.route)) {
    noRoute.push(row);
    continue;
  }
  if (row.phase === "later") {
    parked.push(row);
    continue;
  }
  (pageFor(row.route) ? built : missing).push(row);
}

console.log(`${rows.length} screens in the map`);
console.log(`  ${built.length} routed and present`);
console.log(`  ${noRoute.length} patterns / references / overlays — no route by design`);
console.log(`  ${parked.length} parked until after the first release`);
console.log(`  ${missing.length} routed and MISSING`);

if (missing.length > 0) {
  console.log("\nmissing:");
  for (const row of missing) console.log(`  ${row.n}  ${row.name.padEnd(38)} ${row.route}`);
}

// Routes that exist and are in no screen row — built without a map entry.
const onDisk = [];
(function walk(dir, prefix = "") {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(join(full, "page.tsx"))) onDisk.push(`${prefix}/${name}`);
    walk(full, `${prefix}/${name}`);
  }
})(APP);

const mapped = new Set(rows.map((row) => row.route));
const unmapped = onDisk.filter((route) => !mapped.has(route) && !supporting.has(route));

console.log(`  ${supporting.size} supporting routes, each written down`);

if (unmapped.length > 0) {
  console.log(`\n${unmapped.length} routes on disk accounted for NOWHERE:`);
  for (const route of unmapped) console.log(`  ${route}`);
}

// A supporting row for a route that no longer exists is the same drift in
// reverse — documentation describing a screen nobody can open.
const present = new Set(onDisk);
const stale = [...supporting].filter((route) => !present.has(route));
if (stale.length > 0) {
  console.log(`\n${stale.length} supporting routes written down but NOT on disk:`);
  for (const route of stale) console.log(`  ${route}`);
}

process.exit(missing.length + unmapped.length + stale.length > 0 ? 1 : 0);
