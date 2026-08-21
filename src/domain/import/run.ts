import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { document } from "@/db/schema/document";
import { importBatch, importRecord } from "@/db/schema/import";
import { party, partyAlias, partyRole, person } from "@/db/schema/party";
import { asEmail, asLocale, asNif, asPhone, asText, bump, type Problems } from "./clean";
import type { Importable, Mapping, Target } from "./columns";
import type { Sheet } from "./sheet";

/**
 * Screen 62, steps 3 and 4 — Preview, then Import.
 *
 * The preview runs the identical code path as the import and simply does not
 * write. That is the only way the numbers on the preview screen can be trusted:
 * two implementations of "what would happen" drift within a month, and the one
 * people read is never the one that runs.
 */

export const UNDO_DAYS = 7;

export type PreparedParty = {
  sourceRow: number;
  legalName: string;
  tradeName: string | null;
  nif: string | null;
  nis: string | null;
  rc: string | null;
  ai: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  wilaya: string | null;
  paymentTerms: string | null;
  docLocale: "fr" | "en";
  contact: { fullName: string; job: string; email: string | null; phone: string | null } | null;
};

export type PreparedPerson = {
  sourceRow: number;
  fullName: string;
  trade: string;
  phone: string | null;
  wilaya: string | null;
  nationalId: string | null;
};

export type Prepared = {
  becomes: Importable;
  parties: PreparedParty[];
  people: PreparedPerson[];
  /** Row numbers that will not be imported, and why. */
  skipped: { rowNumber: number; reason: "noName" | "noTrade" }[];
  problems: Problems;
  /** Names that already exist here, or appear twice in the sheet itself. */
  duplicates: { rowNumber: number; name: string; existingCode: string | null }[];
};

const pick = (cells: Record<string, unknown>, mapping: Mapping, target: Target): unknown | null => {
  for (const [header, mapped] of Object.entries(mapping)) {
    if (mapped === target) return cells[header] ?? null;
  }
  return null;
};

/**
 * Turn a sheet into records, without writing anything.
 *
 * Every problem named on screen 62 is counted here and none of them stops the
 * run. A file that refuses to load until it is perfect is a file that never
 * gets loaded.
 */
export async function prepare(
  sheet: Sheet,
  mapping: Mapping,
  becomes: Importable,
): Promise<Prepared> {
  const problems: Problems = {};
  const parties: PreparedParty[] = [];
  const people: PreparedPerson[] = [];
  const skipped: Prepared["skipped"] = [];
  const seenNames = new Map<string, number>();
  const duplicates: Prepared["duplicates"] = [];

  for (const { rowNumber, cells } of sheet.rows) {
    if (becomes === "person") {
      const fullName = asText(pick(cells, mapping, "fullName"));
      const trade = asText(pick(cells, mapping, "trade"));
      if (!fullName) {
        skipped.push({ rowNumber, reason: "noName" });
        bump(problems, "noName");
        continue;
      }
      if (!trade) {
        // Screen 51 makes trade required. Inventing one from a filename would
        // put a wrong word in the column people search by.
        skipped.push({ rowNumber, reason: "noTrade" });
        bump(problems, "unreadableRows");
        continue;
      }
      people.push({
        sourceRow: rowNumber,
        fullName,
        trade,
        phone: asPhone(pick(cells, mapping, "phone")),
        wilaya: asText(pick(cells, mapping, "wilaya")),
        nationalId: asText(pick(cells, mapping, "nationalId")),
      });
      continue;
    }

    const legalName = asText(pick(cells, mapping, "legalName"));
    if (!legalName) {
      // "Rows with no client name — 4, skipped."
      skipped.push({ rowNumber, reason: "noName" });
      bump(problems, "noName");
      continue;
    }

    const nif = asNif(pick(cells, mapping, "nif"));
    if (nif.wasPresent && !nif.valid) bump(problems, "badNif");
    if (!nif.wasPresent) bump(problems, "missingNif");

    const contactName = asText(pick(cells, mapping, "contactName"));

    parties.push({
      sourceRow: rowNumber,
      legalName,
      tradeName: asText(pick(cells, mapping, "tradeName")),
      nif: nif.value,
      nis: asText(pick(cells, mapping, "nis")),
      rc: asText(pick(cells, mapping, "rc")),
      ai: asText(pick(cells, mapping, "ai")),
      email: asEmail(pick(cells, mapping, "email")),
      phone: asPhone(pick(cells, mapping, "phone")),
      address: asText(pick(cells, mapping, "address")),
      wilaya: asText(pick(cells, mapping, "wilaya")),
      paymentTerms: asText(pick(cells, mapping, "paymentTerms")),
      docLocale: asLocale(pick(cells, mapping, "docLocale")) ?? "fr",
      contact: contactName
        ? {
            fullName: contactName,
            job: asText(pick(cells, mapping, "contactJob")) ?? "unspecified",
            email: asEmail(pick(cells, mapping, "contactEmail")),
            phone: asPhone(pick(cells, mapping, "contactPhone")),
          }
        : null,
    });

    const key = legalName.toLowerCase();
    const first = seenNames.get(key);
    if (first !== undefined) {
      duplicates.push({ rowNumber, name: legalName, existingCode: null });
      bump(problems, "duplicates");
    } else {
      seenNames.set(key, rowNumber);
    }
  }

  // ...and against what is already here. Screen 62 says duplicates "will be
  // merged", but merging is screen 84's job and needs a person: this counts
  // them and the import screen offers the merge queue afterwards.
  if (parties.length > 0) {
    const names = [...new Set(parties.map((p) => p.legalName.toLowerCase()))];
    const existing = await db
      .select({ code: party.code, legalName: party.legalName })
      .from(party)
      // `inArray`, not `= any(${names})`: drizzle spreads a JS array into
      // separate placeholders, and Postgres then complains that ANY needs an
      // array on the right. This bites once per project.
      .where(
        and(
          inArray(sql`lower(${party.legalName})`, names),
          sql`${party.deletedAt} is null`,
          sql`${party.supersededBy} is null`,
        ),
      );

    const byName = new Map(existing.map((e) => [e.legalName.toLowerCase(), e.code]));
    for (const p of parties) {
      const code = byName.get(p.legalName.toLowerCase());
      if (code) {
        duplicates.push({ rowNumber: p.sourceRow, name: p.legalName, existingCode: code });
        bump(problems, "duplicates");
      }
    }
  }

  return { becomes, parties, people, skipped, problems, duplicates };
}

