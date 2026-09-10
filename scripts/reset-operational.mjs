import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * Empty the ERP of everything a person or the mailbox put into it, and keep
 * everything that says how the ERP behaves.
 *
 * WHY THIS IS NOT `runSweep`. `src/domain/sweep.ts` is "clear my test data" and
 * it is a DISCARD — every row goes to the bin, stays restorable for thirty
 * days, and nothing leaves the database. That is the right tool for tidying a
 * live system and the wrong one for this job, because a discarded
 * `intake_message` still holds its Graph id, and the mailbox poll skips a
 * message it has already stored whether or not somebody binned it. A sweep
 * therefore cannot give you a fresh sync. This can, and the price is that it is
 * a real DELETE and there is no bin behind it.
 *
 * ─── THE ONE GUARD THAT MATTERS ───────────────────────────────────────────
 *
 * It refuses outright if any document has ever been given a number. LAW 5 says
 * an issued document is immutable and its series is never reused; a numbered
 * row means paper left the building, and no convenience is worth deleting the
 * only record of it. Discard it through the interface, or issue an avoir. This
 * script does not have an override, on purpose.
 *
 * ─── WHY THE TABLE LISTS ARE EXHAUSTIVE ───────────────────────────────────
 *
 * Every table in `public` must appear in WIPE or KEEP. A table in neither stops
 * the run and is named. That is what stops this script from quietly going stale
 * the first time somebody adds a schema file: the failure is a refusal to run,
 * not a reset that left a table full.
 *
 *   node scripts/reset-operational.mjs         report only, writes nothing
 *   node scripts/reset-operational.mjs --yes   do it
 *
 * Take a backup first: `powershell -File scripts/server/backup.ps1`.
 */

config({ path: ".env", quiet: true });

const commit = process.argv.includes("--yes");

/** Everything a person typed, the mailbox delivered, or the system derived. */
const WIPE = [
  // the commercial record
  "deal",
  "deal_line",
  "tender",
  "tender_piece",
  "bpu_erratum",
  "bpu_mapping",
  // documents and everything hanging off one
  "document",
  "document_line",
  "document_link",
  "amendment_detail",
  "situation_detail",
  "delivery_detail",
  // who we deal with
  "party",
  "party_alias",
  "party_role",
  "person",
  "person_certification",
  // sites
  "project",
  "project_caution",
  "project_crew",
  // money
  "payment",
  "payment_allocation",
  "relance",
  // buying
  "sourcing_request",
  "sourcing_line",
  "sourcing_response",
  "price_quote",
  // hiring
  "personnel_request",
  "personnel_candidate",
  // the mailbox, and everything read out of it
  "intake_message",
  "intake_attachment",
  "intake_dossier",
  "intake_page",
  "extraction_field",
  "duplicate_dismissal",
  // imports
  "import_batch",
  "import_record",
  // the trail and the loose ends
  "note",
  "approval_request",
  "audit_entry",
  "merge_log",
  "assistant_proposal",
  "notification_read",
];

/**
 * How the ERP behaves, and who is allowed to open it. None of this is data a
 * person typed ABOUT the business; all of it is configuration, and losing it
 * would mean setting the system up again before the first test.
 *
 * `routing_rule` and `intake_channel` are in here for a specific reason: they
 * are what the mailbox poll classifies against, and a fresh sync into a system
 * with no rules would file every message as "needs review".
 */
