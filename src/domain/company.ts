import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bankAccount, COMPANY_ID, companyIdentity, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { numberingSeries } from "@/db/schema/document";

/**
 * Screen 85 — the four things the system will not invent.
 *
 * Everything here is written once by a person and read everywhere. No template
 * holds the address; there is one row, and eighteen templates read it.
 */

/** décret 05-468. Fifteen digits for the NIF, and the paper is the authority. */
export const identityInput = z.object({
  legalName: z.string({ error: "legalNameRequired" }).trim().min(2, "legalNameRequired"),
  tradeName: z.string().trim().optional().or(z.literal("")),
  legalForm: z.string().trim().optional().or(z.literal("")),
  capital: z.string().trim().optional().or(z.literal("")),
  rc: z.string({ error: "rcRequired" }).trim().min(1, "rcRequired"),
  nif: z
    .string({ error: "nifFifteenDigits" })
    .trim()
    .regex(/^\d{15}$/, "nifFifteenDigits"),
  nis: z.string({ error: "nisRequired" }).trim().min(1, "nisRequired"),
  ai: z.string({ error: "aiRequired" }).trim().min(1, "aiRequired"),
  address: z.string({ error: "addressRequired" }).trim().min(4, "addressRequired"),
  wilaya: z.string().trim().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email("emailInvalid").optional().or(z.literal("")),
  website: z.string().trim().optional().or(z.literal("")),
});

export type IdentityInput = z.infer<typeof identityInput>;

const blank = (v: string | undefined) => (v && v.length > 0 ? v : null);

export async function getIdentity() {
  const [row] = await db
    .select()
    .from(companyIdentity)
    .where(eq(companyIdentity.id, COMPANY_ID))
    .limit(1);
  return row ?? null;
}

export async function saveIdentity(input: IdentityInput, actorId: string) {
  const data = identityInput.parse(input);
  const before = await getIdentity();

  const values = {
    id: COMPANY_ID,
    legalName: data.legalName,
    tradeName: blank(data.tradeName),
    legalForm: blank(data.legalForm),
    capital: blank(data.capital),
    rc: data.rc,
    nif: data.nif,
    nis: data.nis,
    ai: data.ai,
    address: data.address,
    wilaya: blank(data.wilaya),
    phone: blank(data.phone),
    email: blank(data.email),
    website: blank(data.website),
    updatedAt: new Date(),
    updatedBy: actorId,
  };

  await db
    .insert(companyIdentity)
    .values(values)
    .onConflictDoUpdate({ target: companyIdentity.id, set: values });

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "company_identity",
    entityId: COMPANY_ID,
    action: before ? "update" : "create",
    before: before ? { rc: before.rc, nif: before.nif, nis: before.nis, ai: before.ai } : null,
    after: { rc: data.rc, nif: data.nif, nis: data.nis, ai: data.ai },
    // Every invoice already issued carries the OLD identity. It is frozen into
    // the document (LAW 5); changing this row does not and must not reach it.
    reason: before ? "identityChanged" : null,
    sourceScreen: "85",
  });
}

export async function setLogo(path: string, actorId: string) {
  await db
    .update(companyIdentity)
    .set({ logoPath: path, updatedAt: new Date(), updatedBy: actorId })
    .where(eq(companyIdentity.id, COMPANY_ID));
}

/* ------------------------------------------------------------- VAT rates */

/**
 * Every message here is a KEY, never a sentence — the action puts it straight
 * into `?error=` and the page renders `t("setup.error." + key)`.
 *
 * The type-level `error` matters as much as the rule-level one. Without it a
 * field that arrives missing rather than empty produces Zod's own English
 * ("Invalid input: expected string, received undefined"), the key does not
 * resolve, and screen 85 shows that sentence in brackets to somebody typing in
 * their company's registration number. `tests/unit/setup-errors.test.ts` asks
 * these four schemas what they will actually say.
 */
export const vatInput = z.object({
  rate: z
    .string({ error: "rateInvalid" })
    .trim()
    .regex(/^\d{1,2}([.,]\d{1,3})?$/, "rateInvalid"),
  kind: z.enum(["normal", "reduced", "exempt"], { error: "kindRequired" }),
  startsOn: z
    .string({ error: "startDateRequired" })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "startDateRequired"),
  authority: z.string().trim().optional().or(z.literal("")),
});

export type VatInput = z.infer<typeof vatInput>;

export async function listVatRates() {
  return db.select().from(vatRate).orderBy(desc(vatRate.startsOn));
}

/**
 * Add a rate. Never edit one.
 *
 * Screen 85: "When they change you add a new rate rather than editing the old
 * one, so last year's invoices still recompute correctly." So adding a rate
 * CLOSES its predecessor of the same kind rather than replacing it — the old
 * row keeps its dates and every document issued under it keeps its arithmetic.
 */
