import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Does every screen in the map actually answer?
 *
 * WHAT THIS PROVES, exactly: that each route resolves, that its module and the
 * layout above it load, that `getSession` runs, and that an unauthenticated
 * request is sent to sign-in. Nothing more. It does NOT render a page body —
 * every screen checks the session first and redirects before it reads
 * anything, which is what makes the check cheap and is also its limit.
 *
 * WHY IT EXISTS: on 30 August `/fr/reports` and `/fr/dashboard` returned 404
 * while the sidebar linked at them, for two days, and nothing in the test suite
 * could have noticed — `screen-coverage.mjs` checks that a `page.tsx` exists on
 * disk, and a file on disk is not a route that answers. This is the cheapest
 * check that would have caught it.
 *
 *   node scripts/smoke-routes.mjs [--base http://127.0.0.1:3100] [--locale fr]
 *
 * Every `[id]` is filled with a uuid that matches nothing. That is deliberate:
 * the session check comes first on every screen, so the id is never reached,
 * and a smoke test that needed live data would need seeding to run.
 */

const ROOT = join(import.meta.dirname, "..");
const NOWHERE = "00000000-0000-4000-8000-000000000000";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const base = (arg("base", "http://127.0.0.1:3000") ?? "").replace(/\/$/, "");
const locale = arg("locale", "fr");

/** Routes from the screen map, plus the supporting ones written down beside it. */
function routes() {
  const md = readFileSync(join(ROOT, "docs/SCREENS.md"), "utf8");
  const found = new Set();

  for (const line of md.split(/\r?\n/)) {
    // | 42 | BPU import and pricing | `/tenders/[id]/bpu` | **4** |
    const cell = line.match(/\|\s*`(\/[^`]*)`\s*\|/);
    if (!cell?.[1]) continue;
    const route = cell[1];
    if (route.includes("(") || route.includes("…")) continue;
    found.add(route);
  }

  return [...found].sort();
}

const fill = (route) =>
  `${base}/${locale}${route.replace(/\[[^\]]+\]/g, NOWHERE)}`.replace(/\/$/, "") || `${base}/${locale}`;

const list = routes();
if (list.length === 0) {
  console.error("no routes found in docs/SCREENS.md — has the table changed shape?");
  process.exit(1);
}

console.log(`${list.length} routes against ${base}\n`);

const bad = [];
for (const route of list) {
  const url = fill(route);
  let status = 0;
  let landed = "";

  try {
    const response = await fetch(url, { redirect: "follow" });
    status = response.status;
    landed = new URL(response.url).pathname;
  } catch (error) {
    bad.push({ route, url, why: `did not answer — ${error.message}` });
    console.log(`  DEAD  ${route}`);
    continue;
  }

  // Signed out, every screen sends you to sign-in. Anything else is either a
  // route that does not exist or a screen that threw on its way there.
  const ok = status === 200 && landed.endsWith("/sign-in");
  const isSignIn = route === "/sign-in";

  if (ok || (isSignIn && status === 200)) {
    console.log(`  ok    ${route}`);
  } else {
    bad.push({ route, url, why: `${status} → ${landed}` });
    console.log(`  FAIL  ${route}  ${status} → ${landed}`);
  }
}

console.log("");
if (bad.length === 0) {
  console.log(`all ${list.length} routes answer and send a signed-out visitor to sign-in`);
  process.exit(0);
}

console.log(`${bad.length} of ${list.length} routes did not answer as they should:\n`);
for (const entry of bad) console.log(`  ${entry.route}\n    ${entry.url}\n    ${entry.why}`);
process.exit(1);
