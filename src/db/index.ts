import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as approval from "./schema/approval";
import * as authSchema from "./schema/auth";
import * as control from "./schema/control";
import * as delivery from "./schema/delivery";
import * as document from "./schema/document";
import * as iface from "./schema/interface";
import * as item from "./schema/item";
import * as note from "./schema/note";
import * as party from "./schema/party";

/**
 * All configuration lives in `.env` — never hardcoded, never clicked into a
 * control panel. See CLAUDE.md, "keeping migration cheap".
 *
 * One connection is reused across hot reloads in development; without this,
 * Next's module reloading opens a new pool on every edit and exhausts Postgres
 * on a machine with 8 GB.
 */
const globalForDb = globalThis as unknown as { conn?: ReturnType<typeof postgres> };

const conn =
  globalForDb.conn ?? postgres(process.env.DATABASE_URL as string, { max: 10, prepare: false });

if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const schema = {
  ...approval,
  ...authSchema,
  ...control,
  ...delivery,
  ...document,
  ...iface,
  ...item,
  ...note,
  ...party,
};

/**
 * How many queries have been sent, since somebody last asked.
 *
 * A page that opens in a fifth of a second on a mini PC with six users can
 * still be making ninety queries, and the way that happens is one function
 * calling another that quietly re-reads what the caller already had. Screen
 * 16 was doing exactly that: `getProject` composed the marché, and so did the
 * page, and so did the décompte — three times, each with its own round trip
 * per avenant.
 *
 * So the count is a measurement, not a feeling: `tests/integration/
 * query-budget.test.ts` holds each of the heavy reads to a ceiling, and a
 * change that doubles the work fails there rather than being noticed in a
 * year on a slower disk.
 */
let queries = 0;

export function queryCount(): number {
  return queries;
}

export function resetQueryCount(): void {
  queries = 0;
}

export const db = drizzle(conn, {
  schema,
  logger: {
    logQuery() {
      queries += 1;
    },
  },
});
