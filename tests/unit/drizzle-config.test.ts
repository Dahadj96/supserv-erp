import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `drizzle.config.ts` reads `.env` itself.
 *
 * `drizzle-kit` is a binary, not a `next` process, so nothing loads `.env` for
 * it. Without that line `pnpm db:migrate` runs with no `DATABASE_URL` — and
 * drizzle-kit reports the connection failure as a spinner that stops and an
 * exit code, with no message printed at all. An afternoon went into finding
 * that, which is why it is pinned here.
 *
 * The second test is the more important one: `scripts/test-db.mjs` derives
 * `<database>_test` and passes it in the environment, and if the config file
 * overwrote that from `.env` then `pnpm test` would migrate and truncate the
 * APPLICATION database. dotenv does not overwrite — this asserts it stays that
 * way through an upgrade.
 */
/**
 * `Config` is a union across six dialects and `dbCredentials` is not on every
 * arm of it, so the field this file is about is read through the shape it
 * actually has rather than through the union.
 */
async function loadConfig(): Promise<{ dbCredentials?: { url?: string } }> {
  return (await import("../../drizzle.config")).default as { dbCredentials?: { url?: string } };
}

describe("drizzle.config.ts", () => {
  const before = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  });

  it("finds a database url with nothing set in the environment", async () => {
    delete process.env.DATABASE_URL;
    const config = await loadConfig();
    // The value itself is a credential and is never printed.
    expect(typeof config.dbCredentials?.url).toBe("string");
    expect(config.dbCredentials?.url).not.toBe("");
  });

  it("does not overwrite one already set — this is what keeps `pnpm test` off the application database", async () => {
    process.env.DATABASE_URL = "postgres://someone:secret@localhost:5432/sentinel_test";
    const config = await loadConfig();
    expect(config.dbCredentials?.url).toBe(
      "postgres://someone:secret@localhost:5432/sentinel_test",
    );
  });
});
