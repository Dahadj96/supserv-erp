import { describe, expect, it } from "vitest";
import {
  ArchiveRefused,
  isNestedArchive,
  looksLikeArchive,
  readZip,
  safeEntryPath,
  ZIP_LIMITS,
} from "@/capture/archive/zip";
import { typeForEntry } from "@/domain/intake/archive";
import { buildZip } from "../helpers/zip";

/**
 * Task 1.4 — opening a `dossier.zip` that arrived by email.
 *
 * The archives here are BUILT rather than fixtured, because the cases that
 * matter cannot be produced by any zip tool a person would use: an entry named
 * `../../.env`, a central directory that understates a file by three orders of
 * magnitude, an archive holding an archive. A library that refuses those is
 * only proven to refuse them if something hands it one.
 */

const text = (s: string) => Buffer.from(s, "utf8");

describe("which attachments are archives at all", () => {
  it("takes the extension, and the two content types Windows mail clients send", () => {
    expect(looksLikeArchive("dossier.zip", null)).toBe(true);
    expect(looksLikeArchive("DOSSIER.ZIP", null)).toBe(true);
    expect(looksLikeArchive("dossier", "application/zip")).toBe(true);
    expect(looksLikeArchive("dossier", "application/x-zip-compressed")).toBe(true);
    expect(looksLikeArchive("cctp.pdf", "application/pdf")).toBe(false);
  });

  it("recognises the archive kinds it will not open a second level of", () => {
    expect(isNestedArchive("annexes/plans.zip")).toBe(true);
    expect(isNestedArchive("annexes/plans.rar")).toBe(true);
    expect(isNestedArchive("annexes/plans.7z")).toBe(true);
    expect(isNestedArchive("annexes/bordereau.pdf")).toBe(false);
  });
});

