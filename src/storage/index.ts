import { localStorage } from "./local";

/**
 * Two places, on purpose (screen 66):
 *   - final, human-readable documents  -> SharePoint, via Microsoft Graph
 *   - working files, uploads, scans    -> a volume on the VPS
 *
 * Everything goes through this interface so that swapping to S3, or to a server
 * in your own office, is one file — not a migration.
 */
export type StoredFile = {
  id: string;
  path: string;
  bytes: number;
  mime: string;
  driver: "local" | "sharepoint" | "s3";
  externalId?: string; // SharePoint item id, S3 key
};

export interface Storage {
  put(input: { path: string; body: Buffer; mime: string }): Promise<StoredFile>;
  get(id: string): Promise<Buffer>;
  /** A short-lived link. Files are never served straight from a public bucket. */
  signedUrl(id: string, ttlSeconds?: number): Promise<string>;
  remove(id: string): Promise<void>; // moves to the bin; never a hard delete
}

export function storageFor(purpose: "final" | "working"): Storage {
  if (purpose === "working") return localStorage;

  // final -> SharePoint: already paid for, already backed up, and openable in
  // File Explorer in three years without this application running. Needs Graph
  // Files.ReadWrite scoped to one site — the same policy conversation as the
  // mailbox, and not yet had.
  throw new Error(`storage driver for "${purpose}" arrives with the document engine (phase 3)`);
}
