import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `<form action={someAction…}>` in the app, the field names inside it,
 * and the names the action it posts to actually reads.
 *
 * Static and deliberately shallow. It does not understand JSX; it finds the
 * form's opening tag, takes everything up to the matching `</form>`, and pulls
 * `name="…"` and `name={`…`}` out of it. That is enough to answer the one
 * question worth asking of a form: is there an input whose value nobody ever
 * looks at? A field that is typed, submitted and silently dropped is the worst
 * kind of bug in an ERP, because the person watched themselves fill it in.
 */

const APP = "src/app";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** `action={foo.bind(null, a, b)}` or `action={foo}` → "foo". */
function actionName(tag) {
  const bound = tag.match(/action=\{\s*([A-Za-z0-9_$]+)\s*\.bind\b/);
  if (bound) return bound[1];
  const plain = tag.match(/action=\{\s*([A-Za-z0-9_$]+)\s*\}/);
  return plain ? plain[1] : null;
}

/**
 * Field names in a chunk of JSX.
 *
 * A literal `name="workDone"` is a name. A template `name={`qty:${id}`}` is a
 * PREFIX — the action reads those with a loop over `form.entries()`, so the
 * prefix is what has to be looked for in the action's source.
 */
function fieldsIn(chunk) {
  const literal = [...chunk.matchAll(/\bname="([^"]+)"/g)].map((m) => ({
    name: m[1],
    kind: "literal",
  }));
  const templated = [...chunk.matchAll(/\bname=\{`([^`$]*)\$\{/g)].map((m) => ({
    name: m[1],
    kind: "prefix",
  }));
  return [...literal, ...templated];
}

/** The forms of one file, with their fields. */
function formsIn(source) {
  const forms = [];
  const opens = [...source.matchAll(/<form\b/g)].map((m) => m.index ?? 0);
  for (const at of opens) {
    const close = source.indexOf("</form>", at);
    const body = source.slice(at, close === -1 ? source.length : close);
    const tagEnd = body.indexOf(">");
    const tag = body.slice(0, tagEnd === -1 ? body.length : tagEnd + 1);
    const action = actionName(tag);
    if (!action) continue;
    forms.push({ action, fields: fieldsIn(body) });
  }
  return forms;
}

/** Where an imported action lives, so its source can be read. */
function importedFrom(source, name, file) {
  const rx = new RegExp(
    `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`,
    "s",
  );
  const m = source.match(rx);
  if (!m) return null;
  const spec = m[1];
  const base = spec.startsWith("@/")
    ? join("src", spec.slice(2))
    : join(file, "..", spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not that one
    }
  }
  return null;
}

/**
 * The body of one exported action, from its `export async function NAME` to
 * the next top-level `export` — enough to see every `form.get`, `str(form,…)`
 * and `key.startsWith(…)` it uses.
 */
function actionBody(source, name) {
  const at = source.search(new RegExp(`export\\s+async\\s+function\\s+${name}\\b`));
  if (at === -1) return null;
  const rest = source.slice(at + 1);
  const next = rest.search(/\nexport\s/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Names read anywhere in a file, and the helpers a file uses that read names
 * of their own. `changes(form)` reads `newQty:` — the loop is in the helper,
 * not in the action, so the whole file is searched for a prefix.
 */
function readsName(actionSource, fileSource, field) {
  const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (field.kind === "prefix") {
    // `add.designation.` is read by a loop that matches `add.` and then splits
    // the rest, so the FIRST segment is what appears quoted in the source —
    // and every segment after it appears as a word, because that is how the
    // action picks the value out. Both, or the name is going nowhere.
    const segments = field.name.split(/[.:]/).filter(Boolean);
    const [first, ...rest] = segments;
    if (!first) return true;

    const head =
      new RegExp(`["'\`]${quote(first)}[.:]?["'\`]?`).test(fileSource) ||
      new RegExp(`["'\`]${quote(field.name)}`).test(fileSource);
    const tail = rest.every((part) => new RegExp(`\\b${quote(part)}\\b`).test(fileSource));
    return head && tail;
  }

  const rx = new RegExp(`["'\`]${quote(field.name)}["'\`]`);
  return rx.test(actionSource) || rx.test(fileSource);
}

export function readFormFields() {
  const rows = [];
  for (const file of walk(APP)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("<form")) continue;

    for (const form of formsIn(source)) {
      const actionFile = importedFrom(source, form.action, file);
      const actionSource = actionFile ? readFileSync(actionFile, "utf8") : "";
      const body = actionSource ? (actionBody(actionSource, form.action) ?? "") : "";
      for (const field of form.fields) {
        rows.push({
          file: file.replace(/\\/g, "/"),
          action: form.action,
          actionFile: actionFile?.replace(/\\/g, "/") ?? null,
          field: field.name,
          kind: field.kind,
          read: actionFile ? readsName(body, actionSource, field) : null,
        });
      }
    }
  }
  return rows;
}
