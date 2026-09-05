import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The routes that answer with BYTES, and who may have them.
 *
 * `pnpm smoke` proves every SCREEN sends a signed-out visitor to sign-in: the
 * `(app)` layout checks the session once and every page under it inherits that.
 * A route handler has no layout above it. `/api/files/[id]` returns an invoice
 * a client sent us and `/api/documents/[id]/pdf` returns one we are about to
 * send; both are one forgotten line away from being readable by anybody who can
 * reach the tunnel.
 *
 * So this reads them, statically, and holds each one to two things: it asks who
 * is calling, and it refuses when the answer is nobody. It cannot prove the
 * check runs first — that is what the 401 assertion in `pnpm smoke` is for —
 * but it cannot be forgotten either, and a new route handler joins the list the
 * moment somebody writes it.
 */
const API = "src/app/api";

/**
 * Better Auth's own endpoints. Sign-in MUST be reachable signed out, which is
 * the whole point of it, and the library owns what that handler does.
 */
const PUBLIC = new Set(["src/app/api/auth/[...all]/route.ts"]);

function routeFiles(dir = API): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...routeFiles(path));
    else if (entry.name === "route.ts") out.push(path);
  }
  return out;
}

const routes = routeFiles().map((path) => ({
  path,
  source: readFileSync(join(process.cwd(), path), "utf8"),
}));

describe("what the API routes give away", () => {
  it("finds the route handlers at all — a reader that found none would pass everything", () => {
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(routes.map((r) => r.path)).toContain("src/app/api/files/[id]/route.ts");
  });

  it("asks who is calling, on every handler that is not the sign-in endpoint", () => {
    const open = routes
      .filter((r) => !PUBLIC.has(r.path))
      .filter((r) => !/\bgetSession\s*\(/.test(r.source))
      .map((r) => r.path);
    expect(open, "a route handler that never asks who is calling").toEqual([]);
  });

  it("refuses when the answer is nobody", () => {
    // 401 in words, not a redirect: these return bytes to something that is
    // usually not a browser, and a 302 to a sign-in page would be delivered as
    // the file.
    const lax = routes
      .filter((r) => !PUBLIC.has(r.path))
      .filter((r) => !/status:\s*401/.test(r.source))
      .map((r) => r.path);
    expect(lax, "a route handler that does not refuse an unauthenticated caller").toEqual([]);
  });

  it("keeps the bytes out of shared caches", () => {
    // A response that passed a permission check must not be held by anything
    // that would serve it to somebody who did not pass one.
    const cached = routes
      .filter((r) => !PUBLIC.has(r.path))
      .filter((r) => !/cache-control["']?\s*:\s*["'](private, )?no-store/.test(r.source))
      .map((r) => r.path);
    expect(cached, "a route handler whose response may be cached").toEqual([]);
  });
});
