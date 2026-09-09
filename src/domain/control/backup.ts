import { constants } from "node:fs";
import { access, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * How old is the backup, and is it any good?
 *
 * Screen 66 is where somebody looks at storage, so it is where this belongs.
 * The ERP cannot take its own backup - that is scripts\server\backup.ps1, run
 * by a scheduled task as SYSTEM - but it can read the receipt that script
 * leaves behind and say, on a screen a person actually opens, that nothing has
 * been backed up since Tuesday.
 *
 * LAW 1. Nothing here is stored. There is no backup table and no "last backup"
 * column somebody has to remember to update: the receipt on disk is the fact,
 * the age is arithmetic against now, and a receipt that stops being written
 * makes this screen go red by itself rather than by anybody noticing.
 *
 * The script writes the receipt twice - beside the backups, and here. Here is
 * the copy this reads, because the other one lives on a drive that is
 * sometimes in somebody's bag, and a storage screen that cannot answer while
 * the drive is unplugged is a storage screen that answers only when nothing is
 * wrong.
 */

export type BackupReceipt = {
  startedAt: string;
  finishedAt: string;
  destination: string;
  offsite: boolean;
  dump: string;
  dumpBytes: number;
  files: string | null;
  filesBytes: number;
  verified: boolean;
  tablesChecked: number;
  rowsChecked: number;
};

/**
 * Worst first. A backup that is both stale AND unverified reports `failing`,
 * because the age is the smaller of the two problems.
 */
export type BackupState =
  /** No receipt has ever been written. Nothing has ever been backed up. */
  | "never"
  /** The last run did not read its own dump back, so nobody knows if it works. */
  | "failing"
  /** It works, but the last one is older than a nightly backup should be. */
  | "stale"
  /** Recent and verified, and sitting on the disk it is protecting. */
  | "sameDisk"
  | "good";

export type BackupReport = {
  state: BackupState;
  at: Date | null;
  /** Whole days, floored. Null when nothing has ever run. */
  ageDays: number | null;
  verified: boolean;
  offsite: boolean;
  destination: string | null;
  dumpBytes: number;
  filesBytes: number;
  tablesChecked: number;
  rowsChecked: number;
};

/**
 * Two, not one. A backup runs at 02:30, so at nine in the morning the newest
 * one is already half a day old and a one-day threshold would cry wolf every
 * single morning. Two days means one missed night is tolerated and two are not.
 */
export const STALE_DAYS = 2;

const NOTHING: BackupReport = {
  state: "never",
  at: null,
  ageDays: null,
  verified: false,
  offsite: false,
  destination: null,
  dumpBytes: 0,
  filesBytes: 0,
  tablesChecked: 0,
  rowsChecked: 0,
};

/** Pure, so every state below can be tested without writing a file. */
export function assessBackup(receipt: BackupReceipt | null, now = new Date()): BackupReport {
  if (!receipt) return NOTHING;

  const at = new Date(receipt.finishedAt);
  // A receipt with an unreadable date is a receipt that proves nothing. It is
  // reported as never rather than as a backup of unknown age, because the one
  // thing this screen must never do is look reassuring on bad input.
  if (Number.isNaN(at.getTime())) return NOTHING;

  const ageDays = Math.floor((now.getTime() - at.getTime()) / 86_400_000);

  const state: BackupState = !receipt.verified
    ? "failing"
    : ageDays >= STALE_DAYS
      ? "stale"
      : receipt.offsite
        ? "good"
        : "sameDisk";

  return {
    state,
    at,
    ageDays,
    verified: receipt.verified,
    offsite: receipt.offsite,
    destination: receipt.destination,
    dumpBytes: receipt.dumpBytes,
    filesBytes: receipt.filesBytes,
    tablesChecked: receipt.tablesChecked,
    rowsChecked: receipt.rowsChecked,
  };
}

/** Mirrors where backup.ps1 writes the second copy. */
export function receiptPath(): string {
  return resolve(process.cwd(), ".data", "last-backup.json");
}

export async function backupReport(now = new Date()): Promise<BackupReport> {
  let receipt: BackupReceipt | null = null;
  try {
    receipt = JSON.parse(await readFile(receiptPath(), "utf8")) as BackupReceipt;
  } catch {
    // Missing, unreadable or not JSON. All three mean the same thing to the
    // person reading the screen: there is no backup you can point at.
    receipt = null;
  }
  return assessBackup(receipt, now);
}

/* ===========================================================================
 * SCREEN: /settings/backup — task U1.
 *
 * Everything below answers the three questions the receipt cannot: when will
 * the next one run, where will it go, and how far back do the copies reach.
 *
 * None of it is stored either. `.env` is the fact about the schedule and the
 * destination — it is the file `scripts\server\backup.ps1` reads on every run —
 * and the folder listing is the fact about how far back the copies go. A
 * "backup settings" table would be a second opinion, and the script would go on
 * ignoring it.
 * ======================================================================== */

/**
 * Read one key out of `.env`, the way backup.ps1's own `EnvValue` does:
 * first match, trailing ` # comment` stripped, trimmed.
 *
 * FROM THE FILE, NOT FROM `process.env`. Two reasons, and both matter on this
 * screen. `process.env` is a snapshot taken when `next start` ran, so a
 * destination changed here would keep reading as the old one until somebody
 * restarted the ERP — and the script does not read `process.env` at all. What
 * this screen must show is what the script will read tonight, which is the
 * file.
 */
export function envValueFrom(text: string, name: string): string | null {
  const line = text.split(/\r?\n/).find((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
  if (!line) return null;
  const raw = line
    .slice(line.indexOf("=") + 1)
    .replace(/\s+#.*$/, "")
    .trim();
  return raw.length > 0 ? raw : null;
}

/** Where `.env` is. The script hardcodes `C:\SUPSERV-ERP`; this follows the app. */
export function envPath(): string {
  return resolve(process.cwd(), ".env");
}

export async function readEnvFile(): Promise<string> {
  try {
    return await readFile(envPath(), "utf8");
  } catch {
    // No .env at all is a real state on a fresh checkout, and it means every
    // value below falls back exactly as the script's own `EnvValue` would.
    return "";
  }
}

/** What install-services.ps1 registers the scheduled task with when .env is silent. */
export const DEFAULT_BACKUP_AT = "02:30";

export type Schedule = { at: string; fromEnv: boolean };

/**
 * `BACKUP_AT` is not read by backup.ps1 at all — it is read once, by
 * install-services.ps1, to build the `SUPSERV backup` trigger. So this is the
 * time the task was registered with, and the screen says exactly that rather
 * than implying the script consults it every night.
 */
export function scheduleFrom(env: string): Schedule {
  const raw = envValueFrom(env, "BACKUP_AT");
  if (raw && /^\d{1,2}:\d{2}$/.test(raw)) return { at: raw, fromEnv: true };
  return { at: DEFAULT_BACKUP_AT, fromEnv: false };
}

/** Why the script will ignore what `.env` says. Null means it will use it. */
export type DestinationRefusal =
  /** `BACKUP_LOCAL_PATH` is absent or blank. */
  | "notSet"
  /** A POSIX path — `/mnt/usb-backup` — or something not rooted. */
  | "notWindowsPath"
  /** A rooted path whose drive is not plugged into this machine. */
  | "driveMissing";

export type DestinationPlan = {
  /** Exactly what `.env` says, before any judgement. */
  configured: string | null;
  refusal: DestinationRefusal | null;
  /** Where the NEXT backup will actually be written. */
  resolved: string;
  /** The fallback: inside the repository, on the disk holding the database. */
  fallback: string;
  /** True when `resolved` sits on the same drive letter as the ERP itself. */
  sameDrive: boolean;
};

/** `C:\x` → "C:", `\\server\share` → null. Case-folded, so `c:` and `C:` agree. */
export function driveOf(path: string): string | null {
  const m = /^([a-zA-Z]):/.exec(path);
  return m ? `${(m[1] as string).toUpperCase()}:` : null;
}

/** Join with whatever separator the base already uses, so a Windows path stays one. */
function joinLike(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

/**
 * The same three refusals backup.ps1 makes, in the same order, computed here so
 * the screen can print them before the script ever runs again.
 *
 * Pure, and `driveExists` is injected, because the whole point of this function
 * is to be testable on a machine that has no D: drive — and because the one
 * state it exists to name, `/mnt/usb-backup` on Windows, must be provable
 * without a Windows machine.
 */
export function planDestination(
  configured: string | null,
  opts: { repo: string; driveExists: (drive: string) => boolean },
): DestinationPlan {
  const fallback = joinLike(opts.repo, ".data", "backups");
  const repoDrive = driveOf(opts.repo);
  const settle = (resolved: string, refusal: DestinationRefusal | null): DestinationPlan => ({
    configured,
    refusal,
    resolved,
    fallback,
    sameDrive: driveOf(resolved) !== null && driveOf(resolved) === repoDrive,
  });

  const raw = configured?.trim() ?? "";
  if (!raw) return settle(fallback, "notSet");

  // A POSIX path on Windows is not a destination, it is a leftover — and
  // silently creating C:\mnt\usb-backup is the worst outcome available.
  const rooted = /^([a-zA-Z]:[\\/]|\\\\)/.test(raw);
  if (!rooted) return settle(fallback, "notWindowsPath");

  const drive = driveOf(raw);
  if (drive && !opts.driveExists(drive)) return settle(fallback, "driveMissing");

  return settle(raw, null);
}

/** Asks the filesystem whether a drive is there. Never throws. */
async function driveIsPresent(drive: string): Promise<boolean> {
  try {
    await access(`${drive}\\`, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function destinationPlan(env?: string): Promise<DestinationPlan> {
  const text = env ?? (await readEnvFile());
  const configured = envValueFrom(text, "BACKUP_LOCAL_PATH");
  const repo = process.cwd();

  // One synchronous answer per candidate drive, resolved before the pure
  // function runs, so `planDestination` stays pure and testable.
  const drive = configured ? driveOf(configured) : null;
  const present = drive ? await driveIsPresent(drive) : false;

  return planDestination(configured, { repo, driveExists: (d) => d === drive && present });
}

/* ------------------------------------------------------ the copies that exist */

export type CopyKind = "database" | "files";

export type BackupCopy = {
  name: string;
  kind: CopyKind;
  /** As backup.ps1 stamps it: `2026-09-09-0230`. */
  stamp: string;
  takenAt: Date;
  bytes: number;
};

/**
 * The file name IS the date. backup.ps1 writes `supserv-<stamp>.dump` and
 * `files-<stamp>.zip` and its own retention rule matches on exactly this
 * pattern, so reading it back the same way means the screen and the script
 * cannot disagree about which files are backups. A modification time would be
 * the wrong fact: copying a folder to a new drive rewrites every one of them.
 */
export function parseCopyName(name: string): Omit<BackupCopy, "bytes"> | null {
  const m = /^(supserv|files)-((\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2}))\.(dump|zip)$/.exec(name);
  if (!m) return null;
  const at = new Date(Number(m[3]), Number(m[4]) - 1, Number(m[5]), Number(m[6]), Number(m[7]));
  if (Number.isNaN(at.getTime())) return null;
  return {
    name,
    kind: m[1] === "supserv" ? "database" : "files",
    stamp: m[2] as string,
    takenAt: at,
  };
}

export type CopiesReport = {
  folder: string;
  /** False when the folder is not there — an unplugged drive, or nothing has run. */
  readable: boolean;
  /** Newest first. */
  databases: BackupCopy[];
  files: BackupCopy[];
  bytes: number;
  oldest: Date | null;
  newest: Date | null;
};

export async function listCopies(folder: string): Promise<CopiesReport> {
  const empty: CopiesReport = {
    folder,
    readable: false,
    databases: [],
    files: [],
    bytes: 0,
    oldest: null,
    newest: null,
  };

  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return empty;
  }

  const copies: BackupCopy[] = [];
  for (const name of names) {
    const parsed = parseCopyName(name);
    if (!parsed) continue;
    let bytes = 0;
    try {
      bytes = (await stat(join(folder, name))).size;
    } catch {
      // Vanished between the listing and the stat. It is not there, so it is
      // not a copy anybody can restore from, and a zero says that honestly.
    }
    copies.push({ ...parsed, bytes });
  }

  const newestFirst = (a: BackupCopy, b: BackupCopy) => b.takenAt.getTime() - a.takenAt.getTime();
  const all = [...copies].sort(newestFirst);

  return {
    folder,
    readable: true,
    databases: copies.filter((c) => c.kind === "database").sort(newestFirst),
    files: copies.filter((c) => c.kind === "files").sort(newestFirst),
    bytes: copies.reduce((sum, c) => sum + c.bytes, 0),
    oldest: all.at(-1)?.takenAt ?? null,
    newest: all[0]?.takenAt ?? null,
  };
}

/* ------------------------------------------------- a run started from the ERP */

/**
 * Local time, seconds, no zone — the shape PowerShell's `.ToString("s")` writes
 * into the receipt.
 *
 * This matters more than it looks. The receipt says `2026-09-09T02:30:12` with
 * no offset, which `new Date()` reads in the server's own zone. A marker
 * written with `toISOString()` would be UTC, and in Algeria the comparison
 * "did the receipt land after this run started" would be an hour wrong — the
 * screen would call a finished backup "still running", every time.
 */
export function localStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

export type RunMarker = { startedAt: string; by: string | null };

export type RunState =
  /** Nothing is running that this screen started. */
  | "idle"
  /** Started from here, and no receipt newer than it yet. */
  | "running"
  /** Started, the window has passed, and it never wrote a receipt. */
  | "noReceipt";

/**
 * The scheduled task's own `-ExecutionTimeLimit`. A run that has not produced a
 * receipt within it did not produce one at all, and saying "still running" for
 * ever is how a screen stops being read.
 */
export const RUN_WINDOW_MINUTES = 120;

export function markerPath(): string {
  return resolve(process.cwd(), ".data", "backup-run.json");
}

/** Where the run started from this screen writes what the script printed. */
export function runLogPath(): string {
  return resolve(process.cwd(), ".data", "backup-run.log");
}

export function assessRun(
  marker: RunMarker | null,
  receipt: BackupReceipt | null,
  now = new Date(),
): { state: RunState; startedAt: Date | null; by: string | null } {
  if (!marker) return { state: "idle", startedAt: null, by: null };

  const startedAt = new Date(marker.startedAt);
  if (Number.isNaN(startedAt.getTime())) return { state: "idle", startedAt: null, by: null };

  const finished = receipt ? new Date(receipt.finishedAt) : null;
  const landed =
    finished !== null &&
    !Number.isNaN(finished.getTime()) &&
    finished.getTime() >= startedAt.getTime();

  if (landed) return { state: "idle", startedAt, by: marker.by };

  const minutes = (now.getTime() - startedAt.getTime()) / 60_000;
  return {
    state: minutes <= RUN_WINDOW_MINUTES ? "running" : "noReceipt",
    startedAt,
    by: marker.by,
  };
}

export async function readMarker(): Promise<RunMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath(), "utf8")) as RunMarker;
    return typeof parsed?.startedAt === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- the whole picture */

export type BackupScreen = {
  report: BackupReport;
  schedule: Schedule;
  destination: DestinationPlan;
  copies: CopiesReport;
  run: { state: RunState; startedAt: Date | null; by: string | null };
  /**
   * `.env` names an off-site SharePoint folder and backup.ps1 contains no code
   * that uploads anywhere. Read from the file rather than assumed, so the day
   * somebody deletes the line the screen stops mentioning it.
   */
  offsiteFolderNamed: string | null;
  /** This ERP's backup is a PowerShell script. Everywhere else, nothing runs. */
  canRunFromHere: boolean;
};

export async function backupScreen(now = new Date()): Promise<BackupScreen> {
  const env = await readEnvFile();

  let receipt: BackupReceipt | null = null;
  try {
    receipt = JSON.parse(await readFile(receiptPath(), "utf8")) as BackupReceipt;
  } catch {
    receipt = null;
  }

  const destination = await destinationPlan(env);
  const [copies, marker] = await Promise.all([listCopies(destination.resolved), readMarker()]);

  return {
    report: assessBackup(receipt, now),
    schedule: scheduleFrom(env),
    destination,
    copies,
    run: assessRun(marker, receipt, now),
    offsiteFolderNamed: envValueFrom(env, "BACKUP_SHAREPOINT_FOLDER"),
    canRunFromHere: process.platform === "win32",
  };
}

/* --------------------------------------------- changing where it writes to */

/**
 * Why a path typed on screen 66b cannot be the destination.
 *
 * Deliberately stricter than what backup.ps1 would accept. The script tolerates
 * a path on C: because it has to work on a machine nobody has fixed yet; a
 * person typing one INTO this box is choosing it, and choosing the disk the
 * database is on defeats the whole purpose. So this refuses it and says why,
 * which is the one thing the nightly warning has never managed to do.
 *
 * `sameDrive` is the honest limit of what can be known here: two partitions on
 * one physical disk look like two drives to Windows and to this function. The
 * message on screen says drive, not disk, for that reason.
 */
export type NewDestinationRefusal =
  | "blank"
  | "notWindowsPath"
  | "sameDrive"
  | "noSuchFolder"
  | "notWritable";

export function checkNewDestination(
  typed: string,
  repo: string,
): Exclude<NewDestinationRefusal, "noSuchFolder" | "notWritable"> | null {
  const raw = typed.trim();
  if (!raw) return "blank";
  if (!/^([a-zA-Z]:[\\/]|\\\\)/.test(raw)) return "notWindowsPath";
  const drive = driveOf(raw);
  if (drive !== null && drive === driveOf(repo)) return "sameDrive";
  return null;
}

/**
 * Rewrite exactly one line of `.env`, or refuse.
 *
 * `.env` holds MS_CLIENT_SECRET, the database password and the auth secret, and
 * `tests/unit/env-secrets.test.ts` exists because a copy of it once reached
 * somewhere it should not have. So: no backup copy is left behind, nothing is
 * re-serialised, and every byte except that one line is carried across
 * untouched — comments, blank lines, CRLF and all. A rewrite that reformats a
 * file holding four secrets is a rewrite nobody can review.
 *
 * It refuses rather than appends when the key is absent or doubled, because a
 * second `BACKUP_LOCAL_PATH=` line would leave the script reading the first and
 * this screen reading the first while somebody edited the second.
 */
export type WriteResult = "ok" | "envUnexpected";

export async function writeBackupDestination(path: string, on = new Date()): Promise<WriteResult> {
  let text: string;
  try {
    text = await readFile(envPath(), "utf8");
  } catch {
    return "envUnexpected";
  }

  const lines = text.split(/\r?\n/);
  const hits = lines.filter((l) => /^\s*BACKUP_LOCAL_PATH\s*=/.test(l));
  if (hits.length !== 1) return "envUnexpected";

  const replacement = `BACKUP_LOCAL_PATH=${path}          # set from /settings/backup on ${on.toISOString().slice(0, 10)}`;
  // Anchored on the one line, so the file's own newlines survive the edit.
  const next = text.replace(/^[ \t]*BACKUP_LOCAL_PATH[ \t]*=.*$/m, replacement);

  // Written beside it and renamed over it: a half-written .env is a machine
  // that cannot reach its own database. `.env.*` is git-ignored by pattern, so
  // the temporary file cannot be committed even if this crashes between them.
  const temp = `${envPath()}.writing`;
  await writeFile(temp, next, "utf8");
  await rename(temp, envPath());
  return "ok";
}
