import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { importBatch } from "@/db/schema/import";
import { storageFor } from "@/storage";
import { guessImportable, type Importable, type Mapping, proposeMapping } from "./columns";
import { type Prepared, prepare } from "./run";
import { readWorkbook, type Sheet } from "./sheet";

/**
 * Screen 62, the step between "choose what to bring" and "import".
 *
 * The uploaded file is written to storage and the batch row points at it, so
 * the preview and the import read the SAME bytes. The alternative — parsing on
 * upload and keeping the result in a session — produces a preview and an import
 * that can quietly disagree about what was in the file, which is the one thing
 * this screen exists to prevent.
 */

export function storagePathFor(batchId: string, filename: string): string {
  // The batch id is the folder, so two people importing "Clients.xlsx" on the
  // same morning do not overwrite each other.
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  return `imports/${batchId}/${safe}`;
}

export type PreviewedBatch = {
  id: string;
  filename: string;
  sheetName: string | null;
  becomes: Importable;
  mapping: Mapping;
  status: string;
  headers: string[];
  prepared: Prepared;
};

/** Save the file, read it once, write down what it would do. Creates nothing else. */
export async function previewUpload(opts: {
  filename: string;
  body: Buffer;
  actorId: string;
}): Promise<PreviewedBatch> {
  const [row] = await db
    .insert(importBatch)
    .values({
      filename: opts.filename,
      becomes: "party",
      mapping: {},
      status: "mapping",
      createdBy: opts.actorId,
    })
    .returning({ id: importBatch.id });

  const batchId = row?.id as string;

  await storageFor("working").put({
    path: storagePathFor(batchId, opts.filename),
    body: opts.body,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const sheet = await firstSheet(opts.body);
  const becomes = guessImportable(sheet.headers);
  const mapping = proposeMapping(sheet.headers, becomes);
  const prepared = await prepare(sheet, mapping, becomes);

  await db
    .update(importBatch)
    .set({
      sheetName: sheet.name,
      becomes,
      mapping,
      status: "previewed",
      rowsTotal: sheet.rows.length,
      rowsSkipped: prepared.skipped.length,
      problems: prepared.problems,
    })
    .where(eq(importBatch.id, batchId));

  return {
    id: batchId,
    filename: opts.filename,
    sheetName: sheet.name,
    becomes,
    mapping,
    status: "previewed",
    headers: sheet.headers,
    prepared,
  };
}

async function firstSheet(body: Buffer): Promise<Sheet> {
  const sheets = await readWorkbook(
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  );
  const sheet = sheets[0];
  if (!sheet || sheet.rows.length === 0) throw new Error("emptySheet");
  return sheet;
}

/** Read a previewed batch back, from the stored file rather than from memory. */
export async function loadBatch(batchId: string): Promise<PreviewedBatch | null> {
  const [row] = await db.select().from(importBatch).where(eq(importBatch.id, batchId)).limit(1);
  if (!row) return null;

  const body = await storageFor("working").get(storagePathFor(row.id, row.filename));
  const sheet = await firstSheet(body);
  const becomes = row.becomes as Importable;
  const mapping = row.mapping as Mapping;
  const prepared = await prepare(sheet, mapping, becomes);

  return {
    id: row.id,
    filename: row.filename,
    sheetName: row.sheetName,
    becomes,
    mapping,
    status: row.status,
    headers: sheet.headers,
    prepared,
  };
}

export async function recentBatches(limit = 10) {
  return db.select().from(importBatch).orderBy(desc(importBatch.createdAt)).limit(limit);
}
