import { join } from "node:path";
import { chromium } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/index";
import { db } from "../src/db";
import { session, user, userRole } from "../src/db/schema/auth";
import { seedWalk, teardownWalk } from "./lib/walk-fixture";

/**
 * The marché, clicked through by a person.
 *
 * Every other check in this repository proves one layer. The integration
 * suite proves the domain; `audit-forms` proves a field's name reaches the
 * action; `smoke:in` proves a route answers; `shots` proves it looks right.
 * None of them proves the four together — that a person can open screen 16,
 * type into a form, press the button, and land somewhere with what they typed
 * on it.
 *
 * This does, against a real build, over HTTP, with a real session cookie:
 *
 *   $env:DATABASE_URL = ".../supserv_test"; pnpm exec next start -p 3100
 *   pnpm walk --base http://127.0.0.1:3100
 *
 * It refuses any database whose name does not end in `_test`: it seeds a whole
 * enquiry, clicks it about, and removes it afterwards.
 */
const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const base = arg("base", "http://127.0.0.1:3100").replace(/\/$/, "");
const ACTOR_NAME = "Marché Walk";

const steps: { step: string; ok: boolean; note: string }[] = [];

function check(step: string, ok: boolean, note = "") {
  steps.push({ step, ok, note });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${step}${note ? ` — ${note}` : ""}`);
}

/** A failure that says only "false" costs a rerun. This says what was there. */
function checkText(step: string, haystack: string, needle: string) {
  const ok = haystack.includes(needle);
  check(step, ok, ok ? "" : `looked for "${needle}" in: ${haystack.replace(/\s+/g, " ").slice(0, 300)}`);
}

function refuseUnlessTest() {
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("this walk seeds and deletes rows — point DATABASE_URL at the _test database");
  }
}

async function main() {
  refuseUnlessTest();
  void ROOT;

  const ctx = await auth.$context;
  const stamp = Date.now().toString().slice(-8);
  const created = await ctx.internalAdapter.createUser(
    { email: `walk-${stamp}@supserv.invalid`, name: ACTOR_NAME, emailVerified: true },
    ctx as never,
  );
  await db.insert(userRole).values({ userId: created.id, role: "gerant" });
  const minted = await ctx.internalAdapter.createSession(created.id, ctx as never);
  const signature = await makeSignature(minted.token, ctx.secret);
  const cookieName = ctx.authCookies.sessionToken.name;
  const cookieValue = `${minted.token}.${signature}`;

  try {
    const ids = await seedWalk(created.id);

    const executablePath = arg("chrome", "") || undefined;
    const browser = await chromium.launch({ executablePath });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      locale: "fr-DZ",
    });
    await context.setExtraHTTPHeaders({ cookie: `${cookieName}=${cookieValue}` });
    const page = await context.newPage();

    const go = async (path: string) => {
      const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      return response?.status() ?? 0;
    };
    // A redirect lands the URL before the server component has painted; every
    // assertion below is about what is ON the page, so wait for it.
    const text = async () => {
      await page.waitForLoadState("networkidle");
      // The rendered HTML, not `innerText`: the document page draws its PDF
      // into an <object>, and an element whose layout the browser has not
      // resolved reports no text at all while plainly showing some.
      return `${page.url()}\n${await page.content()}`;
    };

    /* ── the terms: the CCAP's penalty clause, typed ───────────────────── */
    console.log("\nscreen 16 — the terms");
    check("the project opens", (await go(`/fr/projects/${ids.projectId}`)) === 200);
    /*
      A 200 IS NOT A PAGE. Signed out, every route answers 200 — with the
      sign-in page, which carries the whole message catalogue in its payload,
      so `content()` contains every string this file looks for. The walk once
      reported two checks green on the sign-in screen and then spent thirty
      seconds waiting for a form that was never going to be there.
    */
    if (page.url().includes("/sign-in")) {
      throw new Error(
        "the walk is signed out — the cookie was signed with a different secret; run it with --env-file=.env (pnpm walk)",
      );
    }
    check(
      "the penalties say nobody has read the CCAP",
      (await text()).includes("Personne n'a encore relevé la clause"),
    );

    await page.fill('input[name="penaltyPerMille"]', "1");
    await page.fill('input[name="penaltyCapPct"]', "10");
    await page.selectOption('select[name="penaltyBase"]', "excl");
    await page.locator('form:has(input[name="penaltyPerMille"]) button[type="submit"]').click();
    await page.waitForURL(/recorded=terms/, { timeout: 15_000 });
    // Exactly this: `numeric(6,3)` reads back "1.000", and "1.000‰ par jour"
    // is a thousand per mille to anybody skimming a French page.
    checkText("the clause is recorded, and reads as it was typed", await text(), "1‰ par jour");

    /* ── the avenant: two numbers, and a draft ─────────────────────────── */
    console.log("\nscreen 16c — the avenant");
    check("the avenant screen opens", (await go(`/fr/projects/${ids.projectId}/amendment`)) === 200);
    check(
      "it shows the marché's bordereau",
      (await page.locator('input[name^="newQty:"]').count()) > 0,
    );

    await page.locator('input[name^="newQty:"]').first().fill("3");
    await page.fill('input[name="theirNumber"]', "AV 01/2026");
    await page.fill('input[name="reason"]', "Quantités supplémentaires, terrain rocheux");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const documentUrl = page.url();
    check("it lands on the avenant it wrote", /\/documents\//.test(documentUrl));

    const onDocument = await text();
    checkText("the document says what the avenant changes", onDocument, "Ce que cet avenant change");
    checkText("and names the marché it amends", onDocument, "BC 2026/0457");
    checkText("and it is a draft until somebody issues it", onDocument, "Brouillon");

    /* ── back to the avenant screen: it edits the open one ─────────────── */
    check("the avenant screen reopens", (await go(`/fr/projects/${ids.projectId}/amendment`)) === 200);
    const reopened = await text();
    check("it says it is editing the open draft", reopened.includes("Un avenant est déjà ouvert"));
    check(
      "and the number typed is still there",
      (await page.inputValue('input[name="theirNumber"]')) === "AV 01/2026",
    );

    /* ── the décompte: refuses, and says which fact is missing ─────────── */
    console.log("\nscreen 16d — the décompte final");
    await go(`/fr/projects/${ids.projectId}`);
    const onProject = await text();
    check("the décompte panel is there", onProject.includes("Décompte final"));
    check(
      "and refuses, naming what is missing",
      onProject.includes("Une situation est émise et non signée") ||
        onProject.includes("Une situation est encore au brouillon") ||
        onProject.includes("Les travaux ne sont pas encore réceptionnés"),
    );

    /* ── the retenue: the panel that asks for it back ──────────────────── */
    console.log("\nscreen 16e — the retenue de garantie");
    check("the retention panel is there", onProject.includes("Retenue de garantie"));
    check(
      "and refuses, naming why nothing can be asked for yet",
      onProject.includes("La réception définitive n'est pas prononcée") ||
        onProject.includes("Aucune situation émise sur ce marché n'a retenu") ||
        onProject.includes("Toute la retenue détenue a déjà fait l'objet") ||
        onProject.includes("Ce projet n'est rattaché à aucun marché"),
    );
    // The same trap as the penalty clause: `numeric(6,3)` reads back "5.000",
    // and "5.000 %" on a French page is five thousand per cent.
    checkText("the rate reads as it was typed", onProject, "5 %");

    /* ── the situation: the column a person types ──────────────────────── */
    console.log("\nscreen 16b — the next situation");
    check(
      "the situation screen opens",
      (await go(`/fr/projects/${ids.projectId}/situation`)) === 200,
    );
    const qty = page.locator('input[name^="qty:"]');
    check("it shows the bordereau to claim against", (await qty.count()) > 0);
    await qty.first().fill("1");
    await page.fill('input[name="workDone"]', "Pose du deuxième tronçon");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
    check("it lands on the situation it wrote", /\/documents\//.test(page.url()));
    checkText("in the wilaya's own form", await text(), "Situation n°");

    await context.close();
    await browser.close();
  } finally {
    await teardownWalk(created.id);
    await db.delete(session).where(eq(session.userId, created.id));
    await db.delete(userRole).where(eq(userRole.userId, created.id));
    await db.delete(user).where(eq(user.id, created.id));
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length} checks, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
