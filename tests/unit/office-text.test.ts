import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";
import { NotReadable, officeKind, readDocx, readXlsx } from "@/capture/ocr/office";
import { buildZip } from "../helpers/zip";

/**
 * Task 1.6 — Word and Excel stop being "no preview yet".
 *
 * A CCTP is very often a .docx and a supplier's price list is nearly always an
 * .xlsx, so these were the two commonest documents in the mailbox that nothing
 * could read. Both must come back as the SAME `TextLayer` the PDF path
 * produces, because that is what makes `intake_page`, `proposeFields` and a
 * citation on screen 40 work without knowing which reader ran.
 */

/** A .docx is a zip with the body in `word/document.xml`. */
function docx(bodyXml: string): Buffer {
  return buildZip([
    {
      name: "[Content_Types].xml",
      body: Buffer.from('<?xml version="1.0"?><Types/>', "utf8"),
    },
    {
      name: "word/document.xml",
      body: Buffer.from(
        `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${bodyXml}</w:body></w:document>`,
        "utf8",
      ),
      method: 8,
    },
    // A picture, to prove the reader does not inflate what it did not ask for.
    { name: "word/media/image1.png", body: Buffer.alloc(64 * 1024, 0x89), method: 8 },
  ]);
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

async function xlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Buffer> {
  const workbook = new Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) worksheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("which reader a file needs", () => {
  it("takes the extension or the declared type", () => {
    expect(officeKind("cctp.docx", null)).toBe("docx");
    expect(officeKind("prix.xlsx", null)).toBe("xlsx");
    expect(officeKind("prix.xlsm", null)).toBe("xlsx");
    expect(officeKind("cctp.pdf", "application/pdf")).toBeNull();
    expect(officeKind("bordereau", "application/vnd.ms-excel")).toBeNull();
  });

  it("reads the extension when the sender declared nothing useful", () => {
    // Half of what arrives is `application/octet-stream`, because the type on a
    // mail attachment is whoever sent it.
    expect(officeKind("cctp.docx", "application/octet-stream")).toBe("docx");
  });
});

describe("reading a Word document", () => {
  it("gives back the paragraphs, in order, as one page", async () => {
    const layer = await readDocx(
      docx(
        [
          p("RÈGLEMENT DE LA CONSULTATION"),
          p("Article 1 — Objet"),
          p("La date limite de dépôt des offres est fixée au 30 septembre 2026."),
        ].join(""),
      ),
    );

    expect(layer.totalPages).toBe(1);
    expect(layer.pages[0]?.lines).toEqual([
      "RÈGLEMENT DE LA CONSULTATION",
      "Article 1 — Objet",
      "La date limite de dépôt des offres est fixée au 30 septembre 2026.",
    ]);
  });

  it("splits on the page breaks the AUTHOR put in, and on nothing else", async () => {
    const layer = await readDocx(
      docx(`${p("Page one")}<w:p><w:r><w:br w:type="page"/></w:r></w:p>${p("Page two")}`),
    );

    expect(layer.totalPages).toBe(2);
    expect(layer.pages[1]?.text).toContain("Page two");
    // Which is what makes a citation mean something: page 2 is page 2 because
    // somebody said so, not because a renderer guessed at paper.
    expect(layer.pages[0]?.text).not.toContain("Page two");
  });

  it("keeps a table as rows and columns", async () => {
    const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
    const layer = await readDocx(
      docx(
        `<w:tbl><w:tr>${cell("Désignation")}${cell("Qté")}</w:tr>` +
          `<w:tr>${cell("Câble U1000 R2V")}${cell("120")}</w:tr></w:tbl>`,
      ),
    );

    // A bordereau written in Word must not come out one cell per line — the
    // row is the unit a person and an extraction both read.
    expect(layer.pages[0]?.lines).toEqual(["Désignation\tQté", "Câble U1000 R2V\t120"]);
  });

  it("reads no formatting, no revision history, no identifiers", async () => {
    const layer = await readDocx(
      docx(
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' +
          "<w:r><w:rPr><w:b/></w:rPr><w:t>Objet</w:t></w:r></w:p>" +
          '<w:p><w:ins w:id="7" w:author="Ahmed"><w:r><w:t>ajouté</w:t></w:r></w:ins></w:p>',
      ),
    );

    const text = layer.pages[0]?.text ?? "";
    expect(text).toContain("Objet");
    // An inserted run is text a person typed and belongs in the document.
    expect(text).toContain("ajouté");
    // Everything else in the part is not.
    expect(text).not.toContain("Heading1");
    expect(text).not.toContain("Ahmed");
  });

  it("decodes the entities XML puts in the way of a name", async () => {
    const layer = await readDocx(docx(p("SARL SUPSERV &amp; Cie &lt;Adrar&gt;")));
    expect(layer.pages[0]?.text).toBe("SARL SUPSERV & Cie <Adrar>");
  });

  it("refuses a file that is not a .docx at all", async () => {
    await expect(readDocx(Buffer.from("this is a .doc from 2003"))).rejects.toBeInstanceOf(
      NotReadable,
    );
    // A zip with no body part is not a Word file either.
    await expect(
      readDocx(buildZip([{ name: "readme.txt", body: Buffer.from("hello") }])),
    ).rejects.toThrow(/noDocumentPart/);
  });
});

describe("reading a spreadsheet", () => {
  it("gives one page per sheet, named, with rows as tab-separated lines", async () => {
    const layer = await readXlsx(
      await xlsx([
        {
          name: "Bordereau",
          rows: [
            ["Désignation", "Unité", "Quantité"],
            ["Câble U1000 R2V 3G2.5", "ml", 1200],
          ],
        },
        { name: "Récapitulatif", rows: [["Total HT", 4_580_000]] },
      ]),
    );

    expect(layer.totalPages).toBe(2);
    expect(layer.pages[0]?.lines).toEqual([
      "Bordereau",
      "Désignation\tUnité\tQuantité",
      "Câble U1000 R2V 3G2.5\tml\t1200",
    ]);
    // The sheet's name leads its page, so a citation reads as something a
    // person can go and find.
    expect(layer.pages[1]?.lines[0]).toBe("Récapitulatif");
  });

  it("reads a formula's result, which is what the document says", async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet("Total");
    sheet.addRow([100]);
    sheet.addRow([200]);
    sheet.getCell("A3").value = { formula: "SUM(A1:A2)", result: 300, date1904: false };

    const layer = await readXlsx(Buffer.from(await workbook.xlsx.writeBuffer()));
    const text = layer.pages[0]?.text ?? "";

    expect(text).toContain("300");
    expect(text).not.toContain("SUM");
  });

  it("drops the spacer rows somebody left in the layout", async () => {
    const layer = await readXlsx(
      await xlsx([{ name: "Feuille", rows: [["Objet"], ["", "", ""], ["Suite"]] }]),
    );
    expect(layer.pages[0]?.lines).toEqual(["Feuille", "Objet", "Suite"]);
  });

  it("refuses a file that is not a workbook", async () => {
    await expect(readXlsx(Buffer.from("not a workbook"))).rejects.toBeInstanceOf(NotReadable);
  });
});

describe("the shape both readers hand back", () => {
  it("names no thin pages, because there is no picture of text to fall back from", async () => {
    const layer = await readDocx(docx(p("x")));
    // A thin page in a PDF means "this page is a scan, send it to OCR". A Word
    // page with nothing on it has nothing on it, and sending it to an OCR
    // container that does not exist would be inventing a reason to fail.
    expect(layer.thinPages).toEqual([]);
    expect(layer.needsBidi).toBe(false);
  });
});
