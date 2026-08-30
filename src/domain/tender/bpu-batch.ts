import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { importBatch } from "@/db/schema/import";
import { storageFor } from "@/storage";
import { storagePathFor } from "../import/batch";
import { readWorkbook, type Sheet } from "../import/sheet";
import type { BpuLine } from "./bpu";
import {
  type BpuMapping,
  type BpuRead,
  linesFromSheet,
  missingTargets,
  proposeBpuMapping,
} from "./bpu-columns";
import { importBpu, recordErratum, rememberedMapping, saveMapping } from "./bpu-store";

/**
 * Screen 42, the upload.
 *
 * The same two-step shape as screen 62 and for the same stated reason: the file
 * is written to storage and read TWICE — once to propose the mapping, once to
 * apply the confirmed one — so the preview and the import cannot quietly
 * disagree about what was in the spreadsheet.
 *
 * `import_batch` is reused rather than copied. A bordereau is a sheet somebody
 * uploaded, it has a filename, a mapping, a row count and a list of problems,
 * and screen 62's row already holds all five.
 */

export type BpuKind = "deal_line" | "bpu_erratum";

export class BpuUnreadable extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "BpuUnreadable";
  }
}

export type BpuPreview = {
  batchId: string;
  dealId: string;
  kind: BpuKind;
  filename: string;
  sheetName: string | null;
  headers: string[];
  mapping: BpuMapping;
  /** True when the mapping came from this client's confirmed one, not a guess. */
  remembered: boolean;
  missing: ReturnType<typeof missingTargets>;
  read: BpuRead;
};

async function firstSheet(body: Buffer): Promise<Sheet> {
  const sheets = await readWorkbook(
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  );
  const sheet = sheets[0];
  if (!sheet || sheet.rows.length === 0) throw new BpuUnreadable("emptySheet");
  return sheet;
}

/** Step 1 — keep the file, read it, and say what it looks like. Writes no lines. */
export async function previewBpu(opts: {
  dealId: string;
  partyId: string;
  kind: BpuKind;
  filename: string;
  body: Buffer;
  actorId: string;
}): Promise<BpuPreview> {
  const [row] = await db
    .insert(importBatch)
    .values({
      filename: opts.filename,
      becomes: opts.kind,
      dealId: opts.dealId,
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

  /**
   * The client's confirmed mapping wins over the proposal, and only where its
   * headings are the ones in this file. A remembered mapping applied to a sheet
   * with different columns would map nothing and look like it had.
   */
  const known = await rememberedMapping(opts.partyId);
  const proposed = proposeBpuMapping(sheet.headers);
  const usable = known !== null && sheet.headers.every((heading) => heading in known);
  const mapping: BpuMapping = usable
    ? Object.fromEntries(sheet.headers.map((heading) => [heading, known[heading] ?? null]))
    : proposed;

  const read = linesFromSheet(sheet.rows, mapping);

  await db
    .update(importBatch)
    .set({
      sheetName: sheet.name,
      mapping,
      status: "previewed",
      rowsTotal: sheet.rows.length,
      rowsSkipped: read.problems.length,
      problems: read.problems,
    })
    .where(eq(importBatch.id, batchId));

  return {
    batchId,
    dealId: opts.dealId,
    kind: opts.kind,
    filename: opts.filename,
    sheetName: sheet.name,
    headers: sheet.headers,
    mapping,
    remembered: usable,
    missing: missingTargets(mapping),
    read,
  };
}

/** Read a previewed batch back, from the stored file rather than from memory. */
export async function loadBpuBatch(
  batchId: string,
  override?: BpuMapping,
): Promise<BpuPreview | null> {
  const [row] = await db.select().from(importBatch).where(eq(importBatch.id, batchId)).limit(1);
  if (!row?.dealId) return null;

  const body = await storageFor("working").get(storagePathFor(row.id, row.filename));
  const sheet = await firstSheet(body);
  const mapping = override ?? (row.mapping as BpuMapping);

  return {
    batchId: row.id,
    dealId: row.dealId,
    kind: row.becomes as BpuKind,
    filename: row.filename,
    sheetName: row.sheetName,
    headers: sheet.headers,
    mapping,
    remembered: false,
    missing: missingTargets(mapping),
    read: linesFromSheet(sheet.rows, mapping),
  };
}

/**
 * Step 2 — the mapping a person confirmed, applied to the same bytes.
 *
 * The mapping is remembered for the client here and nowhere else, because this
 * is the only moment somebody has actually looked at it and said yes.
 */
export async function commitBpuBatch(opts: {
  batchId: string;
  partyId: string;
  mapping: BpuMapping;
  actorId: string;
  receivedOn?: string | null;
}): Promise<{ kind: BpuKind; lines: BpuLine[]; problems: BpuRead["problems"] }> {
  if (missingTargets(opts.mapping).length > 0) throw new BpuUnreadable("mappingIncomplete");

  const batch = await loadBpuBatch(opts.batchId, opts.mapping);
  if (!batch) throw new BpuUnreadable("noSuchBatch");
  if (batch.read.lines.length === 0) throw new BpuUnreadable("noLines");

  await saveMapping({ partyId: opts.partyId, mapping: opts.mapping, actorId: opts.actorId });

  if (batch.kind === "deal_line") {
    await importBpu({
      dealId: batch.dealId,
      lines: batch.read.lines,
      filename: batch.filename,
      actorId: opts.actorId,
    });
  } else {
    await recordErratum({
      dealId: batch.dealId,
      lines: batch.read.lines,
      filename: batch.filename,
      receivedOn: opts.receivedOn ?? null,
      actorId: opts.actorId,
    });
  }

  await db
    .update(importBatch)
    .set({
      mapping: opts.mapping,
      status: "imported",
      rowsImported: batch.read.lines.length,
      rowsSkipped: batch.read.problems.length,
      problems: batch.read.problems,
      importedAt: new Date(),
    })
    .where(eq(importBatch.id, opts.batchId));

  return { kind: batch.kind, lines: batch.read.lines, problems: batch.read.problems };
}

/** Every sheet this enquiry's bordereau has been read from. Screen 42's Sources tab. */
export async function bpuSources(dealId: string) {
  return db
    .select({
      id: importBatch.id,
      filename: importBatch.filename,
      sheetName: importBatch.sheetName,
      becomes: importBatch.becomes,
      status: importBatch.status,
      rowsTotal: importBatch.rowsTotal,
      rowsImported: importBatch.rowsImported,
      rowsSkipped: importBatch.rowsSkipped,
      problems: importBatch.problems,
      createdBy: importBatch.createdBy,
      createdAt: importBatch.createdAt,
    })
    .from(importBatch)
    .where(eq(importBatch.dealId, dealId))
    .orderBy(desc(importBatch.createdAt));
}
