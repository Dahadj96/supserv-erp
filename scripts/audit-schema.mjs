import { readCorpus, readSchemaColumns } from "./lib/schema-columns.mjs";

/**
 * Every column, and whether anything reads it and anything writes it.
 *
 * The third audit, against the class of bug the first two cannot see. One asks
 * whether an action checks who is calling; the second whether a field a person
 * filled in goes anywhere. This one asks whether a column the database carries
 * is connected to the application at all.
 *
 * It exists because `project.closed_at` was read in three places and written in
 * none. Nothing failed. No test went red. The only symptom was that no marché
 * could ever leave the warranty — 138 260 DZD on the test data that the ERP
 * would have drawn as outstanding for ever, because the branch that ends a
 * warranty was reading a column nobody could set.
 *
 *   node scripts/audit-schema.mjs      # lists the gaps, exits 1 on a new one
 *
 * READ means `.prop` appears somewhere outside the schema — `project.closedAt`
 * in a where clause, `row.closedAt` off a `select()` with no field list, which
 * is how most of this codebase reads. Deliberately loose: two tables with a
 * `note` column cannot be told apart this way, and a column wrongly called
 * read is a finding this audit misses. A column wrongly called UNREAD would be
 * a false alarm, and an audit that cries wolf gets switched off.
 *
 * WRITTEN means `prop:` appears as an object key outside the schema — which is
 * what an insert's `.values({ … })` and an update's `.set({ … })` look like.
 */

/**
 * How many disconnected columns this database is allowed to have.
 *
 * A RATCHET, not a target. The same discipline as the query budgets: the
 * number is what was measured, it fails the build when it grows, and every
 * commit that lowers it lowers this line too. When it reaches nought this
 * script joins `pnpm check` as a gate rather than a ceiling.
 *
 *   56 — 5 September 2026, the day it was written
 *   54 — 5 September 2026, `project.physical_by` and `physical_at`: who gave
 *        the estimate and when, recorded since the table was written and shown
 *        on no screen, which turned one man's guess into something the system
 *        appeared to assert
 *   50 — 5 September 2026, `person_certification`: nothing in the application
 *        could write a man's tickets at all, and `is_verified` was a boolean no
 *        screen could set, so every habilitation in the company read "Non
 *        contrôlée" for ever
 *   45 — 5 September 2026, `merge_log`: the whole table was written and read by
 *        nothing, including `reversible_until` — a promise the schema made
 *        about the one operation here that rewrites a record people rely on,
 *        and that the system could not keep
 */
const CEILING = 45;

/**
 * Columns that are deliberately one-way, with the reason.
 *
 * Only for columns that are SOMEBODY ELSE'S to write or read. A column of ours
 * that nothing touches is not allowed here; it is counted against the ceiling
 * until it is either wired up or dropped.
 */
const ALLOWED = new Map([
  // Written by the framework, read by the framework. Better Auth owns these
  // rows; the application never touches the columns by name.
  ["session.token", "Better Auth writes and reads it through its own adapter"],
  ["session.ipAddress", "Better Auth's own column"],
  ["session.userAgent", "Better Auth's own column"],
  ["account.accessToken", "Better Auth's own column"],
  ["account.refreshToken", "Better Auth's own column"],
  ["account.idToken", "Better Auth's own column"],
  ["account.accessTokenExpiresAt", "Better Auth's own column"],
  ["account.refreshTokenExpiresAt", "Better Auth's own column"],
  ["account.scope", "Better Auth's own column"],
  ["account.password", "Better Auth's own column, and never read by us"],
  ["verification.identifier", "Better Auth's own column"],
  ["verification.value", "Better Auth's own column"],
  ["verification.expiresAt", "Better Auth's own column"],
]);

const columns = readSchemaColumns();
const corpus = readCorpus();
const text = corpus.map((f) => f.text).join("\n");

const findings = [];

for (const column of columns) {
  const key = `${column.variable}.${column.prop}`;
  if (ALLOWED.has(key)) continue;

  // `id`, `createdAt` and the other columns every table carries are set by a
  // default and read through `select()` with no field list. Naming them would
  // be forty findings that are all the same non-finding.
  if (["id", "createdAt", "updatedAt"].includes(column.prop)) continue;

  const read = new RegExp(`\\.${column.prop}\\b`).test(text);
  const written = new RegExp(`(^|[\\s{,(])${column.prop}:`, "m").test(text);

  if (!read && !written) findings.push({ ...column, what: "never mentioned anywhere" });
  else if (!read) findings.push({ ...column, what: "written and never read" });
  else if (!written) findings.push({ ...column, what: "read and never written" });
}

console.log(`${columns.length} columns across ${new Set(columns.map((c) => c.table)).size} tables`);

if (findings.length === 0) {
  console.log("every column is both written and read");
  if (CEILING > 0) {
    console.log(`the ceiling is ${CEILING} and nothing is left — put this script in pnpm check`);
    process.exit(1);
  }
  process.exit(0);
}

for (const f of findings) {
  console.log(`  ${f.table}.${f.prop}  — ${f.what}  (${f.file})`);
}

console.log(`\n${findings.length} disconnected, ceiling ${CEILING}`);

if (findings.length > CEILING) {
  console.log("a column was added that nothing reads or nothing writes — wire it up or drop it");
  process.exit(1);
}
if (findings.length < CEILING) {
  console.log(`lower the ceiling in ${import.meta.filename ?? "this script"} to ${findings.length}`);
  process.exit(1);
}
process.exit(0);
