import { readActionPermissions } from "./lib/action-permissions.mjs";

/**
 * Every server action, and whether it (a) asks who is calling and (b) asks
 * whether they may. Static, so it is cheap and runs in CI; it cannot prove the
 * check is RIGHT, only that one exists — which is the class of bug that
 * matters most: an action anybody signed in can call because nobody wrote the
 * line.
 *
 *   node scripts/audit-actions.mjs          # lists the gaps, exits 1 if any
 *
 * The other half — WHICH permission each action asks for — is
 * `tests/unit/action-permissions.test.ts`, which holds all of them against a
 * table a person wrote down. That is what catches a check that exists, passes
 * this script, and guards the wrong thing.
 */
const rows = readActionPermissions();
const files = new Set(rows.map((r) => r.file));

const gaps = rows.filter((r) => !r.session || r.permissions.length === 0);

console.log(`${rows.length} server actions in ${files.size} files`);
if (gaps.length === 0) {
  console.log("every action checks the session and a permission");
  process.exit(0);
}
for (const g of gaps) {
  const why = [g.session ? "" : "no session check", g.permissions.length ? "" : "no permission check"]
    .filter(Boolean)
    .join(", ");
  console.log(`  ${g.file} :: ${g.action}  — ${why}`);
}
console.log(`\n${gaps.length} to look at`);
process.exit(1);
