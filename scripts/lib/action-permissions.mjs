import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Every server action, and WHICH permission it asks for.
 *
 * `audit-actions.mjs` proves a check exists. That is the cheap half: an action
 * that checks `payments.record` before deleting a company passes it. This
 * reads out the permission each action actually names, so a test can hold the
 * list against a table a person wrote down — and changing what an action lets
 * through becomes an edit somebody has to make on purpose, in a file a
 * reviewer reads.
 */

const SESSION = /\bgetSession\s*\(/;
/** `can(role, "x")`, `canAny(role, ["x","y"])`, `canWrite(role)`, `mayIssue(role, kind)`. */
const CAN = /\bcan\s*\(\s*[\w.?]+\s*,\s*"([a-z][\w.]*)"/g;
const CAN_ANY = /\bcanAny\s*\(\s*[\w.?]+\s*,\s*\[([^\]]*)\]/g;
const CAN_WRITE = /\bcanWrite\s*\(/;
const MAY_ISSUE = /\bmayIssue\s*\(/;
/** Delegated to a domain function that decides on the caller's role — LAW 6. */
const DELEGATED = /\brole:\s*session\.role\b/;
/** Written in words: the action writes only the caller's rows, or writes nothing. */
const OWN_DATA = /own data|read only|writes nothing/;

/** Body of the function whose opening brace is at `start`. */
function bodyAt(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

function permissionsIn(body) {
  const found = new Set();
  for (const m of body.matchAll(CAN)) found.add(m[1]);
  for (const m of body.matchAll(CAN_ANY)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^["']|["']$/g, "");
      if (name) found.add(name);
    }
  }
  if (CAN_WRITE.test(body)) found.add("*write");
  if (MAY_ISSUE.test(body)) found.add("*issue");
  if (DELEGATED.test(body)) found.add("*caller");
  if (found.size === 0 && OWN_DATA.test(body)) found.add("*own");
  return [...found].sort();
}

export function readActionPermissions() {
  // `--untracked`: a brand-new action file is exactly the one most worth
  // auditing, and without this it is invisible until somebody stages it —
  // which is after the review, not before.
  const files = execSync('git grep -l --untracked "\\"use server\\"" -- src')
    .toString()
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    // Signing out and choosing a language act on the caller's own session and
    // nothing else; there is no permission to hold for either.
    .filter((f) => f !== "src/auth/actions.ts");

  const rows = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const fns = [...source.matchAll(/(export\s+)?async function (\w+)\s*\([^)]*\)[^{]*\{/g)];
    const bodies = new Map(fns.map((m) => [m[2], bodyAt(source, m.index + m[0].length - 1)]));

    // A helper in the same file counts: `async function actor() { … can(…) }`
    // called from the action is that action's check, one layer up.
    const helpers = [...bodies].filter(([name]) => !fns.find((m) => m[2] === name && m[1]));
    const calls = (body, name) => new RegExp(`\\b${name}\\s*\\(`).test(body);

    for (const m of fns) {
      if (!m[1]) continue;
      const own = bodies.get(m[2]) ?? "";
      let text = own;
      for (const [name, helperBody] of helpers) {
        if (name !== m[2] && calls(own, name)) text += `\n${helperBody}`;
      }
      rows.push({
        file: file.replace("src/app/[locale]/(app)/", "").replace("src/", ""),
        action: m[2],
        session: SESSION.test(text),
        permissions: permissionsIn(text),
      });
    }
  }
  return rows.sort((a, b) => `${a.file}:${a.action}`.localeCompare(`${b.file}:${b.action}`));
}
