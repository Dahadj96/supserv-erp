import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { auth } from "../src/auth/index";
import { db } from "../src/db";
import { session, user, userRole } from "../src/db/schema/auth";
import { seedWalk, teardownWalk } from "./lib/walk-fixture";

/**
 * Every screen, photographed on the two machines it will actually be used on
 * — a 12-inch laptop (1366 × 768) and a desktop (1920 × 1080) — and measured
 * while it is open: the smallest text on the page, anything that spills past
 * the right edge, anything cut off. A screenshot answers "does it look right";
 * the measurements answer "would anybody be able to read it", which is the
 * question the person who asked for this actually asked.
 *
 *   $env:DATABASE_URL = ".../supserv_test"; pnpm exec next start -p 3100
 *   pnpm exec tsx --env-file=.env scripts/screenshots.ts --base http://127.0.0.1:3100
 *
 * Refuses any database whose name does not end in `_test`: it seeds a full
 * enquiry to have something on the screens, and removes it afterwards.
 */
const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const base = arg("base", "http://127.0.0.1:3100").replace(/\/$/, "");
const locale = arg("locale", "fr");
const OUT = join(ROOT, ".data", "screenshots");
const NOWHERE = "00000000-0000-4000-8000-000000000000";
const ACTOR_NAME = "Screenshot Walk";

const VIEWPORTS = [
  // The phone the Gérant actually carries. Screen 86 designed four routes at
  // 390; every OTHER route is still opened on one, and this viewport is how we
  // find out whether "still readable" was true or just asserted.
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "laptop-1366x768", width: 1366, height: 768 },
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
];

/** Body text under this is unreadable on a 12-inch panel at 100 %. */
const MIN_READABLE_PX = 11.5;

type Measure = {
  route: string;
  viewport: string;
  status: number;
  /** Text nodes drawn under MIN_READABLE_PX, with a sample. */
  tiny: { count: number; samples: string[] };
  /** Free-text fields drawn under 140px wide. */
  narrowInputs: string[];
  /** Untranslated message keys printed on the page, as next-intl prints them. */
  missingKeys: string[];
  /** The navigation rail runs past the bottom of the window instead of scrolling. */
  railCut: boolean;
  /** The page is wider than the window. */
  horizontalOverflow: number;
  /** Elements whose right edge is past the window's. */
  spilling: string[];
  /** Elements whose text is cut by overflow hidden without an ellipsis. */
  clipped: string[];
  /** Interactive targets under 24 px tall. */
  smallTargets: number;
  /** …by element, and five examples: a count cannot be acted on. */
  smallTargetKinds: Record<string, number>;
  smallTargetSamples: string[];
};

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

