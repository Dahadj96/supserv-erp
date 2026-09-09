import { posix } from "node:path";
import { type Entry, fromBuffer, type ZipFile } from "yauzl";

/**
 * Opening a ZIP that arrived by email.
 *
 * A tender dossier is very often one `dossier.zip` with the CCTP, the bordereau
 * and six annexes inside it, and until this file existed the ERP listed the
 * archive and stopped there — a paperclip with nothing readable behind it.
 *
 * Everything here treats the archive as HOSTILE. It was written by somebody who
 * emailed us; half of what reaches this mailbox is unsolicited. A zip is the
 * one attachment kind that can attack the machine that opens it, in three ways,
 * and each is refused below rather than mitigated:
 *
 *   path traversal   an entry named `../../.env` writing outside the store.
 *   zip bomb         42 KB that inflates to a terabyte and fills the disk.
 *   nesting          an archive inside an archive, recursing until the stack
 *                    or the disk gives out.
 *
 * `yauzl` rather than a one-call unzip, precisely because of the second one: it
 * reads the central directory first, so an entry's declared size can be refused
 * BEFORE a byte is inflated — and the bytes that do come out are counted as
 * they arrive, so an entry that lies about its own size is cut off rather than
 * believed. A library that hands back a map of decompressed buffers has already
 * spent the disk by the time you could check.
 */

/** yauzl's callback API, used in one place, wrapped once. */
function openZip(bytes: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    /*
      `lazyEntries` is what makes the central directory readable without
      inflating anything, and it is the whole reason for this dependency.

      `decodeStrings: false` is the other half, and it is not about encodings.
      With names decoded, yauzl validates them itself and emits an ERROR on the
      whole archive the moment it meets `../../.env` — which is safe and is also
      the wrong answer here: one hostile name would cost every honest file in a
      tender dossier, and the person who needs the CCTP would be told the
      archive was refused with nothing said about why. Names come back as bytes
      instead, this file decodes them, and `safeEntryPath` refuses that ONE
      entry by name while the rest are read.

      Decoded as UTF-8, which is what every zip written this decade uses (the
      general purpose bit 11 says so). A CP437 name with accents would come out
      slightly wrong on screen; it cannot come out unsafe, because it is
      `safeEntryPath` and not the encoding that decides what is taken.
    */
    fromBuffer(bytes, { lazyEntries: true, decodeStrings: false }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error("notAZip"));
      else resolve(zip);
    });
  });
}

/**
 * The caps.
 *
 * Big enough for the largest real dossier anybody has sent SUPSERV — a marché
 * public folder is a few dozen files and tens of megabytes — and small enough
 * that the mini PC in the office survives the other kind.
 */
export const ZIP_LIMITS = {
  /** Files in one archive. Directory entries are not counted. */
  entries: 512,
  /** One file inside it, uncompressed. */
  entryBytes: 100 * 1024 * 1024,
  /** Everything inside it, uncompressed, added up. */
  totalBytes: 400 * 1024 * 1024,
} as const;

/**
 * Why the archive as a whole was refused. Thrown, because there is no partial
 * answer to either of these: the file is not a zip, or it is one that must not
 * be opened at all.
 */
export class ArchiveRefused extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "ArchiveRefused";
  }
}

/** Why one entry inside an otherwise acceptable archive was skipped. */
export type ZipRefusal = { path: string; reason: string };

export type ZipEntry = {
  /**
   * The path INSIDE the archive, `/`-separated and with nothing structural left
   * in it — `annexes/bordereau.pdf`. It becomes the attachment row's display
   * name, so a person reading screen 40 sees where the file sat in the folder
   * somebody sent, which for a dossier is half of what the folder means.
   */
  path: string;
  bytes: Buffer;
};

export type ZipReading = {
  entries: ZipEntry[];
  /** Named, never silent: an archive that half opened must say which half. */
  refused: ZipRefusal[];
};

/** Extensions this refuses to open a second level of. */
const ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".cab"];

/** Does this attachment look like an archive? Used to decide what to expand. */
export function looksLikeArchive(filename: string, contentType: string | null): boolean {
  if (filename.toLowerCase().endsWith(".zip")) return true;
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/zip" || type === "application/x-zip-compressed";
}

