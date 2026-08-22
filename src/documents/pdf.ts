import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { RenderedDocument } from "./engine";
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
  let line = winAnsi(value);

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
  const line = winAnsi(value);
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
    domiciliation: "Domiciliation bancaire",
    totals: {
      totalExcl: "Total HT",
      totalVat: "TVA",
      totalIncl: "Total TTC",
      stampDuty: "Droit de timbre",
      advanceDeducted: "Avance déduite",
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
    domiciliation: "Bank details",
    totals: {
      totalExcl: "Total excl. VAT",
      totalVat: "VAT",
      totalIncl: "Total incl. VAT",
      stampDuty: "Stamp duty",
      advanceDeducted: "Advance deducted",
      discountTotal: "Discount",
      dueNow: "Net payable",
      optionsExcl: "Options not included (excl. VAT)",
    } as Record<string, string>,
  },
};

export async function toPdf(doc: RenderedDocument): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.width, A4.height]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

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
    "advanceDeducted",
    "stampDuty",
    "totalIncl",
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
