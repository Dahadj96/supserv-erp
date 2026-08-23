import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertUsable,
  FolderRefused,
  READ_SUBFOLDER,
  sweepFolder,
  uniqueName,
} from "@/capture/scan/folder";
import { db } from "@/db";
import { intakeDossier, intakePage } from "@/db/schema/dossier";
import type { RenderedDocument } from "@/documents/engine";
import { toPdf } from "@/documents/pdf";

/**
 * Screen 41 — the folder the scanner writes to.
 *
 * The two behaviours worth holding down are both about not losing somebody's
 * paper: a file that reads MOVES so it is not read twice, and a file that fails
 * STAYS so nobody has to go looking for it in a folder called _unreadable.
 */
const ACTOR = "test-scan-actor";
let folder: string;
const created: string[] = [];

/** A real PDF with a real text layer, so the sweep has something to read. */
function sample(designation: string): RenderedDocument {
  return {
    number: "SCAN/2026/0001",
    kind: "invoice",
    locale: "fr",
    issuedOn: "22/08/2026",
    dateline: "Adrar, le 22 août 2026",
    company: {
      legalName: "SARL SUPSERV (TEST SCAN)",
      address: "Adrar",
      rc: "01/00-3333333 B 09",
      nif: "000116003333333",
      nis: "000116003333333001",
      ai: "16050333333",
      logoPath: null,
      phone: null,
      email: null,
    },
    counterparty: {
      legalName: "CLIENT SCAN",
      address: "Alger",
      nif: "000116004444444",
      nis: null,
      rc: null,
    },
    bank: null,
    lines: [
      {
        position: 1,
        designation,
        isOption: false,
        quantity: "1,00",
        unit: "U",
        unitPrice: "1 000,00",
        vatRate: "19 %",
        total: "1 000,00",
      },
    ],
    totals: [{ label: "totalIncl", value: "1 190,00" }],
    amountInWords: "mille cent quatre-vingt-dix dinars algériens",
    findings: [],
    template: "SUPSERV invoice — FR v1",
  };
}

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "supserv-scan-"));

  // An earlier run of this test — before ingestPdf marked a failed read as
  // failed — left rows behind. Clear anything under the test filenames so the
  // assertions below are about this run and not about that one.
  const stale = await db
    .select({ id: intakeDossier.id })
    .from(intakeDossier)
    .where(inArray(intakeDossier.filename, ["kyoScan-001.pdf", "not-really-a-pdf.pdf"]));

  if (stale.length > 0) {
    const ids = stale.map((row) => row.id);
    await db.delete(intakePage).where(inArray(intakePage.dossierId, ids));
    await db.delete(intakeDossier).where(inArray(intakeDossier.id, ids));
  }
});

afterAll(async () => {
  if (created.length > 0) {
    await db.delete(intakePage).where(inArray(intakePage.dossierId, created));
    await db.delete(intakeDossier).where(inArray(intakeDossier.id, created));
  }
  await rm(folder, { recursive: true, force: true });
});

describe("the scan folder", () => {
  it("refuses a path that is not a full path, because a service resolves it somewhere nobody expects", async () => {
    await expect(assertUsable("Scans")).rejects.toMatchObject({ reason: "notAbsolute" });
    await expect(assertUsable("")).rejects.toMatchObject({ reason: "notConfigured" });
    await expect(assertUsable(join(folder, "nope"))).rejects.toBeInstanceOf(FolderRefused);
  });

  it("reads a scanned PDF and moves it out of the way", async () => {
    await writeFile(join(folder, "kyoScan-001.pdf"), await toPdf(sample("Mégaphone portatif 25W")));

    const report = await sweepFolder({ folder, actorId: ACTOR });
    for (const item of report.items) if (item.dossierId) created.push(item.dossierId);

    expect(report.found).toBe(1);
    expect(report.read).toBe(1);
    expect(report.left).toBe(0);

    const left = await readdir(folder);
    expect(left, "the original is no longer in the way").not.toContain("kyoScan-001.pdf");
    expect(left).toContain(READ_SUBFOLDER);

    const moved = await readdir(join(folder, READ_SUBFOLDER));
    expect(moved).toHaveLength(1);
    expect(moved[0], "and it is still findable by name").toContain("kyoScan-001");
  });

  it("actually read the page, rather than just filing it", async () => {
    const [dossier] = await db
      .select()
      .from(intakeDossier)
      .where(inArray(intakeDossier.id, created));

    expect(dossier?.pages).toBe(1);
    expect(dossier?.status).toBe("review");
    expect(dossier?.locale, "guessed from what is on the page").toBe("fr");

    const pages = await db.select().from(intakePage).where(inArray(intakePage.dossierId, created));
    expect(pages[0]?.text).toContain("Mégaphone");
  });

  it("does not read the same file twice", async () => {
    const second = await sweepFolder({ folder, actorId: ACTOR });
    expect(second.found).toBe(0);
    expect(second.read).toBe(0);
  });

  it("leaves a file it cannot read exactly where it is", async () => {
    await writeFile(join(folder, "not-really-a-pdf.pdf"), "this is not a PDF at all");

    const report = await sweepFolder({ folder, actorId: ACTOR });
    for (const item of report.items) if (item.dossierId) created.push(item.dossierId);

    expect(report.left).toBe(1);
    expect(report.items[0]?.ok).toBe(false);
    expect(report.items[0]?.error).toBeTruthy();

    const left = await readdir(folder);
    expect(left, "still there, where the person put it").toContain("not-really-a-pdf.pdf");

    // And it does not leave a dossier stuck in `reading` for ever. The first
    // run of this test did exactly that, which is why the check is here.
    const stuck = await db
      .select()
      .from(intakeDossier)
      .where(eq(intakeDossier.filename, "not-really-a-pdf.pdf"));

    for (const row of stuck) created.push(row.id);
    expect(stuck.every((row) => row.status === "failed")).toBe(true);
  });

  it("ignores anything that is not a PDF", async () => {
    await writeFile(join(folder, "scan.jpg"), "not a pdf");
    const report = await sweepFolder({ folder, actorId: ACTOR });
    expect(report.items.map((i) => i.filename)).not.toContain("scan.jpg");
  });

  it("never overwrites a file already filed under the same name", () => {
    const a = uniqueName("kyoScan-001.pdf", "2026-08-22T09-00-00-000Z");
    const b = uniqueName("kyoScan-001.pdf", "2026-08-22T14-30-00-000Z");

    expect(a).not.toBe(b);
    expect(a.endsWith(".pdf")).toBe(true);
    expect(a.startsWith("kyoScan-001__")).toBe(true);
  });
});
