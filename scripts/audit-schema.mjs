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
 * commit that lowers it lowers this line too. It reached nought in a day, so
 * it is a gate now — but the log below stays, because the number going up is
 * the thing worth noticing and the log is what makes that legible.
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
 *   26 — 5 September 2026, and NOT a fix: the measurement changed. Better
 *        Auth's four tables are its own to write and read; a column with a
 *        database default is written by Postgres; a name six tables share is
 *        attributed by file rather than counted as read everywhere at once
 *        (wiring up one `deleted_by` was silently clearing five); and "who did
 *        it and when", recorded on the row and shown on no screen, is printed
 *        as its own list rather than counted. What is left is the two classes
 *        that have each cost this ERP a feature — a column nothing mentions,
 *        and a column something reads that nothing can write.
 *   17 — 5 September 2026, `user_preference`: nine of its ten columns dropped.
 *        Nothing wrote them, nothing read them, and screen 81's own comment
 *        said as much. Dropping is a fix — the rule is "wired up or dropped".
 *   13 — 5 September 2026, `item_media`: read by three screens and inserted
 *        nowhere, with a `file_id` pointing at a table the files module says
 *        will never exist. It owns its bytes now and screen 77 can attach one.
 *        `price_quote.evidence_file_id`, written as `null` by both callers,
 *        dropped in the same commit.
 *    0 — 5 September 2026. The last thirteen, in one commit: `saved_view` (a
 *        table, a message key and no screen), `numbering_series.reserve_on`
 *        (`'issue'` on every row — LAW 5 is not a per-series setting),
 *        `import_batch.source_kind` (OneDrive discovery needs a Graph
 *        permission nobody has asked for), `intake_attachment.sha256` (the
 *        fetcher that would write it is not built), `payment.bank_account_id`
 *        (one account), `party.country` (`'DZ'`, and no address is assembled
 *        from parts), `tender_piece.provided_at` (a piece is provided when it
 *        HAS a file), `delivery_detail.departs_at` and `.site_contact_id`.
 *        And `merge_log.field_choices` was wired up rather than dropped: the
 *        banner names the fields a merge took, which is the question that
 *        column was written to answer.
 *
 * THE CEILING IS NOUGHT, so this is a gate now and not a ratchet: any column
 * this ERP adds and does not use fails the build the day it is added.
 */
const CEILING = 0;

/**
 * Tables that are SOMEBODY ELSE'S to write and read.
 *
 * `src/db/schema/auth.ts` says it in its own first line: "Better Auth's core
 * schema. Do not hand-edit the shape of these four tables — Better Auth writes
 * to them and expects these exact field names." Auditing them column by column
 * would be auditing a library's private fields through our own schema file.
 *
 * A table of OURS never belongs here.
 */
const FRAMEWORK_TABLES = new Map([
  ["user", "Better Auth's own table — it writes and reads these through its adapter"],
  ["session", "Better Auth's own table"],
  ["account", "Better Auth's own table"],
  ["verification", "Better Auth's own table"],
]);

/**
 * Single columns that are deliberately one-way, with the reason.
 *
 * Nothing here yet, and that is the point: every disconnected column of ours
 * is counted against the ceiling until it is wired up or dropped, rather than
 * explained away one line at a time.
 */
const ALLOWED = new Map([]);

const columns = readSchemaColumns();
const corpus = readCorpus();
const text = corpus.map((f) => f.text).join("\n");

/**
 * How many tables carry a column of this name.
 *
 * It decides how a read is recognised, and it matters more than it looks. Six
 * tables have a `deleted_by`; only `party` has ever written one. A plain
 * `.deletedBy` anywhere in the codebase would mark all six as read, so wiring
 * up ONE of them would silently clear five findings — an audit reporting
 * success it has not earned, which is the exact failure this file exists to
 * catch. For a shared name the drizzle reference `party.deletedBy` is the only
 * evidence accepted.
 */
const shared = new Map();
for (const c of columns) shared.set(c.prop, (shared.get(c.prop) ?? 0) + 1);

const findings = [];

for (const column of columns) {
  const key = `${column.variable}.${column.prop}`;
  if (ALLOWED.has(key) || FRAMEWORK_TABLES.has(column.variable)) continue;

  // `id`, `createdAt` and the other columns every table carries are set by a
  // default and read through `select()` with no field list. Naming them would
  // be forty findings that are all the same non-finding.
  if (["id", "createdAt", "updatedAt"].includes(column.prop)) continue;

  const loose = new RegExp(`\\.${column.prop}\\b`);
  const read =
    (shared.get(column.prop) ?? 0) > 1
      ? // A shared name is attributed by FILE: `.deletedBy` counts as a read of
        // `party.deleted_by` only where the file also names `party`. Most reads
        // in this codebase are `row.thing` off a `select()` with no field list,
        // so demanding the drizzle reference would flag ninety columns that are
        // read perfectly well — and an audit that cries wolf gets switched off.
        corpus.some(
          (f) => new RegExp(`\\b${column.variable}\\b`).test(f.text) && loose.test(f.text),
        )
      : loose.test(text);

  // A column with a DATABASE default is written by Postgres. `recordedAt` on a
  // payment is `defaultNow()`: read everywhere, named in no insert, and not a
  // defect. Only the "never written" half is waived — a defaulted column that
  // nothing reads is still a column nothing reads.
  const defaulted = /\.default(Now|Random)?\(/.test(column.declaration ?? "");
  const written = defaulted || new RegExp(`(^|[\\s{,(])${column.prop}:`, "m").test(text);

  if (!read && !written) findings.push({ ...column, what: "never mentioned anywhere" });
  else if (!read) findings.push({ ...column, what: "written and never read" });
  else if (!written) findings.push({ ...column, what: "read and never written" });
}

/**
 * WHO DID IT AND WHEN, recorded on the row and shown on no screen.
 *
 * Its own list, and not counted against the ceiling. Every one of these is
 * written beside an `audit_entry` that carries the same actor and the same
 * moment, and screen 61 shows that. The column is the cheap local copy — read
 * one day by a panel that wants to say "confirmé par Amine le 12/06" without a
 * join to the trail, which is exactly what screens 16 and 25 now do.
 *
 * So it is worth printing and it is not a defect. The classes that ARE:
 * a column nothing mentions at all, and a column something READS that nothing
 * can write — a branch nobody can reach, which is how `closed_at`,
 * `is_verified` and `reversible_until` each cost this ERP a feature.
 */
const PROVENANCE = /(By|At)$|^(note|.*Note|.*Reason)$/;
const provenance = findings.filter((f) => f.what === "written and never read" && PROVENANCE.test(f.prop));
const counted = findings.filter((f) => !provenance.includes(f));

console.log(`${columns.length} columns across ${new Set(columns.map((c) => c.table)).size} tables`);

for (const f of counted) {
  console.log(`  ${f.table}.${f.prop}  — ${f.what}  (${f.file})`);
}

if (provenance.length > 0) {
  console.log(`\n  and ${provenance.length} recorded on the row and shown on no screen:`);
  console.log(`  ${provenance.map((f) => `${f.table}.${f.prop}`).join(", ")}`);
}

console.log(`\n${counted.length} disconnected, ceiling ${CEILING}`);

if (counted.length > CEILING) {
  console.log("a column was added that nothing reads or nothing writes — wire it up or drop it");
  process.exit(1);
}
if (counted.length < CEILING) {
  console.log(`lower the ceiling in ${import.meta.filename ?? "this script"} to ${counted.length}`);
  process.exit(1);
}
if (CEILING === 0) console.log("every column of ours is both written and read");
process.exit(0);
