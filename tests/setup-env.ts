import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

/**
 * The integration suite gets its OWN database, and cannot be talked out of it.
 *
 * It used to read `DATABASE_URL` from the same `.env` the app uses — the
 * comment on this file said so, as if it were a design. It was a loaded gun.
 * The integration tests insert and delete real rows, and three of them wrote to
 * `company_identity` and `numbering_series`: the row that carries the RC, NIF,
 * NIS and AI printed on every invoice, and the counter that says which invoice
 * number comes next.
 *
 * It never fired, and only for one reason: day one has never been done, so
 * those tables were empty every time. `engine.test.ts` used `kind = "invoice"`
 * and deleted that series on teardown; `setup.test.ts` set `ai` to null and
 * never put it back. Both would have hit real data the first time somebody
 * filled in the company details and then ran the tests — which is to say, on
 * the first ordinary Tuesday after the setup wizard was finished.
 *
 * So: a separate database, derived from the app's URL by swapping the database
 * name, and a hard refusal if that swap did not happen. Nothing to configure,
 * nothing to remember, and no way to run the suite against the real thing by
 * forgetting a flag.
 */
config({ path: ".env", quiet: true });

const SUFFIX = "_test";

function testDatabaseUrl(appUrl: string): string {
  const url = new URL(appUrl);
  const name = url.pathname.slice(1);

  // Already pointed somewhere safe (CI, a throwaway container): leave it.
  if (name.endsWith(SUFFIX)) return appUrl;

  url.pathname = `/${name}${SUFFIX}`;
  return url.toString();
}

const app = process.env.DATABASE_URL;
if (!app) {
  throw new Error("DATABASE_URL is not set — tests need .env, see .env.example");
}

const test = testDatabaseUrl(app);

// The guard. Not a comment asking people to be careful: the suite does not
// start if the two are the same string. Error text carries no credentials.
if (test === app && !new URL(app).pathname.endsWith(SUFFIX)) {
  throw new Error("refusing to run tests against the application database");
}

process.env.DATABASE_URL = test;

/**
 * Bytes go somewhere disposable too.
 *
 * Screen 66 walks the working store and reports files no row claims. On the day
 * it was built it found 131 of them, 87 kB, every one written by a dossier test
 * whose rows were then cleaned up — the suite had been quietly littering the
 * production file store for a fortnight. The report was right; the tests were
 * writing where the real attachments live.
 */
const bytes = resolve(process.cwd(), ".data", "test-files");
mkdirSync(bytes, { recursive: true });
process.env.STORAGE_LOCAL_PATH = bytes;
