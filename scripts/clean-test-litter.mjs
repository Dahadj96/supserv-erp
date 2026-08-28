import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * Remove what the integration suite left in the APPLICATION database and file
 * store while it was pointed at them.
 *
 * Until `tests/setup-env.ts` was fixed, `pnpm test` ran against `supserv` and
 * wrote into `.data/files`. Nothing was destroyed — day one had never been
 * done, so the tables the tests overwrite were empty — but the litter is real:
 * audit rows for records that never existed, and dossier bytes whose rows were
 * cleaned up around them.
 *
 * DELETING AUDIT ROWS IS NOT NORMAL. An audit entry is supposed to outlive the
 * record it describes; that is the entire argument in `src/domain/control/audit.ts`.
 * The exception here is narrow and checkable: every row this touches has an
 * `actor_id` beginning `test-`, which is a fixture constant and can never be an
 * Entra user id. If that predicate ever stops being true, this script stops
 * being safe, and it should be deleted rather than loosened.
 *
 * Reports by default. Pass --yes to actually remove.
 */
config({ path: ".env", quiet: true });

const commit = process.argv.includes("--yes");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (new URL(url).pathname.endsWith("_test")) {
  console.error("this points at the test database; there is nothing to clean there");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const [{ n: auditRows }] = await sql`
  select count(*)::int n from audit_entry where actor_id like 'test-%'
`;
const [{ n: auditTotal }] = await sql`select count(*)::int n from audit_entry`;

// The working store, as `src/storage/local.ts` resolves it.
const configured = process.env.STORAGE_LOCAL_PATH;
const root =
  configured && /^([a-zA-Z]:[\\/]|\\\\)/.test(configured)
    ? configured
    : resolve(process.cwd(), ".data", "files");

function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push({ path: full, bytes: statSync(full).size });
  }
  return out;
}

const claimed = new Set(
  (
    await sql`
      select storage_path p from intake_attachment where storage_path is not null and storage_path <> ''
      union all
      select storage_path p from intake_dossier where storage_path is not null and storage_path <> ''
    `
  ).map((r) => resolve(root, r.p)),
);

const orphaned = walk(root).filter((f) => !claimed.has(resolve(f.path)));
const orphanBytes = orphaned.reduce((sum, f) => sum + f.bytes, 0);

console.log(`audit_entry   ${auditRows} of ${auditTotal} rows written by test fixtures`);
console.log(`working store ${orphaned.length} files (${orphanBytes} bytes) no row claims`);
console.log(`root          ${root}`);

if (!commit) {
  console.log("\nnothing removed. re-run with --yes to remove.");
  await sql.end();
  process.exit(0);
}

const removed = await sql`delete from audit_entry where actor_id like 'test-%' returning id`;
for (const file of orphaned) rmSync(file.path, { force: true });

console.log(`\nremoved ${removed.length} audit rows and ${orphaned.length} files.`);
await sql.end();
