import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { bankAccount, COMPANY_ID, companyIdentity } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { document, documentLine } from "@/db/schema/document";
import { party } from "@/db/schema/party";
import { assertTransition, IllegalTransition } from "@/domain/control/transitions";
import { issuingRules } from "@/domain/document-types";
import type { Totals } from "@/domain/money";
import { assertCanIssue } from "@/domain/setup";
import { storageFor } from "@/storage";
import { amountInWords } from "./amount-in-words";
import { Blocked, check, type Finding } from "./compliance";
import { dateline, money, percent, settlementLabel, shortDate } from "./format";
import { reserveNumber } from "./numbering";
import { currentTemplate } from "./templates";

/**
 * Screen 70 — ONE document engine, five callers.
 *
 * "Every builder in the system asks the same service for a document. No module
 * renders a PDF itself. Change the logo once and every document changes."
 *
 * The seven steps below are that screen's middle column, in its order, and the
 * order is load-bearing: the number is reserved AFTER the compliance profile is
 * applied, so a document that fails a confirmed rule never consumes one.
 *
 * WHAT A MODULE MUST NEVER DO — the red panel on screen 70, restated here
 * because this is the file that makes it true:
 *   · render its own PDF
 *   · hard-code the company address or RC number
 *   · invent its own numbering
 *   · decide the language from the signed-in user
 *   · write a file to SharePoint directly
 */

export type Purpose = "preview" | "issue";

export type RenderRequest = {
  documentId: string;
  purpose: Purpose;
  actorId: string;
  /** Cash changes the total — screen 85, step 6. */
  settlementInCash?: boolean;
};

export type RenderedLine = {
  position: number;
  designation: string;
  /** Shown on the document, excluded from the totals. */
  isOption: boolean;
  quantity: string;
  unit: string | null;
  unitPrice: string;
  vatRate: string;
  total: string;
};

export type RenderedDocument = {
  /** Null on a preview. Screen 70: never on a preview. */
  number: string | null;
  kind: string;
  /** LAW 4 — from the counterparty, not the user. */
  locale: string;
  issuedOn: string;
  dateline: string;
  /**
   * "Mode de règlement", in the document language. Null when the draft has
   * not said — a quotation usually has not — and the renderer prints nothing
   * rather than a dash the client would read as an answer.
   */
  settlement: string | null;

  company: {
    legalName: string;
    address: string;
    rc: string;
    nif: string;
    nis: string;
    ai: string;
    logoPath: string | null;
    phone: string | null;
    email: string | null;
  };
  counterparty: {
    legalName: string;
    address: string | null;
    nif: string | null;
    nis: string | null;
    rc: string | null;
  };
  bank: { bankName: string; rib: string; agency: string | null } | null;

  lines: RenderedLine[];
  totals: { label: string; value: string }[];
  amountInWords: string;

  findings: Finding[];
  /** Which template produced this. Screen 70 wants it in the audit entry. */
  template: string;
};

export class NotRenderable extends Error {
  constructor(readonly why: string) {
    super(why);
  }
}

/**
 * What an issued document froze about the world at the moment it was issued.
 *
 * Not the lines and not the totals — those are already on the record and locked
 * by `lockedAt`. This is the master data the document PRINTS but does not own:
 * the company's own identity, the bank account on the footer, and which version
 * of the wording produced it.
 */
type Snapshot = {
  company: typeof companyIdentity.$inferSelect | null;
  bank: typeof bankAccount.$inferSelect | null;
  templateId: string | null;
  templateVersion: number;
  frozenAt: string;
};

/**
 * The one call. Five callers, five results.
 */