export async function addVatRate(input: VatInput, actorId: string) {
  const data = vatInput.parse(input);
  const rate = data.rate.replace(",", ".");

  return db.transaction(async (tx) => {
    const open = await tx.select().from(vatRate).where(eq(vatRate.kind, data.kind));

    for (const previous of open.filter((r) => r.endsOn === null)) {
      await tx.update(vatRate).set({ endsOn: data.startsOn }).where(eq(vatRate.id, previous.id));
    }

    const [created] = await tx
      .insert(vatRate)
      .values({
        rate,
        kind: data.kind,
        startsOn: data.startsOn,
        authority: blank(data.authority),
      })
      .returning({ id: vatRate.id });

    await tx.insert(auditEntry).values({
      actorId,
      actorKind: "user",
      entity: "vat_rate",
      entityId: created?.id ?? "",
      action: "create",
      after: { rate, kind: data.kind, startsOn: data.startsOn, authority: data.authority },
      sourceScreen: "85",
    });

    return created?.id as string;
  });
}

/** The rate in force on a date. What a priced line asks for. */
export async function rateOn(kind: string, on: string): Promise<number | null> {
  const rows = await db
    .select()
    .from(vatRate)
    .where(eq(vatRate.kind, kind))
    .orderBy(desc(vatRate.startsOn));

  const hit = rows.find((r) => r.startsOn <= on && (r.endsOn === null || r.endsOn > on));
  return hit ? Number(hit.rate) : null;
}

/* ---------------------------------------------------------- bank accounts */

export const bankInput = z.object({
  bankName: z.string({ error: "bankRequired" }).trim().min(2, "bankRequired"),
  agency: z.string().trim().optional().or(z.literal("")),
  rib: z
    .string({ error: "ribTwentyDigits" })
    .trim()
    .regex(/^\d[\d\s]{18,26}\d$/, "ribTwentyDigits")
    .transform((v) => v.replace(/\s+/g, "")),
  iban: z.string().trim().optional().or(z.literal("")),
  swift: z.string().trim().optional().or(z.literal("")),
  currency: z.string().trim().default("DZD"),
});

export type BankInput = z.infer<typeof bankInput>;

export async function listBankAccounts() {
  return db.select().from(bankAccount).where(isNull(bankAccount.archivedAt));
}

export async function addBankAccount(input: BankInput, actorId: string) {
  const data = bankInput.parse(input);
  const existing = await listBankAccounts();

  const [created] = await db
    .insert(bankAccount)
    .values({
      bankName: data.bankName,
      agency: blank(data.agency),
      rib: data.rib,
      iban: blank(data.iban),
      swift: blank(data.swift),
      currency: data.currency || "DZD",
      // The first account is the default by arithmetic, not by a choice
      // somebody has to remember to make.
      isDefault: existing.length === 0,
    })
    .returning({ id: bankAccount.id });

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "bank_account",
    entityId: created?.id ?? "",
    action: "create",
    after: { bankName: data.bankName, rib: `…${data.rib.slice(-4)}` },
    sourceScreen: "85",
  });

  return created?.id as string;
}

/* ------------------------------------------------------ numbering series */

/**
 * Screen 85, the amber panel: "SUP/2026/0001 or FA-2026-001 — the shape is
 * yours. Once the first document is issued the shape is frozen for the year,
 * because a series with two shapes in it is a series nobody can defend."
 */
export const seriesInput = z.object({
  kind: z.string({ error: "kindRequired" }).trim().min(2, "kindRequired"),
  pattern: z
    .string({ error: "patternNeedsCounter" })
    .trim()
    .regex(/\{#+\}/, "patternNeedsCounter")
    .refine((p) => p.includes("{YYYY}") || p.includes("{YY}"), "patternNeedsYear"),
  reset: z.enum(["yearly", "never"]).default("yearly"),
});

export type SeriesInput = z.infer<typeof seriesInput>;

export async function listSeries() {
  return db.select().from(numberingSeries);
}

export async function addSeries(input: SeriesInput, actorId: string) {
  const data = seriesInput.parse(input);

  const [created] = await db
    .insert(numberingSeries)
    .values({ kind: data.kind, pattern: data.pattern, reset: data.reset, nextValue: 1 })
    .returning({ id: numberingSeries.id });

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "numbering_series",
    entityId: created?.id ?? "",
    action: "create",
    after: { kind: data.kind, pattern: data.pattern, reset: data.reset },
    sourceScreen: "85",
  });

  return created?.id as string;
}

/** What the next document of this kind would be called. Shown, never allocated. */
export function previewNumber(pattern: string, next: number, year = new Date().getFullYear()) {
  return pattern
    .replace("{YYYY}", String(year))
    .replace("{YY}", String(year).slice(-2))
    .replace(/\{(#+)\}/, (_, hashes: string) => String(next).padStart(hashes.length, "0"));
}
