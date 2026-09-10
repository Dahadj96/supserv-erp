import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * EVERY PRIMARY BUTTON THAT NAVIGATES, AND WHETHER IT LANDS ON ANYTHING.
 *
 * On 10 September the owner pressed "New delivery" on screen 14 and got a 404.
 * The route existed. The page existed. The form worked. `/deliveries/new`
 * simply began `if (!source) notFound()` — it needed an order id in the query
 * string, and the button on a LIST of deliveries has no single order to name.
 * So the one control that starts a delivery landed on nothing, and every path
 * that did work was a link that already knew the answer.
 *
 * `scripts/smoke-routes.mjs` could not have caught it: it proves that routes
 * ANSWER, and this route answered. What was never checked is the other half —
 * that the BUTTONS POINT AT THEM. That is this file.
 *
 * It reads three things out of the source, and hand-lists none of them:
 *
 *   1. the buttons — every `<Link href=…>` in the app whose subtree contains a
 *      `<Button … variant="primary">`, so a button added tomorrow is covered
 *      the moment it is written;
 *   2. the routes — the `page.tsx` tree under `src/app`, including `[id]`
 *      segments and `(group)` folders;
 *   3. the guards — the search params each target page refuses to render
 *      without: `notFound()`, `redirect()` and `hardRedirect()` behind an
 *      `if (!param)`.
 *
 * A button fails when its route does not exist, or when the page it opens
 * demands a query parameter the button does not carry. Both are "lands on
 * nothing" as far as the person pressing it is concerned.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const APP = join(ROOT, "src/app");

/** Directories whose `.tsx` is worth reading for buttons. */
const SOURCE_DIRS = ["src/app", "src/components"];

/**
 * Source with its comments blanked out, same length, newlines kept.
 *
 * Not fussiness: the first version of this file read the prose in
 * `deliveries/new/page.tsx` — a comment quoting the very guard that had just
 * been removed — and reported the repaired button as still broken. A checker
 * that reads commentary is a checker that fails on the sentence explaining why
 * it passes. `://` is left alone so a URL in a string is not eaten.
 */
export function withoutComments(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === "/" && src[i + 1] === "/" && src[i - 1] !== ":") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/* ------------------------------------------------------------------ routes */

/**
 * Every route that has a `page.tsx`, as a segment pattern.
 *
 * `(app)`, `(auth)` and friends are route groups: they are folders in the
 * source and nothing in the URL, so they are dropped. `[locale]` is dropped
 * too — every href in this codebase is written locale-less and the `Link` from
 * `@/i18n/navigation` prefixes it.
 */
export function routePatterns() {
  const found = [];

  const descend = (dir, segments) => {
    if (existsSync(join(dir, "page.tsx"))) found.push([...segments]);
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      if (name.startsWith("_") || name === "api") continue;
      const isGroup = name.startsWith("(") && name.endsWith(")");
      const isLocale = name === "[locale]";
      descend(full, isGroup || isLocale ? segments : [...segments, name]);
    }
  };

  descend(APP, []);
  return found;
}

