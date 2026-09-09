import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILE_KINDS } from "@/domain/files";
import { NEEDS } from "@/domain/files/serving";
import { PIECE_STATES, SECTIONS } from "@/domain/tender/dossier";
import { CREDENTIAL_KEYS } from "@/domain/tender/pieces";

/**
 * Screen 08's presses, without a database — the sibling of
 * `tender-conversion.test.ts` for screen 06.
 *
 * Task 2.7 gave this screen five forms, and every one of them reports back the
 * same way: the action redirects to `?error=<code>` or `?saved=<code>` and the
 * page prints `t("tender.error.<code>")`. That is three lists which have to
 * agree — what the actions can send, what the page will print, and what the
 * two message files have words for — and when they disagree the failure is
 * silent in the worst way. An action that refuses with a code the page does
 * not allow redirects to a screen showing nothing at all: the press appears to
 * have worked, the folder is unchanged, and nobody is told. That is the bug
 * this file exists to catch, and it needs no Postgres to catch it.
 */
const root = join(import.meta.dirname, "..", "..");
const load = (locale: string) =>
  JSON.parse(readFileSync(join(root, "src/i18n/messages", `${locale}.json`), "utf8"));
const en = load("en");
const fr = load("fr");

const screen = join(root, "src/app/[locale]/(app)/tenders/[id]");
const actions = readFileSync(join(screen, "actions.ts"), "utf8");
const page = readFileSync(join(screen, "page.tsx"), "utf8");

/** The `const ERRORS = [...]` / `const SAVED = [...]` allowlists on the page. */
function listOnPage(name: string): string[] {
  const inner = page.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`))?.[1];
  // Thrown rather than returned empty: a list this cannot find is a list that
  // passes every assertion below by having nothing in it.
  if (!inner) throw new Error(`${name} is no longer a literal array on screen 08`);
  return [...inner.matchAll(/"(\w+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** Every `?error=notADate` an action can actually redirect with. */
function codesInActions(param: string): string[] {
  const found = new Set<string>();
  for (const m of actions.matchAll(new RegExp(`\\?${param}=([a-zA-Z]\\w*)`, "g"))) {
    if (m[1]) found.add(m[1]);
  }
  return [...found].sort();
}

describe("what screen 08 can say back", () => {
  const errors = listOnPage("ERRORS");
  const saved = listOnPage("SAVED");

  it("prints every refusal its own actions can send", () => {
    // `?error=${error.reason}` is a template and does not match, on purpose:
    // those reasons come from `TenderRefused` and are asserted below against
    // the functions that throw them.
    for (const code of codesInActions("error")) {
      expect(errors, `?error=${code} is not on screen 08's allowlist`).toContain(code);
    }
  });

  it("prints every confirmation its own actions can send", () => {
    for (const code of codesInActions("saved")) {
      expect(saved, `?saved=${code} is not on screen 08's allowlist`).toContain(code);
    }
  });

  it("carries the refusals the domain throws through those five functions", () => {
    // `markSubmitted` refuses four ways, `removePiece` one, `addPiece` one.
    // They reach the screen as `error.reason`, so the page has to know them
    // even though no `?error=` literal in the action file names them.
    for (const reason of [
      "noSuchTender",
      "alreadySubmitted",
      "dossierIncomplete",
      "reasonRequired",
      "noSuchPiece",
      "labelRequired",
    ]) {
      expect(errors, `TenderRefused("${reason}") has nowhere to be printed`).toContain(reason);
    }
  });

  it("has words for every one of them, in both languages", () => {
    for (const code of errors) {
      expect(en.tender.error[code], `en tender.error.${code}`).toBeTypeOf("string");
      expect(fr.tender.error[code], `fr tender.error.${code}`).toBeTypeOf("string");
    }
    for (const code of saved) {
      expect(en.tender.saved[code], `en tender.saved.${code}`).toBeTypeOf("string");
      expect(fr.tender.saved[code], `fr tender.saved.${code}`).toBeTypeOf("string");
    }
  });

  it("never greys a control without a sentence to go with it", () => {
    // THE LAW: every disabled control resolves to a reason. Both of screen
    // 08's are permissions, so both need words rather than a permission name
    // leaking onto the screen.
    for (const key of ["work", "file"]) {
      expect(en.tender.notAllowed[key], `en tender.notAllowed.${key}`).toBeTypeOf("string");
      expect(fr.tender.notAllowed[key], `fr tender.notAllowed.${key}`).toBeTypeOf("string");
    }
  });
});

describe("the two selects on the add-a-piece form", () => {
  // Both render a whole exported list through a template-literal key, which
  // `messages.test.ts` cannot see. A tenth company paper or a fourth envelope
  // added to the domain and not to both message files is a 500 on screen 08.
  it("names every envelope in both languages", () => {
    for (const section of SECTIONS) {
      expect(en.tender.section[section], `en ${section}`).toBeTruthy();
      expect(fr.tender.section[section], `fr ${section}`).toBeTruthy();
    }
  });

  it("names every company paper in both languages", () => {
    for (const key of CREDENTIAL_KEYS) {
      expect(en.tender.piece[key], `en ${key}`).toBeTruthy();
      expect(fr.tender.piece[key], `fr ${key}`).toBeTruthy();
    }
  });

  it("names every state a piece can be in, since the badge prints it", () => {
    for (const state of PIECE_STATES) {
      expect(en.tender.state[state], `en ${state}`).toBeTruthy();
      expect(fr.tender.state[state], `fr ${state}`).toBeTruthy();
    }
  });
});

describe("the scan behind a company paper", () => {
  it("is a file kind of its own, readable by anybody signed in", () => {
    expect(FILE_KINDS).toContain("credential");
    // `null` is a decision and not an omission — `serving.ts` argues it. The
    // company's own CNAS attestation is a record, and the person assembling a
    // folder at eight in the morning is exactly who needs to open it.
    expect(NEEDS.credential).toBeNull();
  });

  it("has a name on screen 60 in both languages", () => {
    expect(en.files.kind.credential, "en files.kind.credential").toBeTypeOf("string");
    expect(fr.files.kind.credential, "fr files.kind.credential").toBeTypeOf("string");
    expect(en.files.from.credential, "en files.from.credential").toBeTypeOf("string");
    expect(fr.files.from.credential, "fr files.from.credential").toBeTypeOf("string");
  });

  it("is what a credential-backed piece is waiting for, and the screen says so", () => {
    // The whole reason 2.7 exists: `pieceState` returns `missing` while
    // `credential.fileId` is null, so a folder could read all red with nothing
    // on screen able to fix it. The sentence under the empty form is what
    // tells somebody that, and it is the one piece of copy on this screen that
    // must not quietly disappear.
    expect(page).toContain("tender.credential.noScan");
    expect(en.tender.credential.noScan).toBeTypeOf("string");
    expect(fr.tender.credential.noScan).toBeTypeOf("string");
  });
});
