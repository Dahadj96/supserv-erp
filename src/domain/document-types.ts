import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { numberingSeries } from "@/db/schema/document";
import { documentType } from "@/db/schema/document-type";

/**
 * Screen 50 — the nineteen kinds, and what each one is.
 *
 * The mockup draws nineteen rows, but two of them are the same document under
 * two names ("Supplier goods receipt" and "Goods receipt — bon de réception",
 * both on series BR-{YYYY}-{####}). Seeding both would put two rows in a table
 * whose primary key is the kind, and give the company two names for one piece
 * of paper. The duplicate is recorded in docs/DECISIONS. The screen's own
 * footer says "Showing 1–10 of 10" over nineteen rows, so the frame was
 * mid-edit.
 *
 * Eighteen were seeded until screen 68 was built. `supplier_invoice` is the
 * nineteenth and it closes a dangling reference: `goods_receipt` has converted
 * to it on paper since the catalogue was written, and the kind did not exist.
 */

export type SeedType = {
  kind: string;
  family: "sell" | "buy" | "internal" | "correspondence";
  legalValue: string;
  numbering: "onIssue" | "reservedOnIssue" | "clientReference";
  convertsTo: string[];
  languages: string[];
  active: boolean;
  /** Null when the kind carries the client's number rather than one of ours. */
  pattern: string | null;
};

