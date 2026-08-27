import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every .ps1 in this repository must be pure ASCII.
 *
 * WHY, and it is not tidiness. Three server scripts shipped with an em dash in
 * a comment and a warning string, and all three failed to parse the first time
 * anybody ran them — in an Administrator PowerShell, halfway through setting up
 * a Windows service.
 *
 * The mechanism: Windows PowerShell 5.1 reads a UTF-8 file with no BOM as
 * Windows-1252. An em dash is E2 80 94 in UTF-8, which decodes as `â€"` — and
 * 0x94 in Windows-1252 is U+201D, a RIGHT DOUBLE QUOTATION MARK. PowerShell
 * accepts curly quotes as string delimiters, so that character ENDS THE STRING.
 * Everything after it reparses as code, and the failure surfaces five lines
 * later as "the string is missing the terminator" pointing at an innocent line.
 *
 * A BOM would also fix it. ASCII-only is the better rule: it survives being
 * copied into an email, re-saved by Notepad, or pasted into a terminal, none of
 * which a BOM survives. These are the scripts somebody runs at two in the
 * morning when the machine will not come back.
 *
 * `tests/unit/client-bundle.test.ts` exists for the same reason: a whole class
 * of failure that typecheck and every other test are blind to.
 */

const ROOT = join(import.meta.dirname, "..", "..");

function powershellFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...powershellFiles(full));
    else if (entry.endsWith(".ps1")) out.push(full);
  }
  return out;
}

const files = powershellFiles(join(ROOT, "scripts"));

describe("every PowerShell script is ASCII", () => {
  it("finds the scripts at all, so a rename cannot make this test vacuous", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = file.slice(ROOT.length + 1).replace(/\\/g, "/");

    it(`${name} has no character Windows-1252 would mangle`, () => {
      const text = readFileSync(file, "utf8");
      const offenders: string[] = [];

      text.split(/\r?\n/).forEach((line, index) => {
        for (const char of line) {
          const code = char.codePointAt(0) as number;
          if (code > 126 || (code < 9 && code !== 0)) {
            offenders.push(
              `line ${index + 1}: ${JSON.stringify(char)} (U+${code
                .toString(16)
                .toUpperCase()
                .padStart(4, "0")})`,
            );
          }
        }
      });

      expect(
        offenders,
        `${name} contains characters Windows PowerShell 5.1 will misread.\n` +
          `An em dash becomes a closing quote and the file stops parsing.\n` +
          offenders.join("\n"),
      ).toEqual([]);
    });
  }
});

/**
 * The other half of the same lesson: a script that parses is not a script that
 * points at things which exist. `install-services.ps1` closed by telling the
 * reader to run `scripts\server\status.ps1`, which has never existed.
 */
describe("the scripts point at files that exist", () => {
  const known = new Set(files.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/")));

  for (const file of files) {
    const name = file.slice(ROOT.length + 1).replace(/\\/g, "/");

    it(`${name} names no sibling script that is missing`, () => {
      const text = readFileSync(file, "utf8");
      const missing: string[] = [];

      for (const match of text.matchAll(/scripts[\\/]server[\\/]([\w.-]+\.ps1)/g)) {
        const referenced = `scripts/server/${match[1]}`;
        if (!known.has(referenced)) missing.push(referenced);
      }

      expect(missing, `${name} refers to ${missing.join(", ")}`).toEqual([]);
    });
  }
});
