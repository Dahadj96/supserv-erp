import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { cellText, toCsv } from "@/components/data/export-csv";
import type { ColumnDef } from "@/components/data/types";

/**
 * The bulk bar's one real action (screen 79).
 *
 * Three of its four buttons did nothing for a year, so the one that survives
 * has to be provably true to its label: the file is the ticked rows, with the
 * columns on screen, saying what the screen says.
 */

type Row = { id: string; reference: string; client: string; stage: string };

const rows: Row[] = [
  { id: "1", reference: "ENQ-2026-0141", client: "TOUATGAZ SPA", stage: "sourcing" },
  { id: "2", reference: "ENQ-2026-0142", client: 'SARL "EL BADR"; Adrar', stage: "won" },
];

const columns: ColumnDef<Row>[] = [
  { key: "reference", labelKey: "deals.reference", render: (r) => r.reference },
  { key: "client", labelKey: "deals.client", render: (r) => r.client },
  // As the real column does: a node, not a string.
  {
    key: "stage",
    labelKey: "deals.stage",
    render: (r) => createElement("span", { className: "badge" }, r.stage),
  },
];

/** Stands in for `useTranslations()`; the header reads in the person's own language. */
const label = (key: string) =>
  ({ "deals.reference": "Ref", "deals.client": "Client", "deals.stage": "Stage" })[key] ?? key;

describe("cellText", () => {
  it("reads the words out of a rendered cell", () => {
    expect(cellText(createElement("span", null, "12 Sep"))).toBe("12 Sep");
    expect(cellText(createElement("span", null, "3", " days"))).toBe("3 days");
    expect(cellText(createElement("div", null, createElement("b", null, "Won")))).toBe("Won");
  });

  it("is empty rather than inventive when a cell has no words", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText(false)).toBe("");
    expect(cellText(createElement("svg"))).toBe("");
  });
});

describe("toCsv", () => {
  it("writes the header in the interface language, then one line per row", () => {
    const lines = toCsv(rows, columns, label).split("\r\n");
    expect(lines[0]).toBe("Ref;Client;Stage");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("ENQ-2026-0141;TOUATGAZ SPA;sourcing");
  });

  it("quotes a field carrying the separator or a quote, and doubles the quote", () => {
    const lines = toCsv(rows, columns, label).split("\r\n");
    expect(lines[2]).toBe('ENQ-2026-0142;"SARL ""EL BADR""; Adrar";won');
  });

  it("exports the columns it is given, in that order — the ones on screen", () => {
    const shown = [columns[1], columns[0]] as ColumnDef<Row>[];
    const lines = toCsv([rows[0] as Row], shown, label).split("\r\n");
    expect(lines[0]).toBe("Client;Ref");
    expect(lines[1]).toBe("TOUATGAZ SPA;ENQ-2026-0141");
  });

  it("is a header and nothing else when nothing is ticked", () => {
    expect(toCsv([], columns, label)).toBe("Ref;Client;Stage");
  });
});