/**
 * Write it.
 *
 * Every record created is recorded in `import_record`, which is what makes
 * "Import can be undone — Within 7 days" true. Without that list, undo would
 * mean guessing which of four hundred companies arrived this morning.
 */
export async function runImport(opts: {
  prepared: Prepared;
  filename: string;
  sheetName: string;
  mapping: Mapping;
  actorId: string;
  /** client | supplier — a clients sheet and a suppliers sheet look identical. */
  role: string;
  /** An existing previewed batch to fill in, rather than a new one. */
  batchId?: string;
}): Promise<{ batchId: string; imported: number }> {
  const { prepared } = opts;

  return db.transaction(async (tx) => {
    const [batch] = opts.batchId
      ? await tx
          .update(importBatch)
          .set({
            status: "imported",
            rowsTotal: prepared.parties.length + prepared.people.length + prepared.skipped.length,
            rowsSkipped: prepared.skipped.length,
            problems: prepared.problems,
            importedAt: new Date(),
            undoableUntil: new Date(Date.now() + UNDO_DAYS * 86_400_000),
          })
          .where(eq(importBatch.id, opts.batchId))
          .returning({ id: importBatch.id })
      : await tx
          .insert(importBatch)
          .values({
            filename: opts.filename,
            sheetName: opts.sheetName,
            becomes: prepared.becomes,
            mapping: opts.mapping,
            status: "imported",
            rowsTotal: prepared.parties.length + prepared.people.length + prepared.skipped.length,
            rowsSkipped: prepared.skipped.length,
            problems: prepared.problems,
            createdBy: opts.actorId,
            importedAt: new Date(),
            undoableUntil: new Date(Date.now() + UNDO_DAYS * 86_400_000),
          })
          .returning({ id: importBatch.id });

    const batchId = batch?.id as string;
    const created: { entity: string; entityId: string; sourceRow: number }[] = [];

    for (const p of prepared.people) {
      const [row] = await tx
        .insert(person)
        .values({
          fullName: p.fullName,
          trade: p.trade,
          phone: p.phone,
          wilaya: p.wilaya,
          nationalId: p.nationalId,
          source: "import",
          relationship: "employee",
        })
        .returning({ id: person.id });
      created.push({ entity: "person", entityId: row?.id as string, sourceRow: p.sourceRow });
    }

    for (const p of prepared.parties) {
      const code = await nextCode(tx, opts.role);

      const [row] = await tx
        .insert(party)
        .values({
          code,
          legalName: p.legalName,
          tradeName: p.tradeName,
          nif: p.nif,
          nis: p.nis,
          rc: p.rc,
          ai: p.ai,
          email: p.email,
          phone: p.phone,
          address: p.address,
          wilaya: p.wilaya,
          paymentTerms: p.paymentTerms,
          docLocale: p.docLocale,
        })
        .returning({ id: party.id });

      const partyId = row?.id as string;
      created.push({ entity: "party", entityId: partyId, sourceRow: p.sourceRow });

      await tx.insert(partyRole).values({ partyId, role: opts.role }).onConflictDoNothing();

      // The trade name becomes an alias, exactly as it does when somebody types
      // a company by hand — screen 82 depends on that being true either way.
      if (p.tradeName) {
        await tx
          .insert(partyAlias)
          .values({ partyId, alias: p.tradeName, source: "import" })
          .onConflictDoNothing();
      }

      if (p.contact) {
        const [contact] = await tx
          .insert(person)
          .values({
            fullName: p.contact.fullName,
            trade: p.contact.job,
            email: p.contact.email,
            phone: p.contact.phone,
            employerPartyId: partyId,
            source: "import",
            relationship: "external",
          })
          .returning({ id: person.id });
        created.push({
          entity: "person",
          entityId: contact?.id as string,
          sourceRow: p.sourceRow,
        });
      }
    }

    if (created.length > 0) {
      await tx.insert(importRecord).values(created.map((c) => ({ batchId, ...c })));
    }

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "import_batch",
      entityId: batchId,
      action: "import",
      after: {
        filename: opts.filename,
        sheet: opts.sheetName,
        imported: created.length,
        skipped: prepared.skipped.length,
        problems: prepared.problems,
      },
      sourceScreen: "62",
    });

    return { batchId, imported: created.length };
  });
}