export const SEED_TYPES: SeedType[] = [
  // ── sell side ────────────────────────────────────────────────────────────
  {
    kind: "quotation",
    family: "sell",
    legalValue: "none",
    numbering: "onIssue",
    convertsTo: ["proforma", "invoice"],
    languages: ["fr", "ar"],
    active: true,
    pattern: "DEV/{YYYY}/{####}",
  },
  {
    kind: "proforma",
    family: "sell",
    legalValue: "none",
    numbering: "onIssue",
    convertsTo: ["invoice", "advance_invoice"],
    languages: ["fr", "ar", "en"],
    active: true,
    pattern: "PRO/{YYYY}/{####}",
  },
  {
    kind: "client_order",
    family: "sell",
    legalValue: "commitment",
    numbering: "clientReference",
    convertsTo: ["delivery_note", "invoice"],
    languages: ["fr"],
    active: true,
    pattern: null,
  },
  {
    /**
     * AVENANT — the paper that changes a marché after it is signed.
     *
     * The twentieth kind, and it is here rather than being a `client_order`
     * with a note because a wilaya's situation form prints "situation n° 4
     * s/marché + avenant n° 2": the amendment is counted, named and reasoned
     * about separately from the order it amends, by the client as much as by
     * us.
     *
     * `clientReference`, for the same reason `client_order` is: the number on
     * it is theirs. Its lines either point at a line of the marché — replacing
     * that line's quantity or price — or point at nothing, which adds a price
     * to the bordereau. `contractOf` composes the two, so every situation
     * raised afterwards bills against the amended contract without anybody
     * retyping it.
     */
    kind: "amendment",
    family: "sell",
    legalValue: "commitment",
    numbering: "clientReference",
    convertsTo: [],
    languages: ["fr"],
    active: true,
    pattern: null,
  },
  {
    kind: "delivery_note",
    family: "sell",
    legalValue: "proof",
    numbering: "onIssue",
    convertsTo: ["invoice"],
    languages: ["fr", "ar"],
    active: true,
    pattern: "BL-{YYYY}-{####}",
  },
  {
    kind: "invoice",
    family: "sell",
    legalValue: "accounting",
    numbering: "reservedOnIssue",
    convertsTo: ["credit_note"],
    languages: ["fr", "ar"],
    active: true,
    pattern: "SUP/{YYYY}/{####}",
  },
  {
    kind: "advance_invoice",
    family: "sell",
    legalValue: "accounting",
    numbering: "reservedOnIssue",
    convertsTo: ["invoice"],
    languages: ["fr"],
    active: true,
    pattern: "ACC/{YYYY}/{####}",
  },
  {
    kind: "situation",
    family: "sell",
    legalValue: "accounting",
    numbering: "reservedOnIssue",
    convertsTo: ["invoice"],
    languages: ["fr"],
    active: true,
    pattern: "SIT/{YYYY}/{###}",
  },
  {
    /**
     * DÉCOMPTE FINAL — the one page that closes a marché.
     *
     * The twenty-first kind. Everything on it is arithmetic over documents
     * this system already issued: the situations, what each withheld, what was
     * paid against them, and what the CCAP's penalty clause comes to. Nothing
     * on it is typed, which is the whole point — the four figures a wilaya's
     * accountant checks come from the same papers in their own file.
     *
     * It is the *projet de décompte final* the entreprise submits, not the
     * décompte général et définitif itself: that one is drawn by the service
     * contractant and notified to us, and is a paper we record rather than
     * produce.
     */
    kind: "final_account",
    family: "sell",
    legalValue: "accounting",
    numbering: "reservedOnIssue",
    convertsTo: [],
    languages: ["fr"],
    active: true,
    pattern: "DEC/{YYYY}/{###}",
  },
  {
    /**
     * LEVÉE DE RETENUE DE GARANTIE — the paper that asks for the money back.
     *
     * The twenty-second kind, and the one the catalogue has been pointing at
     * since it was written: `reception_report` has converted to it on paper
     * for months and the type did not exist, which meant nothing in this ERP
     * could ever record the retention coming back. A marché stayed in WARRANTY
     * for ever, because the only thing that ends the warranty is money
     * arriving and there was nothing for it to arrive against.
     *
     * It re-charges no VAT: the tax was paid on the situations, and this asks
     * for a part of a sum already invoiced. So `information` rather than
     * `accounting` — it is a demand, not a pièce comptable — and it appears on
     * screens 19 and 20 by KIND, because the money is genuinely owed.
     */
    kind: "retention_release",
    family: "sell",
    legalValue: "information",
    numbering: "reservedOnIssue",
    convertsTo: [],
    languages: ["fr"],
    active: true,
    pattern: "RG/{YYYY}/{###}",
  },
  {
    kind: "credit_note",
    family: "sell",
    legalValue: "accounting",
    numbering: "reservedOnIssue",
    convertsTo: [],
    languages: ["fr", "ar"],
    active: true,
    pattern: "AV/{YYYY}/{####}",
  },
  {
    kind: "statement",
    family: "sell",
    legalValue: "information",
    numbering: "onIssue",
    convertsTo: [],
    languages: ["fr"],
    active: true,
    pattern: "REL/{YYYY}/{###}",
  },

  // ── buy side ─────────────────────────────────────────────────────────────
  {
    kind: "purchase_order",
    family: "buy",
    legalValue: "commitment",
    numbering: "reservedOnIssue",
    convertsTo: ["goods_receipt"],
    languages: ["fr", "en"],
    active: true,
    pattern: "PO-{YYYY}-{####}",
  },
  {
    kind: "goods_receipt",
    family: "buy",
    legalValue: "internal",
    numbering: "onIssue",
    convertsTo: ["supplier_invoice"],
    languages: ["fr"],
    active: true,
    pattern: "BR-{YYYY}-{####}",
  },
  {
    /**
     * THE SUPPLIER'S INVOICE, and the nineteenth kind.
     *
     * `goods_receipt` has named it as a conversion target since the catalogue
     * was written, and it did not exist — a dangling reference the type test
     * has been carrying as a known gap. Screen 68 is what needed it: without a
     * record of what the supplier billed there is no third leg to the
     * three-way match, and "invoice received 1 043 700" is a figure somebody
     * reads off a piece of paper.
     *
     * `clientReference`, and the name of that numbering mode is the only thing
     * wrong with it: the number on this document is THEIRS, exactly as with a
     * client order. We never allocate one. `pattern` is null for the same
     * reason — a series that generated a number for a document somebody else
     * numbered would put two references on one invoice.
     *
     * `legalValue: accounting`, because it is: it is what the company deducts
     * VAT against, and the tax inspector asking for it will not accept "we
     * treated it as a note".
     */
    kind: "supplier_invoice",
    family: "buy",
    legalValue: "accounting",
    numbering: "clientReference",
    convertsTo: [],
    languages: ["fr", "en"],
    active: true,
    pattern: null,
  },
  {
    kind: "comparison_sheet",
    family: "buy",
    legalValue: "internal",
    numbering: "onIssue",
    convertsTo: ["purchase_order"],
    languages: ["fr"],
    active: true,
    pattern: "CS-{YYYY}-{####}",
  },

  // ── internal / site ──────────────────────────────────────────────────────
  {
    kind: "work_order",
    family: "internal",
    legalValue: "internal",
    numbering: "onIssue",
    convertsTo: ["service_report"],
    languages: ["fr"],
    active: true,
    pattern: "WO-{YYYY}-{####}",
  },
  {
    kind: "service_report",
    family: "internal",
    legalValue: "evidence",
    numbering: "onIssue",
    convertsTo: ["invoice", "reception_report"],
    languages: ["fr"],
    active: true,
    pattern: "SR-{YYYY}-{####}",
  },
  {
    kind: "reception_report",
    family: "internal",
    legalValue: "contractual",
    numbering: "onIssue",
    convertsTo: ["retention_release"],
    languages: ["fr"],
    active: true,
    pattern: "PV-{YYYY}-{###}",
  },

  // ── correspondence ───────────────────────────────────────────────────────
  {
    kind: "attestation",
    family: "correspondence",
    legalValue: "declaration",
    numbering: "onIssue",
    convertsTo: [],
    languages: ["fr", "ar"],
    active: true,
    pattern: "ATT-{YYYY}-{###}",
  },
  {
    kind: "official_letter",
    family: "correspondence",
    legalValue: "correspondence",
    numbering: "onIssue",
    convertsTo: [],
    languages: ["fr", "ar", "en"],
    active: true,
    pattern: "LT-{YYYY}-{####}",
  },
  {
    kind: "cover_letter",
    family: "correspondence",
    legalValue: "correspondence",
    numbering: "onIssue",
    convertsTo: [],
    languages: ["fr", "en"],
    active: true,
    pattern: "CL-{YYYY}-{####}",
  },
];