describe("a name inside an archive is never trusted", () => {
  it("keeps an ordinary path, and the folder structure with it", () => {
    expect(safeEntryPath("annexes/bordereau des prix.pdf")).toBe("annexes/bordereau des prix.pdf");
    expect(safeEntryPath("annexes\\bordereau.pdf")).toBe("annexes/bordereau.pdf");
    expect(safeEntryPath("./cctp.pdf")).toBe("cctp.pdf");
  });

  it("refuses every way out of the folder", () => {
    expect(safeEntryPath("../../.env")).toBeNull();
    expect(safeEntryPath("annexes/../../../etc/passwd")).toBeNull();
    expect(safeEntryPath("/etc/passwd")).toBeNull();
    expect(safeEntryPath("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBeNull();
    expect(safeEntryPath("\\\\server\\share\\x.pdf")).toBeNull();
  });

  it("refuses a name carrying a control character", () => {
    // Two readers disagreeing about where a filename ends is how one of them
    // writes somewhere the other did not mean.
    expect(safeEntryPath("cctp.pdf\u0000.exe")).toBeNull();
    expect(safeEntryPath("cctp\n.pdf")).toBeNull();
  });

  it("refuses an empty name and an absurdly long one", () => {
    expect(safeEntryPath("")).toBeNull();
    expect(safeEntryPath(`${"a".repeat(300)}.pdf`)).toBeNull();
  });
});

describe("reading a dossier", () => {
  it("gives back every file, with its path inside the archive", async () => {
    const zip = buildZip([
      { name: "CCTP.pdf", body: text("%PDF-1.4 cahier des charges") },
      { name: "annexes/", body: Buffer.alloc(0) },
      { name: "annexes/bordereau.pdf", body: text("%PDF-1.4 bordereau"), method: 8 },
      { name: "annexes/plan.png", body: text("PNG-ish") },
    ]);

    const { entries, refused } = await readZip(zip);

    expect(refused).toEqual([]);
    expect(entries.map((entry) => entry.path)).toEqual([
      "CCTP.pdf",
      "annexes/bordereau.pdf",
      "annexes/plan.png",
    ]);
    // The bytes are the bytes, deflated or not.
    expect(entries[1]?.bytes.toString("utf8")).toBe("%PDF-1.4 bordereau");
  });

  it("drops directory entries rather than recording empty files", async () => {
    const { entries } = await readZip(
      buildZip([
        { name: "dossier/", body: Buffer.alloc(0) },
        { name: "dossier/rc.pdf", body: text("règlement") },
      ]),
    );
    expect(entries).toHaveLength(1);
  });

  it("refuses a file that is not a zip at all", async () => {
    // A `.zip` extension is the sender's word, exactly like the content type.
    await expect(readZip(text("this is a letter, not an archive"))).rejects.toBeInstanceOf(
      ArchiveRefused,
    );
  });
});

describe("the hostile cases, each refused by name", () => {
  it("skips a traversing entry and keeps the honest ones", async () => {
    const { entries, refused } = await readZip(
      buildZip([
        { name: "../../.env", body: text("DATABASE_URL=...") },
        { name: "CCTP.pdf", body: text("%PDF-1.4") },
      ]),
    );

    expect(entries.map((entry) => entry.path)).toEqual(["CCTP.pdf"]);
    expect(refused).toEqual([{ path: "../../.env", reason: "unsafePath" }]);
  });

  it("stores a nested archive as a file and does not open it", async () => {
    const inner = buildZip([{ name: "deep.pdf", body: text("%PDF") }]);
    const { entries, refused } = await readZip(
      buildZip([
        { name: "annexes/plans.zip", body: inner },
        { name: "CCTP.pdf", body: text("%PDF-1.4") },
      ]),
    );

    // The inner archive is not unpacked — and it is not lost either: the
    // ORIGINAL attachment keeps its bytes, so a person can still download it.
    expect(entries.map((entry) => entry.path)).toEqual(["CCTP.pdf"]);
    expect(refused).toEqual([{ path: "annexes/plans.zip", reason: "nestedArchive" }]);
  });

  it("refuses an entry whose central directory declares more than the cap", async () => {
    const { entries, refused } = await readZip(
      buildZip([
        {
          name: "bomb.bin",
          body: text("x"),
          method: 8,
          // The classic shape: a few bytes on disk claiming to be gigabytes.
          declaredSize: ZIP_LIMITS.entryBytes + 1,
        },
        { name: "CCTP.pdf", body: text("%PDF-1.4") },
      ]),
    );

    expect(entries.map((entry) => entry.path)).toEqual(["CCTP.pdf"]);
    expect(refused[0]?.path).toBe("bomb.bin");
    expect(refused[0]?.reason).toMatch(/^entryTooLarge:/);
    // And nothing was inflated to find that out.
  });

  it("refuses an entry that LIES the other way, declaring less than it holds", async () => {
    // The dangerous shape: understate the size so the cheap check passes, then
    // stream something far larger. Two things stop it and this pins both — the
    // stream is cut at the cap by `read`, and yauzl itself refuses a stream
    // that runs past what the directory declared. The entry is lost; the
    // archive is not, and the file is named in the refusals.
    const { entries, refused } = await readZip(
      buildZip([
        { name: "liar.bin", body: Buffer.alloc(16_384, 0x41), method: 8, declaredSize: 10 },
        { name: "CCTP.pdf", body: text("%PDF-1.4") },
      ]),
    );

    expect(entries.map((entry) => entry.path)).toEqual(["CCTP.pdf"]);
    expect(refused).toEqual([{ path: "liar.bin", reason: "entryUnreadable" }]);
  });

  it("refuses an archive holding more entries than the cap, before reading any", async () => {
    const many = Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({
      name: `f${i}.txt`,
      body: text("x"),
    }));

    await expect(readZip(buildZip(many))).rejects.toThrow(/tooManyEntries/);
  });
});

describe("what an unpacked file claims to be", () => {
  it("maps the extensions the ERP can actually show, and nothing else", () => {
    expect(typeForEntry("annexes/bordereau.pdf")).toBe("application/pdf");
    expect(typeForEntry("plan.PNG")).toBe("image/png");
    expect(typeForEntry("photo.jpeg")).toBe("image/jpeg");
    expect(typeForEntry("notes.docx")).toBeNull();
    expect(typeForEntry("noextension")).toBeNull();
  });

  it("never invents a type a browser would run", () => {
    // A zip carries no content type, so the extension is the only source there
    // is — which makes this table the whole of that decision. `text/html` and
    // `image/svg+xml` served inline from our own origin, in the Gérant's
    // session, is the door `RENDERABLE` exists to hold shut.
    expect(typeForEntry("index.html")).toBeNull();
    expect(typeForEntry("logo.svg")).toBeNull();
    expect(typeForEntry("run.js")).toBeNull();
  });
});