const KEEP = [
  /*
    Our own company, not a counterparty. Screen 85 calls these "what the system
    will not invent for you" — the RC, NIF, NIS and article d'imposition typed
    once off the paper, the bank and RIB printed on every invoice as the
    domiciliation, and the company's own CNAS, CASNOS, extrait de role and
    certificat de qualification with the expiry dates a bid is thrown out over.
    Wiping these would send you back through day one for nothing.
  */
  "company_identity",
  "bank_account",
  "company_credential",
  /*
    The relance policy, and its own schema comment settles it: "Data, not code."
    It is the ladder of steps set in Settings — reminder at 7 days, phone call,
    mise en demeure — not a record of anybody having been chased. The chases
    themselves are `relance`, and those go.
  */
  "relance_step",
  // auth — the session rows stay so the reset does not sign you out
  "user",
  "user_role",
  "user_preference",
  "account",
  "session",
  "verification",
  // preferences
  "notification_pref",
  "table_preference",
  // rules the system enforces
  "approval_gate",
  "blocking_rule",
  "routing_rule",
  "intake_channel",
  // how documents are shaped and numbered
  "numbering_series",
  "document_type",
  "document_template",
  "email_template",
  "vat_rate",
  // the catalogue — what we sell, not who we sold it to
  "item",
  "item_alias",
  "item_coverage",
  "item_media",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  // ── every table must be accounted for ───────────────────────────────────
  const present = (
    await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `
  )
    .map((r) => r.table_name)
    .filter((t) => t !== "__drizzle_migrations");

  const known = new Set([...WIPE, ...KEEP]);
  const unaccounted = present.filter((t) => !known.has(t));
  if (unaccounted.length > 0) {
    console.error("refusing: these tables are in neither WIPE nor KEEP —");
    for (const t of unaccounted) console.error(`  ${t}`);
    console.error("\nadd each one to a list in this file and run again.");
    process.exit(1);
  }

  const missing = [...known].filter((t) => !present.includes(t));
  if (missing.length > 0) {
    console.error("refusing: these tables are listed here and not in the database —");
    for (const t of missing) console.error(`  ${t}`);
    process.exit(1);
  }

  // ── LAW 5 ───────────────────────────────────────────────────────────────
  const [{ n: issued }] = await sql`
    select count(*)::int as n from document where number is not null
  `;
  if (issued > 0) {
    console.error(
      `refusing: ${issued} document(s) carry a number.\n` +
        "A numbered document is paper somebody else holds a copy of, and LAW 5\n" +
        "says it is immutable. There is no override here. Cancel it by avoir or\n" +
        "discard it through the interface, then run this again.",
    );
    process.exit(1);
  }

  // ── what is there now ───────────────────────────────────────────────────
  console.log(commit ? "=== RESETTING" : "=== report only — nothing will be written");
  console.log(`database: ${new URL(url).pathname.slice(1)}\n`);

  let total = 0;
  const rows = [];
  for (const table of WIPE) {
    const [{ n }] = await sql`select count(*)::int as n from ${sql(table)}`;
    total += n;
    if (n > 0) rows.push([table, n]);
  }
  console.log("--- to be deleted ---");
  if (rows.length === 0) console.log("  nothing; the database is already empty");
  for (const [table, n] of rows) console.log(`  ${String(n).padStart(6)}  ${table}`);
  console.log(`  ${String(total).padStart(6)}  TOTAL\n`);

  let kept = 0;
  const keptRows = [];
  for (const table of KEEP) {
    const [{ n }] = await sql`select count(*)::int as n from ${sql(table)}`;
    kept += n;
    if (n > 0) keptRows.push([table, n]);
  }
  console.log("--- kept ---");
  for (const [table, n] of keptRows) console.log(`  ${String(n).padStart(6)}  ${table}`);
  console.log(`  ${String(kept).padStart(6)}  TOTAL\n`);

  // ── the file store ──────────────────────────────────────────────────────
  const filesRoot = resolve(process.cwd(), ".data", "files");
  let fileCount = 0;
  let fileBytes = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else {
        fileCount += 1;
        fileBytes += s.size;
      }
    }
  };
  walk(filesRoot);
  console.log("--- working files ---");
  console.log(`  ${fileCount} files, ${(fileBytes / 1_048_576).toFixed(1)} MB in .data\\files\n`);

  // ── the job queue ───────────────────────────────────────────────────────
  const [pgboss] = await sql`
    select count(*)::int as n from information_schema.schemata where schema_name = 'pgboss'
  `;
  let jobs = 0;
  if (pgboss.n > 0) {
    const [{ n }] = await sql`select count(*)::int as n from pgboss.job`;
    jobs = n;
    console.log(`--- queued jobs ---\n  ${jobs} in pgboss.job\n`);
  }

  if (!commit) {
    console.log("run again with --yes to do it. Take a backup first.");
    await sql.end();
    process.exit(0);
  }

  // ── do it ───────────────────────────────────────────────────────────────
  // One statement, CASCADE, so foreign keys decide the order rather than this
  // file getting it subtly wrong. RESTART IDENTITY resets every serial; the
  // deal reference needs no help — `nextDealRef` reads max(deal.ref), so an
  // empty table already means ENQ-2026-0001.
  await sql.unsafe(
    `truncate table ${WIPE.map((t) => `public."${t}"`).join(", ")} restart identity cascade`,
  );
  console.log(`deleted ${total} rows across ${WIPE.length} tables`);

  if (pgboss.n > 0 && jobs > 0) {
    await sql`delete from pgboss.job`;
    console.log(`cleared ${jobs} queued jobs`);
  }

  if (existsSync(filesRoot)) {
    for (const entry of readdirSync(filesRoot)) {
      rmSync(join(filesRoot, entry), { recursive: true, force: true });
    }
    console.log(`removed ${fileCount} working files`);
  }

  // ── prove it ────────────────────────────────────────────────────────────
  let left = 0;
  for (const table of WIPE) {
    const [{ n }] = await sql`select count(*)::int as n from ${sql(table)}`;
    left += n;
  }

  /*
    CASCADE follows foreign keys, and a foreign key can point from a KEEP table
    into a WIPE one. On the first real run (10 September 2026) the truncate
    cascaded into `item_alias`, `item_coverage` and `item_media` — the
    catalogue, which is KEEP — and cost nothing only because all three were
    empty. With a catalogue loaded it would have silently emptied it.

    So the kept rows are counted again and a difference stops the run loudly.
    The fix when this fires is to add the cascaded table to WIPE if it really is
    operational, or to break the foreign key if it is not; it is never to
    delete this check.
  */
  const shrunk = [];
  for (const [table, before] of keptRows) {
    const [{ n }] = await sql`select count(*)::int as n from ${sql(table)}`;
    if (n !== before) shrunk.push([table, before, n]);
  }

  console.log(`\n=== done — ${left} rows left in the wiped tables, ${kept} kept`);
  if (left > 0) {
    console.error("that is not zero. Something re-inserted while this ran.");
    process.exit(1);
  }
  if (shrunk.length > 0) {
    console.error("\nKEPT TABLES LOST ROWS — the truncate cascaded into them:");
    for (const [table, before, after] of shrunk) {
      console.error(`  ${table}: ${before} -> ${after}`);
    }
    console.error("\nRestore from the backup and fix the lists before running again.");
    process.exit(1);
  }
  console.log("The next mailbox poll has no watermark, so it reaches back thirty days.");
} finally {
  await sql.end({ timeout: 5 });
}
