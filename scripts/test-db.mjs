import { spawnSync } from "node:child_process";
import { config } from "dotenv";

/**
 * Bring the TEST database up to the current migrations.
 *
 * The integration suite runs against `<database>_test`, never the application's
 * own — see `tests/setup-env.ts` for why that stopped being optional. This
 * script points `drizzle-kit migrate` at the same derived URL, so the two can
 * never drift apart into "tests pass, production has a column they do not know
 * about".
 *
 * Run by `pnpm test`. Also runnable alone after `pnpm db:generate`.
 *
 * The database itself has to exist first, once, with its two extensions:
 *
 *   docker exec supserv-db psql -U supserv -d postgres \
 *     -c "CREATE DATABASE supserv_test OWNER supserv;"
 *   docker exec supserv-db psql -U supserv -d supserv_test \
 *     -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;"
 *
 * pg_trgm and unaccent are not optional: search is the thing under test, and a
 * test database without them fails in a way that looks like a broken query.
 */
config({ path: ".env", quiet: true });

const app = process.env.DATABASE_URL;
if (!app) {
  console.error("DATABASE_URL is not set - see .env.example");
  process.exit(1);
}

const url = new URL(app);
const name = url.pathname.slice(1);
if (!name.endsWith("_test")) url.pathname = `/${name}_test`;

// Never printed. The database NAME is safe to show; the rest of the URL is not.
console.log(`migrating ${url.pathname.slice(1)}`);

const result = spawnSync("pnpm", ["drizzle-kit", "migrate"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: url.toString() },
});

process.exit(result.status ?? 1);
