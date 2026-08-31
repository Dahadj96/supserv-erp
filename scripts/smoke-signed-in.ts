import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/index";
import { db } from "../src/db";
import { session, user, userRole } from "../src/db/schema/auth";

/**
 * Does every screen render for somebody who is signed in?
 *
 * `smoke-routes.mjs` stops at the redirect: it proves a route answers and sends
 * a signed-out visitor to sign-in, which is most of what went wrong on 30
 * August and none of what could go wrong behind the door. This one goes
 * through it.
 *
 *   pnpm exec tsx --env-file=.env scripts/smoke-signed-in.ts --base http://127.0.0.1:3100
 *
 * IT MUST BE POINTED AT A SERVER SHARING ITS DATABASE, and by default that is
 * `supserv_test` for both. Nothing is written to the application database.
 *
 * THE SESSION IS MINTED BY BETTER AUTH'S OWN CODE, not around it: the user and
 * the session row come from `internalAdapter`, and the cookie is signed with
 * `makeSignature` and the secret the library already read from the environment.
 * Nothing here reads, prints or writes a secret — the token never leaves this
 * process, and the user, the role and the session are deleted at the end
 * whether the run passes or fails.
 */

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};

const base = arg("base", "http://127.0.0.1:3100").replace(/\/$/, "");
const locale = arg("locale", "fr");
const NOWHERE = "00000000-0000-4000-8000-000000000000";

/** The same list `smoke-routes.mjs` reads, from the same table. */
function routes(): string[] {
  const md = readFileSync(join(ROOT, "docs/SCREENS.md"), "utf8");
  const found = new Set<string>();
  for (const line of md.split(/\r?\n/)) {
    const cell = line.match(/\|\s*`(\/[^`]*)`\s*\|/);
    if (!cell?.[1]) continue;
    if (cell[1].includes("(") || cell[1].includes("…")) continue;
    found.add(cell[1]);
  }
  return [...found].sort();
}

async function main() {
  const ctx = await auth.$context;
  const stamp = Date.now().toString().slice(-8);
  const email = `smoke-${stamp}@supserv.invalid`;

  const created = await ctx.internalAdapter.createUser(
    { email, name: "Smoke Test", emailVerified: true },
    ctx as never,
  );

  // Gérant, so no screen is refused for a reason that is not a bug.
  await db.insert(userRole).values({ userId: created.id, role: "gerant" });

  const minted = await ctx.internalAdapter.createSession(created.id, ctx as never);
  const token = minted.token;

  // Signed exactly as the library signs it. The value stays in this process.
  const signature = await makeSignature(token, ctx.secret);
  const cookie = `${ctx.authCookies.sessionToken.name}=${token}.${signature}`;

  const list = routes();
  console.log(`${list.length} routes against ${base}, signed in as gérant\n`);

  const bad: { route: string; why: string }[] = [];

  try {
    for (const route of list) {
      if (route === "/sign-in") continue;
      const url = `${base}/${locale}${route.replace(/\[[^\]]+\]/g, NOWHERE)}`;

      let status = 0;
      let landed = "";
      let shell = false;
      try {
        const response = await fetch(url, { headers: { cookie }, redirect: "follow" });
        status = response.status;
        landed = new URL(response.url).pathname;
        // The sidebar's wordmark. A 200 on its own only says the request did
        // not throw — an error boundary answers 200 too. This says the
        // application shell was rendered around the screen.
        shell = (await response.text()).includes(">SUPSERV<");
      } catch (error) {
        bad.push({ route, why: `did not answer — ${(error as Error).message}` });
        console.log(`  DEAD  ${route}`);
        continue;
      }

      // A screen for a record that does not exist is allowed to say so. What is
      // not allowed is a 500, or being bounced back to sign-in with a cookie
      // the application itself minted.
      if (landed.endsWith("/sign-in")) {
        bad.push({ route, why: "bounced to sign-in — the session was not accepted" });
        console.log(`  AUTH  ${route}`);
      } else if (status === 404) {
        // `notFound()` for a record that does not exist. Correct, and it does
        // not render the shell, so it is not asked to.
        console.log(`  ok    ${route}  (404 — no such record)`);
      } else if (status === 200 && shell) {
        console.log(`  ok    ${route}`);
      } else if (status === 200) {
        bad.push({ route, why: "answered 200 without the application shell around it" });
        console.log(`  BARE  ${route}`);
      } else {
        bad.push({ route, why: `${status} → ${landed}` });
        console.log(`  FAIL  ${route}  ${status}`);
      }
    }
  } finally {
    await db.delete(session).where(eq(session.userId, created.id));
    await db.delete(userRole).where(eq(userRole.userId, created.id));
    await db.delete(user).where(eq(user.id, created.id));
    console.log("\nseeded user, role and session removed");
  }

  if (bad.length === 0) {
    console.log(`all ${list.length - 1} screens render for a signed-in gérant`);
    process.exit(0);
  }

  console.log(`\n${bad.length} did not:\n`);
  for (const entry of bad) console.log(`  ${entry.route}\n    ${entry.why}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
