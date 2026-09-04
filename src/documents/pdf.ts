import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { RenderedDocument, RenderedSituation } from "./engine";
import { percent } from "./format";

/**
 * Screen 70, step 6 — "Renders: HTML → PDF."
 *
 * This is the ONLY place in the system that draws a PDF. The red panel on that
 * screen says a module must never render its own, and the way to make that
 * true is for there to be exactly one file that can.
 *
 * Everything drawn here comes from the `RenderedDocument` the engine produced.
 * Nothing is read from the database, nothing is formatted, nothing is decided.
 * If a value is wrong on the paper, it was wrong before it arrived here.
 */

/**
 * The standard fonts are WinAnsi-encoded, and `Intl` produces characters that
 * are not in WinAnsi — French thousands separators are U+202F NARROW NO-BREAK
 * SPACE, and pdf-lib throws rather than dropping them.
 *
 * They are replaced with U+00A0, which IS in WinAnsi, looks the same, and keeps
 * the number unbreakable. Discovered by the first PDF this file ever produced,
 * which did not produce it.
 */
const LOOKALIKES: Record<string, string> = {
  "\u2192": "->",
  "\u2190": "<-",
  "\u2194": "<->",
  "\u21D2": "=>",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2260": "!=",
  "\u2248": "~",
  "\u2205": "\u00D8",
  "\u03A9": "Ohm",
  "\u2032": "'",
  "\u2033": '"',
  "\u2030": " pour mille",
  "\u2022": "-",
  "\u2713": "v",
  "\u2714": "v",
  "\u2717": "x",
  "\u2605": "*",
  "\u20AC": "EUR",
  "\u2082": "2",
  "\u2083": "3",
  "\u221E": "inf",
  // Superscripts are in WinAnsi on paper and not in every embedded set;
  // "mm2" reads, a dropped glyph does not.
  "\u00B2": "2",
  "\u00B3": "3",
};

/**
 * Make a string the standard fonts can print, character by character.
 *
 * The first walk of enquiry -> PDF crashed on a designation that read
 * "Transport Adrar \u2192 base": pdf-lib throws on the first character WinAnsi
 * cannot encode, and a designation is typed by a person, who types arrows,
 * "\u2265" and "\u03A9" without a thought. A document that cannot be printed because of
 * one glyph is worse than a document with "->" in it, so anything the font
 * cannot draw becomes its nearest look-alike, and failing that "?" - visibly,
 * on the page, where a reader will notice and fix the wording.
 */
function printable(text: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of winAnsi(text)) {
    const code = ch.codePointAt(0) ?? 0;
    if (set.has(code)) out += ch;
    else out += LOOKALIKES[ch] ?? "?";
  }
  return out;
}