export async function render(request: RenderRequest): Promise<RenderedDocument> {
  const { purpose } = request;

  /* 1 ── Pulls master data ------------------------------------------------ */
  const [record] = await db
    .select()
    .from(document)
    .where(eq(document.id, request.documentId))
    .limit(1);
  if (!record) throw new NotRenderable("noSuchDocument");

  /**
   * LAW 5 — an issued document is immutable, and that includes re-issuing it.
   *
   * This used to read `if (purpose === "issue" && record.number)`, which asks
   * the wrong question. A document kind whose `numbering` is `clientReference`
   * — `client_order`, which carries the CLIENT's number rather than one of ours
   * — never gets a `number`, so that check saw null and let it through. A
   * client order could be issued as many times as somebody pressed the button,
   * and every press rewrote `lockedAt` and `renderSnapshot`: the row would
   * re-freeze against whatever the master data said today, silently, on a
   * commitment document the client already holds a copy of.
   *
   * The state, not a side effect of the state, is what says whether it has been
   * issued. `assertTransition` reads `MACHINES.document`, where `issued` has no
   * edge back to `draft` and never will.
   */
  if (purpose === "issue") {
    try {
      assertTransition("document", record.status, "issued");
    } catch (error) {
      if (error instanceof IllegalTransition) throw new NotRenderable("alreadyIssued");
      throw error;
    }
  }

  const [counterparty] = await db.select().from(party).where(eq(party.id, record.partyId)).limit(1);
  if (!counterparty) throw new NotRenderable("noCounterparty");

  const lines = await db
    .select()
    .from(documentLine)
    .where(eq(documentLine.documentId, record.id))
    .orderBy(documentLine.position);

  // Screen 71: "Reprinting an invoice from 2026 in 2029 must produce the 2026
  // document, not the current layout."
  //
  // Everything the company prints about ITSELF is master data that will change:
  // the address, the RC once the register is renewed, the bank the money should
  // go to. A document already sent to a client and filed with an accountant
  // must not quietly change when one of those does. So an issued document reads
  // the snapshot it froze at issue, and master data is only consulted for a
  // document that has not been sent to anybody yet.
  const frozen = record.renderSnapshot as Snapshot | null;

  const company = frozen
    ? frozen.company
    : ((
        await db.select().from(companyIdentity).where(eq(companyIdentity.id, COMPANY_ID)).limit(1)
      )[0] ?? null);

  const bank = frozen
    ? frozen.bank
    : ((
        await db
          .select()
          .from(bankAccount)
          .where(and(isNull(bankAccount.archivedAt), eq(bankAccount.isDefault, true)))
          .limit(1)
      )[0] ?? null);

  /* 2 ── Resolves the template -------------------------------------------- */
  //     family · kind · language · version. The locale comes from the
  //     COUNTERPARTY (LAW 4) — never from the session, never from a parameter.
  const locale = record.locale || counterparty.docLocale || "fr";

  const chosen = frozen ? null : await currentTemplate(record.kind, locale);
  const templateVersion = frozen?.templateVersion ?? chosen?.version ?? 1;
  const template = `SUPSERV ${record.kind} — ${locale.toUpperCase()} v${templateVersion}`;

  /* 3 ── Applies the compliance profile ------------------------------------ */
  //     Before the number, so a refusal costs nothing.
  const totals = (record.totals ?? {}) as Record<string, string>;
  const grandTotal = Number(totals.totalIncl ?? totals.totalExcl ?? 0);

  const findings = await check({
    kind: record.kind,
    company: company ?? null,
    counterparty,
    total: grandTotal,
    // What the draft says about itself, unless the caller knows better. Two
    // callers used to pass `false` here unconditionally, which meant the cash
    // rule could never fire on any invoice however it was going to be paid.
    settlementInCash: request.settlementInCash ?? record.settlement === "especes",
    stampDuty: Number(totals.stampDuty ?? 0),
  });

  // Screen 50 — what this KIND of document is. Null when the catalogue has not
  // been written down: an empty catalogue must not stop a company issuing an
  // invoice, because treating "nobody filled in screen 50" as a refusal would
  // be the system inventing a requirement of its own.
  const rules = await issuingRules(record.kind);

  if (purpose === "issue") {
    if (rules && !rules.active) throw new NotRenderable("typeIsOff");
    // Everything on screen 85's first four rows, plus every confirmed rule.
    await assertCanIssue();
    const blocking = findings.filter((f) => f.severity === "block");
    if (blocking.length > 0) throw new Blocked(blocking);
  }

  /* 4 ── Reserves the number ----------------------------------------------- */
  const issuedOn = record.issuedOn ? new Date(record.issuedOn) : new Date();
  let number = record.number;

  // A client purchase order carries the CLIENT's number. Generating one of ours
  // for it would invent a reference the client has never seen and cannot match
  // against their own order.
  const reservesNumber = rules?.reservesNumber ?? true;

  if (purpose === "issue") {
    // The snapshot is written in the SAME statement that takes the number, so
    // there is no instant in which a document is issued but does not know what
    // it printed.
    const snapshot: Snapshot = {
      company: company ?? null,
      bank: bank ?? null,
      templateId: chosen?.id ?? null,
      templateVersion,
      frozenAt: new Date().toISOString(),
    };

    const issuedFields = {
      status: "issued",
      issuedOn: issuedOn.toISOString().slice(0, 10),
      templateId: chosen?.id ?? null,
      templateVersion,
      renderSnapshot: snapshot,
      // LAW 5 — from this moment the totals above are frozen into the row.
      lockedAt: new Date(),
    };

    if (reservesNumber) {
      number = await db.transaction(async (tx) => {
        const allocated = await reserveNumber(tx, record.kind, issuedOn);
        await tx
          .update(document)
          .set({ ...issuedFields, number: allocated })
          .where(eq(document.id, record.id));
        return allocated;
      });
    } else {
      await db.update(document).set(issuedFields).where(eq(document.id, record.id));
    }
  }

  /* 5 ── Formats ----------------------------------------------------------- */
  //     In the DOCUMENT language, which is why `locale` is threaded everywhere
  //     rather than read from a request-scoped helper.
  const rendered: RenderedDocument = {
    number,
    kind: record.kind,
    locale,
    issuedOn: shortDate(issuedOn, locale),
    dateline: dateline(company?.wilaya ?? null, issuedOn, locale),
    settlement: settlementLabel(record.settlement, locale),

    company: {
      legalName: company?.legalName ?? "",
      address: company?.address ?? "",
      rc: company?.rc ?? "",
      nif: company?.nif ?? "",
      nis: company?.nis ?? "",
      ai: company?.ai ?? "",
      logoPath: company?.logoPath ?? null,
      phone: company?.phone ?? null,
      email: company?.email ?? null,
    },
    counterparty: {
      legalName: counterparty.legalName,
      address: counterparty.address,
      nif: counterparty.nif,
      nis: counterparty.nis,
      rc: counterparty.rc,
    },
    bank: bank ? { bankName: bank.bankName, rib: bank.rib, agency: bank.agency } : null,

    // An option line is shown and excluded from the totals (see the schema),
    // so it is rendered with its own flag rather than filtered out — the client
    // is meant to see what they did not buy.
    lines: lines.map((l) => ({
      position: l.position,
      designation: l.designation ?? "",
      isOption: l.isOption,
      quantity: money(Number(l.qty ?? 0), locale),
      unit: l.unit,
      unitPrice: money(Number(l.unitPrice ?? 0), locale),
      vatRate: percent(Number(l.vatRate ?? 0), locale),
      total: money(Number(l.totalExcl ?? 0), locale),
    })),

    totals: totalRows(record.totals, locale),

    /* 6 ── Amount in words, in the document language ----------------------- */
    amountInWords: amountInWords(grandTotal, locale, record.currency),

    findings,
    template,
  };

  /* 7 ── Files and registers ------------------------------------------------ */
  if (purpose === "issue") {
    await db.insert(auditEntry).values({
      actorId: request.actorId,
      actorKind: "user",
      entity: "document",
      entityId: record.id,
      action: "issue",
      after: {
        number,
        kind: record.kind,
        locale,
        template,
        counterparty: counterparty.code,
        warnings: findings.filter((f) => f.severity === "warn").map((f) => f.code),
      },
      sourceScreen: "70",
    });
  }

  return rendered;
}