export const FAMILIES = ["sell", "buy", "internal", "correspondence"] as const;

export type TypeRow = {
  kind: string;
  family: string;
  legalValue: string;
  numbering: string;
  convertsTo: string[];
  languages: string[];
  active: boolean;
  /** From `numbering_series`, which owns it. Null when nothing is configured. */
  pattern: string | null;
  nextValue: number | null;
};

export async function listTypes(): Promise<TypeRow[]> {
  const rows = await db
    .select({
      kind: documentType.kind,
      family: documentType.family,
      legalValue: documentType.legalValue,
      numbering: documentType.numbering,
      convertsTo: documentType.convertsTo,
      languages: documentType.languages,
      active: documentType.active,
      pattern: numberingSeries.pattern,
      nextValue: numberingSeries.nextValue,
    })
    .from(documentType)
    .leftJoin(numberingSeries, eq(numberingSeries.kind, documentType.kind))
    .orderBy(asc(documentType.position));

  return rows;
}

/**
 * Write the catalogue down. The SERIES are not created here: a numbering
 * pattern is a decision with consequences nobody can undo — change it after the
 * first document and the year has two shapes of number in it — so day one asks
 * for the ones the company actually uses, and this only records what each kind
 * IS. The suggested pattern is shown on screen and copied on request.
 */
export async function ensureTypesExist(): Promise<number> {
  let written = 0;
  for (const [index, type] of SEED_TYPES.entries()) {
    const result = await db
      .insert(documentType)
      .values({
        kind: type.kind,
        family: type.family,
        legalValue: type.legalValue,
        numbering: type.numbering,
        convertsTo: type.convertsTo,
        languages: type.languages,
        active: type.active,
        position: index,
      })
      .onConflictDoNothing()
      .returning({ kind: documentType.kind });
    written += result.length;
  }
  return written;
}

export class TypeRefused extends Error {
  constructor(readonly reason: "noSuchType" | "inactive" | "clientNumbers") {
    super(reason);
  }
}

/**
 * What the engine needs to know before it issues: does this kind exist, is it
 * switched on, and does it take a number of ours?
 *
 * Returns null when the catalogue has not been written down yet. An empty
 * catalogue must not stop a company issuing an invoice — the kinds are a
 * convenience, not a gate, and treating "nobody has filled in screen 50" as a
 * refusal would be the system inventing a requirement.
 */
export async function issuingRules(
  kind: string,
): Promise<{ reservesNumber: boolean; active: boolean } | null> {
  const [type] = await db.select().from(documentType).where(eq(documentType.kind, kind)).limit(1);
  if (!type) return null;
  return { reservesNumber: type.numbering !== "clientReference", active: type.active };
}

export async function setActive(kind: string, active: boolean, actorId: string): Promise<void> {
  const [type] = await db.select().from(documentType).where(eq(documentType.kind, kind)).limit(1);
  if (!type) throw new TypeRefused("noSuchType");

  await db.update(documentType).set({ active }).where(eq(documentType.kind, kind));

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "document_type",
    entityId: kind,
    action: active ? "activate" : "deactivate",
    before: { active: type.active },
    after: { active },
    sourceScreen: "50",
  });
}