/** CL-0001 / SU-0011, allocated inside the transaction like everywhere else. */
async function nextCode(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], role: string) {
  const prefix = role === "supplier" ? "SU" : "CL";
  const [row] = await tx.execute<{ next: number }>(sql`
    select coalesce(max(substring(code from 4)::int), 0) + 1 as next
    from party where code like ${`${prefix}-%`}
  `);
  return `${prefix}-${String(row?.next ?? 1).padStart(4, "0")}`;
}

/**
 * "Import can be undone — Within 7 days."
 *
 * Undo DISCARDS, it does not delete: every record goes to the 30-day bin with a
 * reason, exactly as if somebody had discarded it by hand on screen 83. If one
 * of the imported companies has been used for something real in the meantime,
 * the discard refuses and that row is reported rather than the whole undo
 * failing — somebody has already built on it, and taking it away would break
 * whatever they built.
 */
export class UndoExpired extends Error {
  constructor(readonly expiredAt: Date) {
    super("undoExpired");
  }
}

export async function undoImport(batchId: string, actorId: string) {
  const [batch] = await db.select().from(importBatch).where(eq(importBatch.id, batchId)).limit(1);
  if (!batch) throw new Error("noSuchBatch");
  if (batch.undoneAt) return { removed: 0, kept: 0 };
  if (batch.undoableUntil && batch.undoableUntil < new Date()) {
    throw new UndoExpired(batch.undoableUntil);
  }

  const records = await db.select().from(importRecord).where(eq(importRecord.batchId, batchId));

  const reason = `Import annulé — ${batch.filename}`;
  let removed = 0;
  let kept = 0;

  const partyIds = records.filter((r) => r.entity === "party").map((r) => r.entityId);
  const personIds = records.filter((r) => r.entity === "person").map((r) => r.entityId);

  if (partyIds.length > 0) {
    // A company that has acquired a numbered document since the import is no
    // longer a draft nobody saw. It stays, and is reported.
    const used = await db
      .selectDistinct({ id: document.partyId })
      .from(document)
      .where(and(inArray(document.partyId, partyIds), isNotNull(document.number)));
    const usedIds = new Set(used.map((u) => u.id));
    const removable = partyIds.filter((id) => !usedIds.has(id));
    kept += usedIds.size;

    if (removable.length > 0) {
      await db
        .update(party)
        .set({ deletedAt: new Date(), deleteReason: reason })
        .where(inArray(party.id, removable));
      removed += removable.length;
    }
  }

  if (personIds.length > 0) {
    await db
      .update(person)
      .set({ deletedAt: new Date(), deleteReason: reason })
      .where(inArray(person.id, personIds));
    removed += personIds.length;
  }

  await db.update(importBatch).set({ undoneAt: new Date() }).where(eq(importBatch.id, batchId));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "import_batch",
    entityId: batchId,
    action: "undo",
    after: { removed, kept },
    reason,
    sourceScreen: "62",
  });

  return { removed, kept };
}

export async function listImports(limit = 20) {
  return db.select().from(importBatch).orderBy(sql`${importBatch.createdAt} desc`).limit(limit);
}
