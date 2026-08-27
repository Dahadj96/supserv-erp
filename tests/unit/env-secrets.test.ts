import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No .env file may be tracked by git except `.env.example`.
 *
 * WHY. `.gitignore` used to name two files exactly — `.env` and `.env.local`.
 * That is fine until somebody takes a backup before changing a URL and calls it
 * `.env.before-public-url`, at which point a file holding MS_CLIENT_SECRET,
 * DATABASE_URL and BETTER_AUTH_SECRET sits in `git status` as an untracked file
 * one `git add -A` away from the history.
 *
 * This is not hypothetical caution. A client secret on this project has already
 * had to be rotated once because it reached a place it should not have.
 * Ignoring the PATTERN rather than the filename is the fix; this test is what
 * stops the pattern being narrowed again by someone who does not know that.
 *
 * Secrets in git history are not deletable in any practical sense — a rotation
 * at the identity provider is the only real remedy, and it is somebody's
 * afternoon. Cheaper to fail here.
 */

const ROOT = join(import.meta.dirname, "..", "..");

const rules = readFileSync(join(ROOT, ".gitignore"), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

describe("env files are ignored by pattern, not by name", () => {
  it("ignores every .env* file", () => {
    expect(rules).toContain(".env");
    expect(rules).toContain(".env.*");
  });

  it("keeps the example, which is the one that must stay tracked", () => {
    expect(rules).toContain("!.env.example");
  });

  it("covers every .env file actually sitting in the repository root", () => {
    const found = readdirSync(ROOT).filter((name) => name === ".env" || name.startsWith(".env."));

    // `.env.example` is the exception on purpose: it is the file that documents
    // which variables exist, and it holds none of their values.
    const mustBeIgnored = found.filter((name) => name !== ".env.example");

    for (const name of mustBeIgnored) {
      const covered = rules.some(
        (rule) => rule === name || (rule === ".env.*" && name.startsWith(".env.")),
      );
      expect(covered, `${name} is not matched by any .gitignore rule`).toBe(true);
    }
  });
});

describe("git agrees", () => {
  it("tracks .env.example and nothing else beginning with .env", () => {
    if (!existsSync(join(ROOT, ".git"))) return;

    const tracked = execFileSync("git", ["ls-files", "-z", ".env*"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter((name) => name.length > 0);

    expect(tracked).toEqual([".env.example"]);
  });
});
