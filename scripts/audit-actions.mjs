import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Every server action, and whether it (a) asks who is calling and (b) asks
 * whether they may. Static, so it is cheap and runs in CI; it cannot prove the
 * check is RIGHT, only that one exists — which is the class of bug that
 * matters most: an action anybody signed in can call because nobody wrote the
 * line.
 *
 *   node scripts/audit-actions.mjs          # lists the gaps, exits 1 if any
 *
 * A helper counts: `async function actor() { const s = await getSession() … }`
 * called from the action is a session check, and `can(`/`mayIssue(` inside
 * that helper is a permission check for every action that calls it.
 */
const files = execSync('git grep -l "\\"use server\\"" -- src').toString().trim().split(/\r?\n/);

const SESSION = /\bgetSession\s*\(/;
/**
 * A check made here, or delegated: `role: session.role` handed to a domain
 * function is the approval gates and the assistant deciding on the caller's
 * role (LAW 6), which is a permission check made one layer down.
 */
const PERMISSION = /\b(can|canAny|canWrite|mayIssue)\s*\(|\brole\s*(===|!==|in\b)|\brole: session\.role\b/;
/**
 * Two things an action may say instead of naming a permission: "own data" —
 * it writes only rows keyed on the caller — and "read only" — it writes nothing.
 */
const OWN_DATA = /own data|read only|writes nothing/;

let total = 0;
const gaps = [];

for (const file of files) {
  // Signing out and choosing a language act on the caller's own session and
  // nothing else; there is no permission to hold for either.
  if (file === "src/auth/actions.ts") continue;
  const source = readFileSync(file, "utf8");
  const fns = [...source.matchAll(/(export\s+)?async function (\w+)\s*\([^)]*\)[^{]*\{/g)];

  // Body of each function: from its opening brace to the matching close.
  const bodyOf = (start) => {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    return source.slice(start);
  };
  const bodies = new Map(fns.map((m) => [m[2], bodyOf(m.index + m[0].length - 1)]));

  const helpersWithSession = [...bodies].filter(([, b]) => SESSION.test(b)).map(([n]) => n);
  const helpersWithPermission = [...bodies]
    .filter(([, b]) => PERMISSION.test(b) || OWN_DATA.test(b))
    .map(([n]) => n);
  const calls = (body, names) => names.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));

  for (const m of fns) {
    if (!m[1]) continue;
    total++;
    const body = bodies.get(m[2]) ?? "";
    const session = SESSION.test(body) || calls(body, helpersWithSession);
    const permission =
      PERMISSION.test(body) || OWN_DATA.test(body) || calls(body, helpersWithPermission);
    if (!session || !permission) {
      gaps.push({ file, action: m[2], session, permission });
    }
  }
}

console.log(`${total} server actions in ${files.length} files`);
if (gaps.length === 0) {
  console.log("every action checks the session and a permission");
  process.exit(0);
}
for (const g of gaps) {
  const why = [g.session ? "" : "no session check", g.permission ? "" : "no permission check"]
    .filter(Boolean)
    .join(", ");
  console.log(`  ${g.file.replace("src/app/[locale]/(app)/", "")} :: ${g.action}  — ${why}`);
}
console.log(`\n${gaps.length} to look at`);
process.exit(1);