/** What runs inside the page. Plain DOM, no dependencies. */
const MEASURE = `(() => {
  const MIN = ${MIN_READABLE_PX};
  const vw = window.innerWidth;
  const label = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    return tag + id + cls + (text ? ' "' + text + '"' : '');
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const tiny = { count: 0, samples: [] };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent || !node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < MIN) {
      tiny.count += 1;
      if (tiny.samples.length < 5) tiny.samples.push(size.toFixed(1) + 'px ' + label(el));
    }
  }

  // Content inside a box that scrolls sideways is not spilling — it is content
  // you slide to, which is exactly what a wide table on a phone is meant to do.
  // Without this the harness reported every cell of every list as a defect and
  // the real ones drowned.
  const insideAScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };

  const spilling = [];
  const clipped = [];
  let smallTargets = 0;
  const smallTargetKinds = {};
  const smallTargetSamples = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.left < vw && spilling.length < 8 && !insideAScroller(el)) {
      spilling.push(label(el));
    }
    const s = getComputedStyle(el);
    if (
      (s.overflowX === 'hidden' || s.overflow === 'hidden') &&
      s.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 2 &&
      el.children.length === 0 &&
      clipped.length < 8
    ) clipped.push(label(el));
    // Below 4px it is a visually-hidden input driven by a label you can see —
    // the label is the target, and counting the input calls a working control
    // a defect.
    if ((el.matches('a[href], button, input, select, textarea, [role=button]')) && r.height >= 4 && r.height < 24) {
      // A link wrapped around a button IS the button: its own line box is
      // 18px, but everything inside it is clickable, so the thing a thumb
      // lands on is as tall as the child. Counting the wrapper reports a
      // 34px button as a defect.
      let coveredByChild = false;
      for (const child of el.children) {
        if (child.getBoundingClientRect().height >= 24) { coveredByChild = true; break; }
      }
      if (coveredByChild) continue;
      smallTargets += 1;
      // A count alone cannot be acted on: "95 small targets" is a number, and
      // "the row links in the table" is a thing to fix.
      const kind = el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '');
      smallTargetKinds[kind] = (smallTargetKinds[kind] || 0) + 1;
      if (smallTargetSamples.length < 5) {
        smallTargetSamples.push(Math.round(r.height) + 'px ' + label(el));
      }
    }
  }

  // next-intl prints a missing key as "[ns.key]" — visible on the page, and
  // exactly the kind of thing a person notices after the accountant does.
  const missingKeys = [...new Set((document.body.innerText.match(/\\[[a-z]+(?:\\.[A-Za-z0-9_]+)+\\]/g) || []))].slice(0, 10);
  // A text field a person types a sentence into, drawn narrower than a
  // sentence: the builder's designation column was 60px wide on the laptop.
  // \`data-short\` marks a field that holds a code, not a sentence — a unit
  // ("ml"), a price reference ("3.1") — and 90px is the right width for one.
  const narrowInputs = [];
  for (const el of document.querySelectorAll('input[type=text]:not([name=unit]):not([data-short]):not([inputmode=decimal]), input:not([type]):not([name=unit]):not([data-short]):not([inputmode=decimal]), textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.width < 140 && narrowInputs.length < 8) narrowInputs.push(Math.round(r.width) + 'px ' + label(el));
  }
  const aside = document.querySelector('aside');
  const asideBottom = aside ? aside.getBoundingClientRect().bottom : 0;
  return {
    tiny,
    railCut: asideBottom > window.innerHeight + 1,
    missingKeys,
    narrowInputs,
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
    spilling,
    clipped,
    smallTargets,
    smallTargetKinds,
    smallTargetSamples,
  };
})()`;

function refuseUnlessTest() {
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error("screenshots seed and delete rows — point DATABASE_URL at the _test database");
  }
}

