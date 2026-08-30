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
const ROOT = "C:/SUPSERV-ERP";
const APP = join(ROOT, "src/app/[locale]/(app)");

const rows = readFileSync(join(ROOT, "docs/SCREENS.md"), "utf8")
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
const unmapped = onDisk.filter((route) => !mapped.has(route));
if (unmapped.length > 0) {
  console.log(`\n${unmapped.length} routes on disk with no row in the map:`);
  for (const route of unmapped) console.log(`  ${route}`);
}

process.exit(missing.length > 0 ? 1 : 0);
