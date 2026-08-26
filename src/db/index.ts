import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as approval from "./schema/approval";
import * as authSchema from "./schema/auth";
import * as control from "./schema/control";
import * as delivery from "./schema/delivery";
import * as document from "./schema/document";
import * as iface from "./schema/interface";
import * as item from "./schema/item";
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
  ...party,
};

export const db = drizzle(conn, { schema });