async function main() {
  refuseUnlessTest();
  const ctx = await auth.$context;
  const stamp = Date.now().toString().slice(-8);
  const created = await ctx.internalAdapter.createUser(
    { email: `shots-${stamp}@supserv.invalid`, name: ACTOR_NAME, emailVerified: true },
    ctx as never,
  );
  await db.insert(userRole).values({ userId: created.id, role: "gerant" });
  const minted = await ctx.internalAdapter.createSession(created.id, ctx as never);
  const signature = await makeSignature(minted.token, ctx.secret);
  const cookieName = ctx.authCookies.sessionToken.name;
  const cookieValue = `${minted.token}.${signature}`;

  const measures: Measure[] = [];
  let ids: Awaited<ReturnType<typeof seedWalk>> | null = null;

  try {
    ids = await seedWalk(created.id);
    const idFor = (route: string): string => {
      if (!ids) return NOWHERE;
      if (route.startsWith("/companies")) return ids.clientId;
      if (route.startsWith("/deals")) return ids.dealId;
      if (route.startsWith("/deliveries")) return ids.blId;
      if (route === "/documents/[id]/edit") return ids.draftInvoiceId;
      if (route === "/documents/[id]/convert") return ids.offerId;
      if (route.startsWith("/documents")) return ids.invoiceId;
      if (route.startsWith("/offers")) return ids.offerId;
      if (route.startsWith("/purchase-orders")) return ids.purchaseOrderId ?? NOWHERE;
      if (route.startsWith("/projects")) return ids.projectId;
      return NOWHERE;
    };

    // `--chrome <path>` uses a Chromium already on the machine rather than
    // downloading the exact build this Playwright version pins.
    const executablePath = arg("chrome", "") || undefined;
    const browser = await chromium.launch({ executablePath });
    for (const viewport of VIEWPORTS) {
      const dir = join(OUT, viewport.name);
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        locale: locale === "fr" ? "fr-DZ" : "en-GB",
      });
      // As a header rather than a jar cookie: the name carries a `__Secure-`
      // prefix the browser refuses to store over plain http on 127.0.0.1, and
      // the server only ever reads the header.
      await context.setExtraHTTPHeaders({ cookie: `${cookieName}=${cookieValue}` });
      const page = await context.newPage();

      for (const route of routes()) {
        if (route === "/sign-in") continue;
        const url = `${base}/${locale}${route.replace(/\[[^\]]+\]/g, idFor(route))}`;
        const file = `${route.replace(/^\//, "").replace(/[/[\]]+/g, "_") || "home"}.png`;
        let status = 0;
        try {
          const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
          status = response?.status() ?? 0;
          await page.screenshot({ path: join(dir, file), fullPage: true });
          const m = (await page.evaluate(MEASURE)) as Omit<Measure, "route" | "viewport" | "status">;
          measures.push({ route, viewport: viewport.name, status, ...m });
          const flags = [
            m.tiny.count ? `tiny×${m.tiny.count}` : "",
            m.horizontalOverflow ? `overflow+${m.horizontalOverflow}px` : "",
            m.railCut ? "rail-cut" : "",
            m.missingKeys.length ? `keys×${m.missingKeys.length}` : "",
            m.narrowInputs.length ? `narrow×${m.narrowInputs.length}` : "",
            m.spilling.length ? `spill×${m.spilling.length}` : "",
            m.clipped.length ? `clip×${m.clipped.length}` : "",
            m.smallTargets ? `small-targets×${m.smallTargets}` : "",
          ].filter(Boolean);
          console.log(`  ${viewport.name}  ${status}  ${route}  ${flags.join(" ")}`);
        } catch (error) {
          console.log(`  ${viewport.name}  DEAD ${route}  ${(error as Error).message.split("\n")[0]}`);
        }
      }
      await context.close();
    }
    await browser.close();
  } finally {
    await teardownWalk(created.id);
    await db.delete(session).where(eq(session.userId, created.id));
    await db.delete(userRole).where(eq(userRole.userId, created.id));
    await db.delete(user).where(eq(user.id, created.id));
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), JSON.stringify(measures, null, 2));

  const flagged = measures.filter(
    (m) =>
      m.tiny.count ||
      m.horizontalOverflow ||
      m.railCut ||
      m.missingKeys.length ||
      m.narrowInputs.length ||
      m.spilling.length ||
      m.clipped.length,
  );
  console.log(`\n${measures.length} screenshots in ${OUT}; ${flagged.length} pages flagged`);
  for (const m of flagged) {
    console.log(`\n${m.viewport}  ${m.route}`);
    if (m.tiny.count) console.log(`  ${m.tiny.count} text nodes under ${MIN_READABLE_PX}px: ${m.tiny.samples.join(" | ")}`);
    if (m.horizontalOverflow) console.log(`  page ${m.horizontalOverflow}px wider than the window`);
    if (m.railCut) console.log("  the navigation rail runs past the bottom of the window");
    if (m.missingKeys.length) console.log(`  untranslated: ${m.missingKeys.join(" ")}`);
    if (m.narrowInputs.length) console.log(`  narrow fields: ${m.narrowInputs.join(" | ")}`);
    if (m.spilling.length) console.log(`  spilling: ${m.spilling.join(" | ")}`);
    if (m.clipped.length) console.log(`  clipped: ${m.clipped.join(" | ")}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