/** Where the `page.tsx` for a matched pattern lives, so its guards can be read. */
function pageFileFor(pattern) {
  const hunt = (dir, index) => {
    if (index === pattern.length) {
      const file = join(dir, "page.tsx");
      return existsSync(file) ? file : null;
    }
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      const isGroup = name.startsWith("(") && name.endsWith(")");
      const isLocale = name === "[locale]";
      if (isGroup || isLocale) {
        const hit = hunt(full, index);
        if (hit) return hit;
        continue;
      }
      if (name === pattern[index]) {
        const hit = hunt(full, index + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return hunt(APP, 0);
}

/** Does this path match this route pattern? `[id]` eats one segment, `[...x]` the rest. */
function matches(pattern, segments) {
  let i = 0;
  for (const part of pattern) {
    if (part.startsWith("[...") || part.startsWith("[[...")) return true;
    if (i >= segments.length) return false;
    // A dynamic segment matches anything that is actually there.
    if (!(part.startsWith("[") && part.endsWith("]")) && part !== segments[i]) return false;
    i += 1;
  }
  return i === segments.length;
}

export function resolveRoute(path) {
  const segments = path.split("/").filter(Boolean);
  for (const pattern of routePatterns()) {
    if (matches(pattern, segments)) return pattern;
  }
  return null;
}

/* ----------------------------------------------------------------- buttons */

/** The end of the opening tag that starts at `from`, respecting `{…}` nesting. */
function endOfOpeningTag(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** From the end of `<Link …>`, the index just before its `</Link>`. */
function endOfChildren(src, from) {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const open = src.indexOf("<Link", i);
    const close = src.indexOf("</Link>", i);
    if (close === -1) return src.length;
    if (open !== -1 && open < close) {
      const tagEnd = endOfOpeningTag(src, open);
      // `<Link … />` opens and closes at once.
      if (tagEnd > 0 && src[tagEnd - 1] !== "/") depth += 1;
      i = tagEnd + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return close;
    i = close + 7;
  }
  return src.length;
}

/**
 * The href, as far as it can be known statically.
 *
 * A template literal keeps its shape and loses its holes: `/deals/${id}/prices`
 * becomes `/deals/[x]/prices`, which is exactly what the route matcher wants —
 * the value of `id` is not the question, the existence of the screen is.
 */
function hrefOf(tag) {
  const literal = tag.match(/\shref=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\})/);
  if (literal) return { href: literal[1] ?? literal[2], dynamic: false };

  const template = tag.match(/\shref=\{\s*`([^`]*)`\s*\}/);
  if (template) {
    // `${…}` may itself contain a `}`; the paths in this codebase do not, and a
    // hole that is not a whole segment is reported rather than guessed.
    return { href: template[1].replace(/\$\{[^}]*\}/g, "[x]"), dynamic: false };
  }

  const expression = tag.match(/\shref=\{([\s\S]*?)\}\s*$/);
  return { href: null, dynamic: true, expression: expression?.[1]?.trim() ?? "?" };
}

/** Every primary button in the app that is wrapped in a link. */
export function readCreationButtons() {
  const buttons = [];

  for (const dir of SOURCE_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = withoutComments(readFileSync(file, "utf8"));
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      let cursor = 0;

      while (true) {
        const open = src.indexOf("<Link", cursor);
        if (open === -1) break;
        const tagEnd = endOfOpeningTag(src, open);
        if (tagEnd === -1) break;
        const tag = src.slice(open, tagEnd);
        cursor = tagEnd + 1;
        if (src[tagEnd - 1] === "/") continue; // self-closing: no button inside

        const childrenEnd = endOfChildren(src, tagEnd + 1);
        const children = src.slice(tagEnd + 1, childrenEnd);
        if (!/<Button[^>]*variant="primary"/.test(children)) continue;

        const line = src.slice(0, open).split("\n").length;
        buttons.push({ file: rel, line, ...hrefOf(tag) });
      }
    }
  }

  return buttons.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/* ------------------------------------------------------------------ guards */

/**
 * Which search params a page refuses to render without.
 *
 * The T1 shape exactly: `const { source } = await searchParams;` followed by
 * `if (!source) notFound();`. A page may legitimately do this — the form NEEDS
 * an order — but then every button pointing at it has to carry the parameter,
 * and that is the half nothing checked.
 *
 * Only `searchParams` counts. A guard on a route param is not reachable by a
 * link that names the segment, and a guard on a session is every page here.
 */
export function requiredSearchParams(file) {
  const src = withoutComments(readFileSync(file, "utf8"));

  const destructured = new Set();
  for (const match of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+searchParams\s*;/g)) {
    for (const part of match[1].split(",")) {
      const name = part.split(":")[0].trim().replace(/^\.\.\./, "");
      if (name) destructured.add(name);
    }
  }
  if (destructured.size === 0) return [];

  const required = new Set();
  const bail = String.raw`(?:notFound\s*\(|hardRedirect\s*\(|redirect\s*\(|permanentRedirect\s*\()`;
  for (const name of destructured) {
    const guard = new RegExp(
      String.raw`if\s*\(\s*!\s*${name}\s*\)\s*(?:\{\s*)?(?:return\s+)?${bail}`,
    );
    if (guard.test(src)) required.add(name);
  }

  return [...required];
}

/* ------------------------------------------------------------------ verdict */

/**
 * @typedef {{
 *   file: string, line: number, href: string | null, dynamic: boolean,
 *   expression?: string, ok: boolean, why: string, route: string | null,
 * }} Verdict
 */

/**
 * One shape for every answer, pass or fail.
 *
 * Uniform on purpose: a union of six shapes is a union the caller has to widen
 * before it can print why something failed, and the thing a caller always wants
 * from this is the reason.
 *
 * @returns {Verdict[]}
 */
export function checkCreationButtons() {
  return readCreationButtons().map((button) => {
    const verdict = (ok, why, route = null) => ({ ...button, ok, why, route });

    if (button.href === null) {
      return verdict(false, `href is an expression — ${button.expression}`);
    }

    // Anything that leaves this app is not a screen of ours to prove.
    if (/^(https?:|mailto:|tel:|#)/.test(button.href)) return verdict(true, "leaves the app");

    const [path, query = ""] = button.href.split("?");
    const pattern = resolveRoute(path);
    if (!pattern) return verdict(false, `no route answers ${path}`);

    const route = `/${pattern.join("/")}`;
    const carried = new Set(
      query
        .split("&")
        .map((pair) => pair.split("=")[0])
        .filter(Boolean),
    );

    const file = pageFileFor(pattern);
    const needed = file ? requiredSearchParams(file) : [];
    const missing = needed.filter((name) => !carried.has(name));
    if (missing.length > 0) {
      return verdict(
        false,
        `${path} refuses to render without ?${missing.join(", ?")} — this link carries ${
          carried.size > 0 ? `?${[...carried].join(", ?")}` : "no parameters"
        }`,
        route,
      );
    }

    return verdict(true, "renders", route);
  });
}
