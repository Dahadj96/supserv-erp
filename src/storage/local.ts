import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Storage, StoredFile } from "./index";

/**
 * Working files on a disk. Uploads, scans, spreadsheets waiting to be imported.
 *
 * Screen 66 keeps this deliberately separate from finished documents, which go
 * to SharePoint: these are inputs, they are large, they are numerous, and
 * nobody will ever want to open one from File Explorer in three years.
 *
 * The id IS the relative path. There is no table of files, because a table that
 * can disagree with the disk is a table that will.
 */

function root(): string {
  const configured = process.env.STORAGE_LOCAL_PATH;
  // On the Windows development machine `/data/files` is not writable, and a
  // path that only works on the server is a path that gets discovered at the
  // worst moment. Anything not absolute — or absolute POSIX on Windows —
  // falls back to a folder inside the project.
  if (
    configured &&
    isAbsolute(configured) &&
    !(process.platform === "win32" && configured.startsWith("/"))
  ) {
    return configured;
  }
  return resolve(process.cwd(), ".data", "files");
}

/**
 * A path from outside must never escape the root. `..` in a filename is the
 * oldest trick there is, and this function is the only thing between an
 * uploaded file and the rest of the disk.
 */
function safeJoin(base: string, relative: string): string {
  const full = resolve(base, relative);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error("pathEscapesStorageRoot");
  }
  return full;
}

export const localStorage: Storage = {
  async put({ path, body, mime }): Promise<StoredFile> {
    const base = root();
    const full = safeJoin(base, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);

    return {
      id: path,
      path: full,
      bytes: body.byteLength,
      mime,
      driver: "local",
    };
  },

  async get(id: string): Promise<Buffer> {
    return readFile(safeJoin(root(), id));
  },

  async signedUrl(id: string): Promise<string> {
    // There is no public bucket to sign against. Files are served by a route
    // that checks the session, which is the whole point of not having one.
    return `/api/files/${encodeURIComponent(id)}`;
  },

  async remove(id: string): Promise<void> {
    // "moves to the bin; never a hard delete" — the same rule as screen 83,
    // applied to bytes instead of rows.
    const base = root();
    const from = safeJoin(base, id);
    const to = safeJoin(base, join("_bin", id));
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  },
};

/** Same bytes, same name — used to notice a file uploaded twice. */
export function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
