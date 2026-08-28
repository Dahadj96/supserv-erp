import { constants, type Dirent } from "node:fs";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { listFiles } from "./index";

/**
 * Screen 66 — Storage and files.
 *
 * Two places, on purpose, and `src/storage/index.ts` already says which:
 * working files go to a disk on this machine, finished documents go to
 * SharePoint. This module does not decide that. It reports whether either of
 * them is actually true today.
 *
 * The important half is the disagreement. `src/storage/local.ts` argues there
 * must be no table of files "because a table that can disagree with the disk is
 * a table that will" — and it is right, but the three tables that own files
 * still record a `storage_path` each. So the disk and the database CAN drift,
 * in two directions, and both of them are worth a person's attention:
 *
 *   MISSING   a row points at a path with no bytes behind it. Something was
 *             deleted underneath the system, or a write failed silently.
 *   ORPHANED  bytes on the disk that no row points at. Harmless, but it is
 *             where the disk fills up from.
 *
 * Neither is inferred from a counter. Both are computed by reading the disk.
 */

/** Mirrors the fallback in `src/storage/local.ts`, which owns the rule. */
export function workingRoot(): string {
  const configured = process.env.STORAGE_LOCAL_PATH;
  if (
    configured &&
    /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(configured) &&
    !(process.platform === "win32" && configured.startsWith("/"))
  ) {
    return configured;
  }
  return resolve(process.cwd(), ".data", "files");
}

/** The subtree `remove()` moves things into rather than unlinking them. */
export const BIN_DIR = "_bin";

export type DiskFile = { path: string; bytes: number; inBin: boolean };

async function walk(root: string, from = root): Promise<DiskFile[]> {
  // Explicitly `Dirent[]`: inferring it from `readdir` picks the overload that
  // returns Buffer names, and every path below is a string.
  let entries: Dirent[];
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: DiskFile[] = [];
  for (const entry of entries) {
    const full = join(from, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(root, full)));
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const info = await stat(full);
      const rel = relative(root, full);
      out.push({
        path: rel.split(sep).join("/"),
        bytes: info.size,
        inBin: rel.split(sep)[0] === BIN_DIR,
      });
    } catch {
      // A file that vanished between readdir and stat is not an error worth
      // failing a settings screen over. It simply is not there.
    }
  }
  return out;
}

/**
 * `ready` means a file written now would land. It is proved by asking the
 * filesystem for write access, not by the folder existing — a read-only mount
 * and a healthy one look identical from the outside, and finding out at upload
 * time is finding out too late.
 */
export type LocalState = "ready" | "unwritable";

export type WorkingReport = {
  purpose: "working";
  driver: "local";
  state: LocalState;
  root: string;
  configured: boolean;
  files: number;
  bytes: number;
  binFiles: number;
  binBytes: number;
  /** Rows whose `storage_path` has no bytes behind it. */
  missing: string[];
  /** Bytes on disk that no row claims. Capped for display; `orphanedCount` is not. */
  orphaned: string[];
  orphanedCount: number;
  orphanedBytes: number;
};

/**
 * SharePoint has no numbers, because it has no connection.
 *
 * `storageFor("final")` throws today. A card reading "SharePoint — 0 files"
 * would be a chip that can only ever read zero, which is exactly the kind of
 * decoration this project keeps refusing. So the state is the content.
 */
export type FinalReport = {
  purpose: "final";
  driver: "sharepoint";
  state: "notConnected";
  /** The Graph permission it waits on. Named so the ask is concrete. */
  needs: string;
};

export type StorageReport = { working: WorkingReport; final: FinalReport };

/** Long lists help nobody. The count is exact; the sample is a sample. */
const SAMPLE = 20;

export async function storageReport(): Promise<StorageReport> {
  const root = workingRoot();

  let state: LocalState = "ready";
  try {
    await mkdir(root, { recursive: true });
    await access(root, constants.W_OK);
  } catch {
    state = "unwritable";
  }

  const onDisk = await walk(root);
  const live = onDisk.filter((f) => !f.inBin);
  const binned = onDisk.filter((f) => f.inBin);

  const claimed = new Set(
    (await listFiles())
      .map((f) => f.storagePath)
      .filter((p): p is string => Boolean(p))
      .map((p) => p.split(sep).join("/")),
  );

  const present = new Set(live.map((f) => f.path));
  const missing = [...claimed].filter((p) => !present.has(p));
  const orphaned = live.filter((f) => !claimed.has(f.path));

  return {
    working: {
      purpose: "working",
      driver: "local",
      state,
      root,
      configured: Boolean(process.env.STORAGE_LOCAL_PATH),
      files: live.length,
      bytes: live.reduce((sum, f) => sum + f.bytes, 0),
      binFiles: binned.length,
      binBytes: binned.reduce((sum, f) => sum + f.bytes, 0),
      missing: missing.slice(0, SAMPLE),
      orphaned: orphaned.slice(0, SAMPLE).map((f) => f.path),
      orphanedCount: orphaned.length,
      orphanedBytes: orphaned.reduce((sum, f) => sum + f.bytes, 0),
    },
    final: {
      purpose: "final",
      driver: "sharepoint",
      state: "notConnected",
      needs: "Files.ReadWrite.All",
    },
  };
}
