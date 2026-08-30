import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