/**
 * The totals block, in the order a reader expects and with one line per VAT
 * rate — an Algerian invoice carrying 19% and 9% lines has to show both, and a
 * single "TVA" line would be arithmetic nobody can check.
 *
 * This used to be `Object.entries(totals).map(...)`, which is why it is a
 * function now: `Totals.vatByRate` is an object, `Number({})` is NaN, and the
 * first real two-rate invoice would have printed "NaN DZD" in the VAT line.
 * Zero rows are dropped — a discount of nothing is not a line, it is noise.
 */
export function totalRows(stored: unknown, locale: string): { label: string; value: string }[] {
  const totals = (stored ?? {}) as Partial<Totals> & Record<string, unknown>;
  const rows: { label: string; value: string }[] = [];

  const push = (label: string, raw: unknown, keepZero = false) => {
    const amount = Number(raw ?? 0);
    if (!Number.isFinite(amount)) return;
    if (amount === 0 && !keepZero) return;
    rows.push({ label, value: money(amount, locale) });
  };

  push("totalExcl", totals.totalExcl, true);
  push("discountTotal", totals.discountTotal);

  const byRate = (totals.vatByRate ?? {}) as Record<string, string>;
  for (const rate of Object.keys(byRate).sort((a, b) => Number(b) - Number(a))) {
    push(`vat:${rate}`, byRate[rate], true);
  }
  // A record written before vatByRate existed still has a flat totalVat.
  if (Object.keys(byRate).length === 0) push("totalVat", totals.totalVat);

  push("advanceDeducted", totals.advanceDeducted);
  push("stampDuty", totals.stampDuty);
  push("totalIncl", totals.totalIncl, true);

  // Only when an advance actually moved the figure. "Net à payer" repeated
  // under an identical total is a line that teaches people to skim.
  if (Number(totals.advanceDeducted ?? 0) !== 0) push("dueNow", totals.dueNow, true);

  // Last, and outside the arithmetic above: what the client did NOT buy.
  push("optionsExcl", totals.optionsExcl);

  return rows;
}

/**
 * Store the rendered bytes and link them to the record.
 *
 * Screen 70: "A link on the record — the document is never a loose file."
 * SharePoint filing needs Graph Files.ReadWrite scoped to one site, which is
 * the same conversation as the mailbox and has not been had; until then the
 * bytes go to the working volume and the link still exists.
 */
export async function fileDocument(documentId: string, number: string, pdf: Buffer) {
  const path = `documents/${documentId}/${number.replace(/[^\w.-]+/g, "_")}.pdf`;
  await storageFor("working").put({ path, body: pdf, mime: "application/pdf" });
  return path;
}
