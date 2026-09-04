import { chromium } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/index";
import { db } from "../src/db";
import { session, user, userRole } from "../src/db/schema/auth";
import { NAV_GROUPS } from "../src/components/layout/nav-items";

/**
 * The one claim a screenshot pass cannot check: that a phone can REACH the
 * twenty-eight destinations.
 *
 * `pnpm shots` proves nothing overflows and everything renders; it cannot open
 * a drawer. Since "reachable had to mean reachable by hand" is now a promise
 * the repository makes — see
 * docs/DECISIONS/2026-09-04-reachable-had-to-mean-reachable.md — it gets a
 * check that presses the button:
 *
 *   $env:DATABASE_URL = ".../supserv_test"; pnpm exec next start -p 3100
 *   pnpm exec tsx --env-file=.env scripts/phone-drawer.ts
 *
 * Same refusal as the screenshot script: a `_test` database only, since it
 * signs a throw-away user in and deletes them afterwards.
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const base = arg("base", "http://127.0.0.1:3100").replace(/\/$/, "");

function refuseUnlessTest() {
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("this signs a user in and deletes them — point DATABASE_URL at _test");
  }
}

async function main() {
  refuseUnlessTest();
  const ctx = await auth.$context;
  const stamp = Date.now().toString().slice(-8);
  const created = await ctx.internalAdapter.createUser(
    { email: `drawer-${stamp}@supserv.invalid`, name: "Drawer Check", emailVerified: true },
    ctx as never,
  );
  await db.insert(userRole).values({ userId: created.id, role: "gerant" });
  const minted = await ctx.internalAdapter.createSession(created.id, ctx as never);
  const signature = await makeSignature(minted.token, ctx.secret);
  const cookie = `${ctx.authCookies.sessionToken.name}=${minted.token}.${signature}`;

  const failures: string[] = [];
  const browser = await chromium.launch({ executablePath: arg("chrome", "") || undefined });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "fr-DZ",
    });
    await context.setExtraHTTPHeaders({ cookie });
    const page = await context.newPage();

    await page.goto(`${base}/fr/deals`, { waitUntil: "networkidle" });

    // The rail is a laptop object and must stay hidden; the button is the door.
    if (await page.locator("aside nav").isVisible()) failures.push("the rail is showing at 390px");

    await page.getByRole("button", { name: "Menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await drawer.waitFor({ state: "visible", timeout: 5000 });

    // Every destination the rail offers, offered here too. This is the whole
    // point: twenty-four of them had no door on a phone at all.
    const hrefs = await drawer.getByRole("link").evaluateAll((links) =>
      links.map((l) => new URL((l as HTMLAnchorElement).href).pathname.replace(/^\/(fr|en)/, "")),
    );
    for (const entry of NAV_GROUPS.flatMap((g) => g.entries)) {
      if (!hrefs.includes(entry.href)) failures.push(`no way to reach ${entry.href}`);
    }

    await page.screenshot({ path: ".logs/drawer-open.png" });

    // It has to take you somewhere, and close behind you.
    await drawer.getByRole("link", { name: /Chantiers/i }).click();
    await page.waitForURL(/\/projects/, { timeout: 10_000 });
    if ((await page.getByRole("dialog", { name: "Menu" }).count()) > 0) {
      failures.push("the drawer stayed open over the page it opened");
    }

    console.log(`${hrefs.length} destinations in the drawer`);
    console.log(`tapping Chantiers went to ${new URL(page.url()).pathname}`);
  } finally {
    await browser.close();
    await db.delete(session).where(eq(session.userId, created.id));
    await db.delete(userRole).where(eq(userRole.userId, created.id));
    await db.delete(user).where(eq(user.id, created.id));
  }

  if (failures.length > 0) {
    for (const line of failures) console.log(`  ${line}`);
    console.log(`\n${failures.length} to look at`);
    process.exit(1);
  }
  console.log("the phone can reach every destination the rail offers");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