/** Is this ENTRY itself an archive? Then it is stored, and not opened. */
export function isNestedArchive(path: string): boolean {
  const name = path.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * The same rule as `safeJoin` in `src/storage/local.ts`, applied one step
 * earlier — to the name itself, before it can reach a filesystem call.
 *
 * Returns the cleaned relative path, or null when the entry must not be taken
 * at all. Refused rather than repaired: a name that had to be repaired to be
 * safe is a name whose author meant something by it, and quietly turning
 * `../../.env` into `.env` keeps the file and loses the warning.
 */
export function safeEntryPath(raw: string): string | null {
  // Zip stores `/` whatever the platform; a `\` in a name is either Windows
  // software being wrong or somebody hoping this code runs on Windows, which
  // it does.
  const name = raw.replace(/\\/g, "/");

  if (name.length === 0 || name.length > 240) return null;
  // A NUL or a control character truncates the name for whatever reads it
  // next, which is how two pieces of software disagree about which file this is.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
  if (/[\u0000-\u001f]/.test(name)) return null;
  if (name.startsWith("/")) return null;
  // A drive letter, or a UNC share.
  if (/^[a-zA-Z]:/.test(name) || name.startsWith("//")) return null;

  const normalised = posix.normalize(name);
  if (normalised.startsWith("/") || normalised === "." || normalised === "..") return null;
  if (normalised.split("/").some((segment) => segment === "..")) return null;

  return normalised;
}

/**
 * Read one archive.
 *
 * Never writes anything and never touches a database: it takes bytes and gives
 * back bytes, so the guards above can be tested against a hostile zip without a
 * store, a row or a message.
 */
export async function readZip(bytes: Buffer): Promise<ZipReading> {
  let zip: ZipFile;
  try {
    zip = await openZip(bytes);
  } catch {
    // Not a zip at all — a `.zip` extension is the sender's word, like the
    // content type. Nothing is damaged; there is simply nothing inside.
    throw new ArchiveRefused("notAZip");
  }

  if (zip.entryCount > ZIP_LIMITS.entries) {
    zip.close();
    throw new ArchiveRefused(`tooManyEntries:${zip.entryCount}`);
  }

  const entries: ZipEntry[] = [];
  const refused: ZipRefusal[] = [];
  let total = 0;

  try {
    for await (const entry of walk(zip)) {
      const name = entryName(entry);

      // Directories carry no bytes, and each file's path already says where it
      // sat, so an empty folder is nothing to record.
      if (name.endsWith("/")) continue;

      const path = safeEntryPath(name);
      if (path === null) {
        refused.push({ path: name, reason: "unsafePath" });
        continue;
      }

      if (isNestedArchive(path)) {
        // One level — and the inner archive is still kept as a file, so
        // somebody who needs what is in it can download it. Opening it here is
        // where a zip quine wins.
        refused.push({ path, reason: "nestedArchive" });
        continue;
      }

      if (entry.uncompressedSize > ZIP_LIMITS.entryBytes) {
        refused.push({ path, reason: `entryTooLarge:${entry.uncompressedSize}` });
        continue;
      }

      if (total + entry.uncompressedSize > ZIP_LIMITS.totalBytes) {
        // The archive as a whole is over the cap. Stop rather than carry on
        // taking the small ones: a partial dossier that looks complete is worse
        // than one that says it was refused.
        refused.push({ path, reason: "archiveTooLarge" });
        break;
      }

      // The declared size is the sender's claim too. `read` stops at the cap
      // whatever the central directory said, so a lying header costs one entry
      // rather than the disk.
      const body = await read(zip, entry, ZIP_LIMITS.entryBytes);
      if (body === null) {
        refused.push({ path, reason: "entryUnreadable" });
        continue;
      }

      total += body.byteLength;
      entries.push({ path, bytes: body });
    }
  } finally {
    zip.close();
  }

  return { entries, refused };
}

/**
 * The entry's name, whatever yauzl handed back.
 *
 * `decodeStrings: false` makes it a Buffer at run time; the published types say
 * `string`, which is true only with the default. Both are handled rather than
 * cast away, so an upgrade that changes the default cannot turn a name into
 * `[object Object]` and slip a file through under it.
 */
function entryName(entry: Entry): string {
  const raw = entry.fileName as unknown;
  if (typeof raw === "string") return raw;
  return Buffer.from(raw as Uint8Array).toString("utf8");
}

/** `lazyEntries` turned into something a `for await` can walk. */
async function* walk(zip: ZipFile): AsyncGenerator<Entry> {
  let ended = false;
  let failed = false;
  const waiting: Entry[] = [];
  let wake: (() => void) | null = null;

  const ping = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  zip.on("entry", (entry: Entry) => {
    waiting.push(entry);
    ping();
  });
  zip.on("end", () => {
    ended = true;
    ping();
  });
  zip.on("error", () => {
    failed = true;
    ended = true;
    ping();
  });

  zip.readEntry();

  while (true) {
    const next = waiting.shift();
    if (next) {
      yield next;
      zip.readEntry();
      continue;
    }
    if (failed) throw new ArchiveRefused("corruptArchive");
    if (ended) return;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}

/**
 * One entry's bytes, counted as they arrive and cut off at `cap`.
 *
 * Returns null when the stream went past the cap — which means the central
 * directory understated the file, which means the archive was built to be
 * opened by something that trusts it — and null again when the entry is
 * corrupt, which yauzl reports as a CRC mismatch at the end of the stream.
 */
function read(zip: ZipFile, entry: Entry, cap: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new ArchiveRefused("corruptArchive"));
        return;
      }

      const parts: Buffer[] = [];
      let seen = 0;
      let settled = false;

      const done = (value: Buffer | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      stream.on("data", (chunk: Buffer) => {
        seen += chunk.byteLength;
        if (seen > cap) {
          stream.destroy();
          done(null);
          return;
        }
        parts.push(chunk);
      });
      stream.on("error", () => done(null));
      stream.on("end", () => done(Buffer.concat(parts)));
      stream.on("close", () => done(null));
    });
  });
}
