import { mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { ingestDocument } from "@/domain/intake/dossier";

/**
 * Screen 41 — the scan station.
 *
 * The design draws a button that talks to the scanner. There is no scanner
 * driver and there will not be one: the Kyocera in Adrar already knows how to
 * put a PDF in a folder, and so does every scanner made in the last twenty
 * years. So the route is the one that already works — scan to a folder, and the
 * system watches the folder.
 *
 * What this does NOT do, and says so on the screen rather than quietly failing:
 * it does not deskew, rotate or drop a page, and it does not split a binder
 * into separate documents. Those need the page images, and the OCR container
 * that would hand them over is not on this machine yet (docs/OCR.md §7).
 */

/** Where a file goes once it has been read. Never deleted — moved. */
export const READ_SUBFOLDER = "_read";

export type SweepItem = {
  filename: string;
  ok: boolean;
  dossierId?: string;
  unreadPages?: number[];
  fields?: number;
  error?: string;
};

export type SweepReport = {
  folder: string;
  found: number;
  items: SweepItem[];
  /** Files that read cleanly and moved out of the way. */
  read: number;
  /** Files that failed and were LEFT where they are, on purpose. */
  left: number;
};

export class FolderRefused extends Error {
  constructor(readonly reason: "notConfigured" | "notAbsolute" | "notADirectory") {
    super(reason);
  }
}

/** Only PDFs. A scanner set to JPEG is a scanner set wrong, and the screen says so. */
export function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

export async function assertUsable(folder: string): Promise<void> {
  if (!folder) throw new FolderRefused("notConfigured");
  // A relative path resolves against wherever the process happens to be running,
  // which on a Windows service is not where anybody thinks it is.
  if (!isAbsolute(folder)) throw new FolderRefused("notAbsolute");

  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new FolderRefused("notADirectory");
}

/**
 * Two scans on the same day arrive with the same name more often than not — a
 * Kyocera names them by date. Overwriting the first would destroy a document
 * nobody knew was there.
 */
export function uniqueName(filename: string, stamp: string): string {
  const dot = filename.lastIndexOf(".");
  const stem = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? "" : filename.slice(dot);
  return `${stem}__${stamp}${ext}`;
}

/**
 * Read everything new in the folder, once.
 *
 * A file that reads is moved into `_read/`, so the next sweep does not read it
 * twice and so a person can still find the original. A file that FAILS is left
 * exactly where it is: moving somebody's document into a folder called
 * `_unreadable` is a way to lose it, and the report already names it.
 */
export async function sweepFolder(opts: {
  folder: string;
  actorId: string;
  /** Safety rail: one sweep never takes on more than this. */
  limit?: number;
}): Promise<SweepReport> {
  const { folder, actorId, limit = 25 } = opts;
  await assertUsable(folder);

  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && isPdf(entry.name))
    .map((entry) => entry.name)
    .sort();

  const items: SweepItem[] = [];
  const done = join(folder, READ_SUBFOLDER);

  for (const filename of files.slice(0, limit)) {
    const from = join(folder, filename);

    try {
      const body = await readFile(from);
      // A scan station scans to PDF — `isPdf` above is what this sweep takes,
      // and it is not widened here. A folder somebody drops a spreadsheet into
      // is a different feature from a scanner writing what it produced.
      const result = await ingestDocument({ filename, body, actorId, mime: "application/pdf" });

      await mkdir(done, { recursive: true });
      await rename(from, join(done, uniqueName(filename, stampNow())));

      items.push({
        filename,
        ok: true,
        dossierId: result.dossierId,
        unreadPages: result.unreadPages,
        fields: result.fields,
      });
    } catch (error) {
      items.push({
        filename,
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return {
    folder,
    found: files.length,
    items,
    read: items.filter((i) => i.ok).length,
    left: items.filter((i) => !i.ok).length,
  };
}

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
