import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkCreationButtons,
  readCreationButtons,
  requiredSearchParams,
  resolveRoute,
  withoutComments,
} from "../../scripts/lib/creation-buttons.mjs";

/**
 * PRESS EVERY PRIMARY CREATION BUTTON AND SEE WHERE IT LANDS.
 *
 * Abdou's words on 10 September, after "New delivery" gave him a 404:
 * *"Add a navigation test for every primary creation button."*
 *
 * The defect was not a missing page. `/deliveries/new` existed and worked; it
 * opened with `if (!source) notFound()`, and the button on the deliveries LIST
 * has no single order to name, so it carried no `source` and the page refused
 * to render. Every route answered. `scripts/smoke-routes.mjs` proves exactly
 * that and would have said the system was fine.
 *
 * So this proves the other half: that the buttons point at the screens. The
 * list of buttons is READ OUT OF THE SOURCE — every `<Link>` in `src/app` and
 * `src/components` wrapping a `<Button variant="primary">` — so a button added
 * tomorrow is under test the moment somebody writes it, and nobody has to
 * remember to add a line here.
 */
describe("every primary button that navigates", () => {
  const buttons = checkCreationButtons();

  it("finds the buttons at all", () => {
    /*
      The failure this guards against is the worst kind: a parser that matches
      nothing reports nothing broken. If the JSX in this app ever stops looking
      the way this reader expects, THAT is the failure, not silence.
    */
    expect(buttons.length).toBeGreaterThanOrEqual(20);
    expect(readCreationButtons().every((b) => b.file.endsWith(".tsx"))).toBe(true);
  });

  it("covers the screens that start something", () => {
    // Not the list under test — a floor under it. Each of these is a place a
    // person begins a record, and each was reached by a primary button on the
    // day this was written.
    const hrefs = new Set(buttons.map((b) => b.href));
    for (const href of [
      "/companies/new",
      "/contacts/new",
      "/deals/new",
      "/deliveries/new",
      "/projects/new",
    ]) {
      expect(hrefs, `no primary button opens ${href}`).toContain(href);
    }
  });

  it("lands every one of them on a screen that renders", () => {
    const broken = buttons.filter((b) => !b.ok);
    const said = broken.map(
      (b) => `${b.file}:${b.line}  →  ${b.href ?? "<expression>"}\n    ${b.why}`,
    );
    expect(said, said.join("\n")).toEqual([]);
  });
});

/**
 * The reader itself, against source written here rather than against the app.
 *
 * A green suite above means nothing unless these hold: the checker has to be
 * able to SEE the defect it exists to catch.
 */
describe("the reader behind it", () => {
  const dir = mkdtempSync(join(tmpdir(), "supserv-buttons-"));
  const write = (name: string, body: string) => {
    const file = join(dir, name);
    writeFileSync(file, body, "utf8");
    return file;
  };

  it("sees a page that refuses to render without a search param", () => {
    const file = write(
      "guarded.tsx",
      `export default async function P({ searchParams }) {
         const { source, error } = await searchParams;
         if (!source) notFound();
         return <div>{error}</div>;
       }`,
    );
    expect(requiredSearchParams(file)).toEqual(["source"]);
  });

  it("does not mistake an optional param for a required one", () => {
    const file = write(
      "open.tsx",
      `export default async function P({ searchParams }) {
         const { status } = await searchParams;
         return <div>{status ?? "all"}</div>;
       }`,
    );
    expect(requiredSearchParams(file)).toEqual([]);
  });

  it("reads code, not commentary", () => {
    /*
      This is not hypothetical. The first version of the reader matched the
      sentence in `deliveries/new/page.tsx` that QUOTES the removed guard, and
      declared the repaired button still broken.
    */
    const file = write(
      "commented.tsx",
      `export default async function P({ searchParams }) {
         const { source } = await searchParams;
         // it used to say: if (!source) notFound();
         /* and here too: if (!source) notFound(); */
         return <div>{source ?? "picker"}</div>;
       }`,
    );
    expect(requiredSearchParams(file)).toEqual([]);
  });

  it("blanks comments without moving a single line", () => {
    const src = 'const a = 1; // x\n/* y */ const b = "http://keep/me";\n';
    const out = withoutComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).toContain('"http://keep/me"');
    expect(out).not.toContain("// x");
  });

  it("resolves real routes and refuses invented ones", () => {
    expect(resolveRoute("/deliveries/new")).toEqual(["deliveries", "new"]);
    expect(resolveRoute("/deals/[x]/prices")).toEqual(["deals", "[id]", "prices"]);
    expect(resolveRoute("/there/is/no/such/screen")).toBeNull();
  });
});