function winAnsi(text: string): string {
  return text
    .replace(/[   ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.098);
const MUTED = rgb(0.35, 0.35, 0.34);
const LINE = rgb(0.87, 0.87, 0.86);

type Ctx = {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
};

function text(
  ctx: Ctx,
  value: string,
  opts: {
    x?: number;
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    maxWidth?: number;
  } = {},
) {
  const size = opts.size ?? 9;
  const font = opts.bold ? ctx.bold : ctx.regular;
  let line = printable(value, font);

  // Cut rather than overflow into the next column. A designation that runs into
  // the price column is worse than one that is visibly truncated.
  if (opts.maxWidth && font.widthOfTextAtSize(line, size) > opts.maxWidth) {
    while (line.length > 4 && font.widthOfTextAtSize(`${line}...`, size) > opts.maxWidth) {
      line = line.slice(0, -1);
    }
    line = `${line.trimEnd()}...`;
  }

  ctx.page.drawText(line, {
    x: opts.x ?? MARGIN,
    y: ctx.y,
    size,
    font,
    color: opts.color ?? INK,
  });
}

function right(ctx: Ctx, value: string, edge: number, size = 9, bold = false) {
  const font = bold ? ctx.bold : ctx.regular;
  const line = printable(value, font);
  const width = font.widthOfTextAtSize(line, size);
  ctx.page.drawText(line, { x: edge - width, y: ctx.y, size, font, color: INK });
}

function rule(ctx: Ctx, from = MARGIN, to = A4.width - MARGIN) {
  ctx.page.drawLine({
    start: { x: from, y: ctx.y },
    end: { x: to, y: ctx.y },
    thickness: 0.5,
    color: LINE,
  });
}

/** The words at the top of the document, per kind and per language. */
const TITLES: Record<string, { fr: string; en: string }> = {
  invoice: { fr: "FACTURE", en: "INVOICE" },
  proforma: { fr: "FACTURE PROFORMA", en: "PROFORMA INVOICE" },
  offer: { fr: "OFFRE COMMERCIALE", en: "COMMERCIAL OFFER" },
  delivery_note: { fr: "BON DE LIVRAISON", en: "DELIVERY NOTE" },
  credit_note: { fr: "AVOIR", en: "CREDIT NOTE" },
  situation: { fr: "SITUATION DE TRAVAUX", en: "PROGRESS STATEMENT" },
};

/**
 * The words on the wilaya's "partie co-contractant" form. French is the
 * language the form exists in; the English is for a foreign client who has
 * asked for one and is a courtesy translation of the same columns.
 */
const SITUATION_WORDS = {
  fr: {
    subtitle: "Partie co-contractant",
    number: "Situation n°",
    owner: "Maître de l'ouvrage",
    contractor: "Le co-contractant",
    operation: "Opération",
    contract: "Marché n°",
    ourRef: "Notre réf.",
    wilaya: "Wilaya",
    period: "Période",
    work: "Travaux",
    columns: {
      n: "N°",
      designation: "Désignation des travaux",
      unit: "U",
      qtyContract: "Qté marché",
      unitPrice: "P.U. HT",
      qtyPrevious: "Qté précéd.",
      qtyPeriod: "Qté période",
      qtyCumul: "Qté cumulée",
      amountCumul: "Montant cumulé HT",
    },
    cumulExcl: "Montant des travaux cumulés à ce jour (HT)",
    previouslyCertified: "Travaux précédemment certifiés (HT)",
    periodExcl: "Montant de la présente situation (HT)",
    percent: "Avancement financier",
    overContract: "* quantité cumulée supérieure à la quantité du marché",
    inWords: "Arrêtée la présente situation à la somme nette de :",
    signContractor: "Le co-contractant",
    signOwner: "Le service contractant",
    signEngineer: "Vu et vérifié, l'ingénieur chargé du suivi",
    continued: "suite",
  },
  en: {
    subtitle: "Contractor's statement",
    number: "Statement no.",
    owner: "Client",
    contractor: "Contractor",
    operation: "Works",
    contract: "Contract no.",
    ourRef: "Our ref.",
    wilaya: "Wilaya",
    period: "Period",
    work: "Work done",
    columns: {
      n: "No.",
      designation: "Description of works",
      unit: "U",
      qtyContract: "Contract qty",
      unitPrice: "Unit price",
      qtyPrevious: "Previous qty",
      qtyPeriod: "Period qty",
      qtyCumul: "Cumulative qty",
      amountCumul: "Cumulative amount",
    },
    cumulExcl: "Cumulative value of works to date (excl. VAT)",
    previouslyCertified: "Previously certified works (excl. VAT)",
    periodExcl: "Value of this statement (excl. VAT)",
    percent: "Financial progress",
    overContract: "* cumulative quantity exceeds the contract quantity",
    inWords: "This statement is settled at the net sum of:",
    signContractor: "The contractor",
    signOwner: "The client",
    signEngineer: "Checked by the supervising engineer",
    continued: "continued",
  },
};

const WORDS = {
  fr: {
    client: "Client",
    designation: "Désignation",
    qty: "Qté",
    unit: "U",
    unitPrice: "P.U. HT",
    vat: "TVA",
    amount: "Montant HT",
    option: "option",
    draft: "BROUILLON — SANS VALEUR",
    inWords: "Arrêtée la présente facture à la somme de :",
    settlement: "Mode de règlement",
    domiciliation: "Domiciliation bancaire",
    totals: {
      totalExcl: "Total HT",
      totalVat: "TVA",
      totalIncl: "Total TTC",
      stampDuty: "Droit de timbre",
      advanceDeducted: "Avance déduite",
      retention: "Retenue de garantie",
      discountTotal: "Remise",
      dueNow: "Net à payer",
      optionsExcl: "Options non comprises (HT)",
    } as Record<string, string>,
  },
  en: {
    client: "Client",
    designation: "Description",
    qty: "Qty",
    unit: "U",
    unitPrice: "Unit price",
    vat: "VAT",
    amount: "Amount",
    option: "option",
    draft: "DRAFT — NOT VALID",
    inWords: "The present invoice is settled at the sum of:",
    settlement: "Payment method",
    domiciliation: "Bank details",
    totals: {
      totalExcl: "Total excl. VAT",
      totalVat: "VAT",
      totalIncl: "Total incl. VAT",
      stampDuty: "Stamp duty",
      advanceDeducted: "Advance deducted",
      retention: "Retention",
      discountTotal: "Discount",
      dueNow: "Net payable",
      optionsExcl: "Options not included (excl. VAT)",
    } as Record<string, string>,
  },
};

export async function toPdf(doc: RenderedDocument): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A situation de travaux is drawn in the wilaya's own layout — the form a
  // public client's engineer signs — and not as an invoice with extra columns.
  if (doc.situation) {
    situationPages(pdf, doc, doc.situation, regular, bold);
    return Buffer.from(await pdf.save());
  }

  const page = pdf.addPage([A4.width, A4.height]);
  const w = doc.locale === "en" ? WORDS.en : WORDS.fr;
  const edge = A4.width - MARGIN;
  const ctx: Ctx = { page, regular, bold, y: A4.height - MARGIN };

  /* ── who we are ─────────────────────────────────────────────────────── */
  text(ctx, doc.company.legalName || "—", { size: 13, bold: true });
  ctx.y -= 14;
  text(ctx, doc.company.address || "", { size: 8.5, color: MUTED });
  ctx.y -= 11;
  const reach = [doc.company.phone, doc.company.email].filter(Boolean).join(" · ");
  if (reach) {
    text(ctx, reach, { size: 8.5, color: MUTED });
  }

  /* ── what this is ───────────────────────────────────────────────────── */
  ctx.y = A4.height - MARGIN;
  const title = (TITLES[doc.kind] ?? { fr: doc.kind, en: doc.kind })[
    doc.locale === "en" ? "en" : "fr"
  ];
  right(ctx, title, edge, 13, true);
  ctx.y -= 15;
  // No number means this is a preview, and the paper must say so — screen 70
  // reserves a number only on final issue.
  right(ctx, doc.number ?? w.draft, edge, 10, true);
  ctx.y -= 13;
  right(ctx, doc.dateline, edge, 8.5);

  /* ── who it is for ──────────────────────────────────────────────────── */
  ctx.y -= 42;
  text(ctx, `${w.client}`, { size: 8, color: MUTED });
  ctx.y -= 13;
  text(ctx, doc.counterparty.legalName, { size: 10.5, bold: true });
  ctx.y -= 12;
  if (doc.counterparty.address) {
    text(ctx, doc.counterparty.address, { size: 8.5, color: MUTED });
    ctx.y -= 11;
  }
  const theirs = [
    doc.counterparty.nif ? `NIF ${doc.counterparty.nif}` : null,
    doc.counterparty.nis ? `NIS ${doc.counterparty.nis}` : null,
    doc.counterparty.rc ? `RC ${doc.counterparty.rc}` : null,
  ]
    .filter(Boolean)
    .join("   ");
  if (theirs) text(ctx, theirs, { size: 8.5, color: MUTED });

  /* ── the lines ──────────────────────────────────────────────────────── */
  ctx.y -= 26;
  rule(ctx);
  ctx.y -= 12;

  const col = {
    n: MARGIN,
    des: MARGIN + 22,
    qty: 330,
    unit: 368,
    price: 452,
    vat: 486,
    amount: edge,
  };

  text(ctx, "#", { x: col.n, size: 7.5, color: MUTED });
  text(ctx, w.designation, { x: col.des, size: 7.5, color: MUTED });
  right(ctx, w.qty, col.qty, 7.5);
  text(ctx, w.unit, { x: col.unit, size: 7.5, color: MUTED });
  right(ctx, w.unitPrice, col.price, 7.5);
  right(ctx, w.vat, col.vat, 7.5);
  right(ctx, w.amount, col.amount, 7.5);

  ctx.y -= 6;
  rule(ctx);
  ctx.y -= 14;

  for (const line of doc.lines) {
    text(ctx, String(line.position), { x: col.n, size: 8.5, color: MUTED });
    text(ctx, line.isOption ? `${line.designation} (${w.option})` : line.designation, {
      x: col.des,
      size: 8.5,
      maxWidth: col.qty - col.des - 30,
      color: line.isOption ? MUTED : INK,
    });
    right(ctx, line.quantity, col.qty, 8.5);
    if (line.unit) text(ctx, line.unit, { x: col.unit, size: 8.5, color: MUTED });
    right(ctx, line.unitPrice, col.price, 8.5);
    right(ctx, line.vatRate, col.vat, 8.5);
    right(ctx, line.total, col.amount, 8.5);
    ctx.y -= 15;

    if (ctx.y < 200) break; // one page for now; pagination arrives with long offers
  }

  ctx.y -= 4;
  rule(ctx);

  /* ── the money ──────────────────────────────────────────────────────── */
  ctx.y -= 16;
  // Total TTC goes last, whatever order the record happened to store them in.
  const order = [
    "totalExcl",
    "discountTotal",
    "vat",
    "totalVat",
    "stampDuty",
    "totalIncl",
    "retention",
    "advanceDeducted",
    "dueNow",
    "optionsExcl",
  ];
  const rank = (label: string) => {
    const at = order.indexOf(label.startsWith("vat:") ? "vat" : label);
    return at === -1 ? order.length : at;
  };
  const sorted = [...doc.totals].sort((a, b) => rank(a.label) - rank(b.label));

  for (const total of sorted) {
    // `vat:19.00` — one line per rate, because an invoice mixing 19% and 9%
    // has to show its arithmetic. The rate is formatted in the document's
    // language like every other number on the page.
    const label = total.label.startsWith("vat:")
      ? `${w.totals.totalVat} ${percent(Number(total.label.slice(4)), doc.locale)}`
      : (w.totals[total.label] ?? total.label);
    const isGrand = total.label === "totalIncl";
    text(ctx, label, {
      x: 360,
      size: isGrand ? 9.5 : 8.5,
      bold: isGrand,
      color: isGrand ? INK : MUTED,
    });
    right(ctx, total.value, edge, isGrand ? 9.5 : 8.5, isGrand);
    ctx.y -= isGrand ? 16 : 13;
  }

  /* ── the sentence a client reads when the figures are disputed ──────── */
  ctx.y -= 10;
  text(ctx, w.inWords, { size: 8, color: MUTED });
  ctx.y -= 12;
  text(ctx, doc.amountInWords, { size: 9, bold: true, maxWidth: edge - MARGIN });

  /* ── how it is to be settled — a mention décret 05-468 requires ─────── */
  if (doc.settlement) {
    ctx.y -= 14;
    text(ctx, `${w.settlement} : ${doc.settlement}`, { size: 8.5, color: MUTED });
  }

  /* ── the footer décret 05-468 requires ──────────────────────────────── */
  ctx.y = MARGIN + 52;
  rule(ctx);
  ctx.y -= 12;

  if (doc.bank) {
    text(ctx, `${w.domiciliation} — ${doc.bank.bankName}   RIB ${doc.bank.rib}`, {
      size: 7.5,
      color: MUTED,
    });
    ctx.y -= 11;
  }

  const ours = [
    doc.company.rc ? `RC ${doc.company.rc}` : null,
    doc.company.nif ? `NIF ${doc.company.nif}` : null,
    doc.company.nis ? `NIS ${doc.company.nis}` : null,
    doc.company.ai ? `AI ${doc.company.ai}` : null,
  ].filter(Boolean);

  text(ctx, ours.join("   ") || "—", { size: 7.5, color: MUTED });

  return Buffer.from(await pdf.save());
}

/* ───────────────────────────────────────────────────────────────────────── */
/* Situation de travaux — partie co-contractant                              */
/* ───────────────────────────────────────────────────────────────────────── */

/** The form's own margin: nine columns need the width. */
const FORM_MARGIN = 34;
/** Below this the table stops and continues on the next page. */
const FORM_FLOOR = 70;

/**
 * Where each column ENDS (numbers are right-aligned) or STARTS (text).
 * Widths add up to the A4 width less two form margins.
 */
const FORM_COL = {
  n: FORM_MARGIN,
  des: FORM_MARGIN + 24,
  unit: 210,
  qtyContract: 270,
  price: 330,
  qtyPrevious: 380,
  qtyPeriod: 430,
  qtyCumul: 480,
  amount: A4.width - FORM_MARGIN,
};

function formHeaderRow(ctx: Ctx, c: (typeof SITUATION_WORDS)["fr"]["columns"]) {
  rule(ctx, FORM_MARGIN, A4.width - FORM_MARGIN);
  ctx.y -= 11;
  text(ctx, c.n, { x: FORM_COL.n, size: 6.5, color: MUTED });
  text(ctx, c.designation, { x: FORM_COL.des, size: 6.5, color: MUTED });
  text(ctx, c.unit, { x: FORM_COL.unit, size: 6.5, color: MUTED });
  right(ctx, c.qtyContract, FORM_COL.qtyContract, 6.5);
  right(ctx, c.unitPrice, FORM_COL.price, 6.5);
  right(ctx, c.qtyPrevious, FORM_COL.qtyPrevious, 6.5);
  right(ctx, c.qtyPeriod, FORM_COL.qtyPeriod, 6.5);
  right(ctx, c.qtyCumul, FORM_COL.qtyCumul, 6.5);
  right(ctx, c.amountCumul, FORM_COL.amount, 6.5);
  ctx.y -= 5;
  rule(ctx, FORM_MARGIN, A4.width - FORM_MARGIN);
  ctx.y -= 12;
}

function situationPages(
  pdf: PDFDocument,
  doc: RenderedDocument,
  s: RenderedSituation,
  regular: PDFFont,
  bold: PDFFont,
) {
  const fr = doc.locale !== "en";
  const w = fr ? WORDS.fr : WORDS.en;
  const f = fr ? SITUATION_WORDS.fr : SITUATION_WORDS.en;
  const edge = A4.width - FORM_MARGIN;
  const title = TITLES.situation?.[fr ? "fr" : "en"] ?? "SITUATION";

  const ctx: Ctx = {
    page: pdf.addPage([A4.width, A4.height]),
    regular,
    bold,
    y: A4.height - FORM_MARGIN,
  };

  /* ── who we are · what this is ───────────────────────────────────────── */
  text(ctx, doc.company.legalName || "—", { x: FORM_MARGIN, size: 12, bold: true });
  right(ctx, `${title} N° ${s.sequence}`, edge, 12, true);
  ctx.y -= 13;
  text(ctx, doc.company.address || "", { x: FORM_MARGIN, size: 8, color: MUTED });
  right(ctx, f.subtitle, edge, 8.5);
  ctx.y -= 11;
  const ours = [
    doc.company.rc ? `RC ${doc.company.rc}` : null,
    doc.company.nif ? `NIF ${doc.company.nif}` : null,
    doc.company.nis ? `NIS ${doc.company.nis}` : null,
    doc.company.ai ? `AI ${doc.company.ai}` : null,
  ]
    .filter(Boolean)
    .join("   ");
  text(ctx, ours, { x: FORM_MARGIN, size: 7.5, color: MUTED });
  right(ctx, doc.number ?? w.draft, edge, 9.5, true);
  ctx.y -= 11;
  if (doc.bank) {
    text(ctx, `${w.domiciliation} — ${doc.bank.bankName}   RIB ${doc.bank.rib}`, {
      x: FORM_MARGIN,
      size: 7.5,
      color: MUTED,
    });
  }
  right(ctx, doc.dateline, edge, 8);

  /* ── the marché ──────────────────────────────────────────────────────── */
  ctx.y -= 24;
  rule(ctx, FORM_MARGIN, edge);
  ctx.y -= 13;

  const facts: [string, string | null][] = [
    [f.owner, doc.counterparty.legalName],
    [f.operation, s.object],
    [f.contract, s.contractRef],
    [f.ourRef, s.contractNumber ? `${s.projectCode} · ${s.contractNumber}` : s.projectCode],
    [f.wilaya, s.wilaya],
    [f.period, s.period],
    [f.work, s.workDone],
  ];
  const theirs = [
    doc.counterparty.nif ? `NIF ${doc.counterparty.nif}` : null,
    doc.counterparty.address,
  ]
    .filter(Boolean)
    .join(" · ");

  for (const [label, value] of facts) {
    if (!value) continue;
    text(ctx, label, { x: FORM_MARGIN, size: 7.5, color: MUTED });
    text(ctx, value, { x: FORM_MARGIN + 92, size: 8.5, bold: label === f.owner, maxWidth: 420 });
    ctx.y -= 12;
    if (label === f.owner && theirs) {
      text(ctx, theirs, { x: FORM_MARGIN + 92, size: 7.5, color: MUTED, maxWidth: 420 });
      ctx.y -= 12;
    }
  }

  /* ── the bordereau, cumulative ───────────────────────────────────────── */
  ctx.y -= 6;
  formHeaderRow(ctx, f.columns);

  let flagged = false;
  for (const row of s.rows) {
    if (ctx.y < FORM_FLOOR) {
      ctx.page = pdf.addPage([A4.width, A4.height]);
      ctx.y = A4.height - FORM_MARGIN;
      text(ctx, `${title} N° ${s.sequence} — ${f.continued}`, {
        x: FORM_MARGIN,
        size: 9,
        bold: true,
      });
      right(ctx, doc.number ?? w.draft, edge, 8.5);
      ctx.y -= 16;
      formHeaderRow(ctx, f.columns);
    }

    const claimed = Number(row.qtyPeriod.replace(/[^\d.,-]/g, "").replace(",", ".")) !== 0;
    const tone = claimed ? INK : MUTED;
    text(ctx, row.reference ?? String(row.position), { x: FORM_COL.n, size: 7.5, color: MUTED });
    text(ctx, row.overContract ? `${row.designation} *` : row.designation, {
      x: FORM_COL.des,
      size: 7.5,
      maxWidth: FORM_COL.unit - FORM_COL.des - 6,
      color: tone,
    });
    if (row.overContract) flagged = true;
    if (row.unit) text(ctx, row.unit, { x: FORM_COL.unit, size: 7.5, color: MUTED });
    right(ctx, row.qtyContract, FORM_COL.qtyContract, 7.5);
    right(ctx, row.unitPrice, FORM_COL.price, 7.5);
    right(ctx, row.qtyPrevious, FORM_COL.qtyPrevious, 7.5);
    right(ctx, row.qtyPeriod, FORM_COL.qtyPeriod, 7.5, claimed);
    right(ctx, row.qtyCumul, FORM_COL.qtyCumul, 7.5);
    right(ctx, row.amountCumul, FORM_COL.amount, 7.5);
    ctx.y -= 13;
  }

  ctx.y -= 2;
  rule(ctx, FORM_MARGIN, edge);

  /* ── the décompte ────────────────────────────────────────────────────── */
  // The summary and the signatures stay together: a signature block on a page
  // of its own is a page a client can lose.
  if (ctx.y < 300) {
    ctx.page = pdf.addPage([A4.width, A4.height]);
    ctx.y = A4.height - FORM_MARGIN;
    text(ctx, `${title} N° ${s.sequence} — ${f.continued}`, {
      x: FORM_MARGIN,
      size: 9,
      bold: true,
    });
    right(ctx, doc.number ?? w.draft, edge, 8.5);
    ctx.y -= 10;
  }

  ctx.y -= 14;
  const labelX = 250;
  const line = (label: string, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? 8.5;
    text(ctx, label, { x: labelX, size, bold: opts.bold, color: opts.bold ? INK : MUTED });
    right(ctx, value, edge, size, opts.bold);
    ctx.y -= opts.bold ? 15 : 13;
  };

  line(f.cumulExcl, s.cumulExcl);
  line(f.previouslyCertified, `- ${s.previouslyCertifiedExcl}`);
  line(f.periodExcl, s.periodExcl, { bold: true });

  // The VAT block and what comes off — the engine's rows, in the order a
  // reader subtracts in. `totalExcl` is dropped because the line above already
  // says it, in the form's own words.
  const order = [
    "vat",
    "totalVat",
    "stampDuty",
    "totalIncl",
    "retention",
    "advanceDeducted",
    "dueNow",
  ];
  const rank = (label: string) => {
    const at = order.indexOf(label.startsWith("vat:") ? "vat" : label);
    return at === -1 ? order.length : at;
  };
  const rows = doc.totals
    .filter((t) => t.label !== "totalExcl" && t.label !== "optionsExcl")
    .sort((a, b) => rank(a.label) - rank(b.label));
  for (const total of rows) {
    const label = total.label.startsWith("vat:")
      ? `${w.totals.totalVat} ${percent(Number(total.label.slice(4)), doc.locale)}`
      : total.label === "retention"
        ? `${w.totals.retention} ${percent(Number(s.retentionPct), doc.locale)}`
        : (w.totals[total.label] ?? total.label);
    const deducts = total.label === "retention" || total.label === "advanceDeducted";
    const strong = total.label === "dueNow" || total.label === "totalIncl";
    line(label, deducts ? `- ${total.value}` : total.value, {
      bold: strong,
      size: total.label === "dueNow" ? 9.5 : 8.5,
    });
  }

  if (s.percentOfContract !== null) {
    text(ctx, `${f.percent} : ${s.percentOfContract} %`, {
      x: FORM_MARGIN,
      size: 7.5,
      color: MUTED,
    });
  }
  if (flagged) {
    ctx.y -= 11;
    text(ctx, f.overContract, { x: FORM_MARGIN, size: 7, color: MUTED });
  }

  /* ── in words, then the three signatures the form carries ────────────── */
  ctx.y -= 16;
  text(ctx, f.inWords, { x: FORM_MARGIN, size: 8, color: MUTED });
  ctx.y -= 12;
  text(ctx, doc.amountInWords, {
    x: FORM_MARGIN,
    size: 9,
    bold: true,
    maxWidth: edge - FORM_MARGIN,
  });

  ctx.y -= 34;
  const third = (edge - FORM_MARGIN) / 3;
  const boxes = [f.signContractor, f.signEngineer, f.signOwner];
  boxes.forEach((label, i) => {
    const x = FORM_MARGIN + third * i;
    text(ctx, label, { x, size: 7.5, color: MUTED, maxWidth: third - 8 });
  });
  ctx.y -= 52;
  boxes.forEach((_, i) => {
    const x = FORM_MARGIN + third * i;
    ctx.page.drawLine({
      start: { x, y: ctx.y },
      end: { x: x + third - 12, y: ctx.y },
      thickness: 0.5,
      color: LINE,
    });
  });

  /* ── the footer décret 05-468 requires ──────────────────────────────── */
  ctx.y = FORM_MARGIN + 14;
  rule(ctx, FORM_MARGIN, edge);
  ctx.y -= 11;
  text(ctx, `${doc.company.legalName}   ${ours}`, { x: FORM_MARGIN, size: 7, color: MUTED });
}
