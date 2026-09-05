import { config as dotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

/*
  READS `.env` ITSELF, because `drizzle-kit` is a binary and not a `next`
  process: without this, `pnpm db:migrate` runs with no `DATABASE_URL` and
  drizzle-kit reports the connection failure as a spinner that stops and an
  exit code, with no message at all. An afternoon was lost to that once.

  dotenv does not overwrite a variable that is already set, so
  `scripts/test-db.mjs` — which passes the derived `<database>_test` URL in the
  environment — still wins, and `pnpm test` still cannot touch the application
  database.
*/
dotenv({ path: ".env", quiet: true });

export default defineConfig({
  schema: "./src/db/schema/*.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
