import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { party, partyAlias, partyRole } from "@/db/schema/party";
import { liveParty } from "./deletion";

/**
 * Screens 21 and 22 — companies.
 *
 * One table for every organisation we deal with. A company that is both a
 * client and a supplier is normal, so roles are additive, never exclusive.
 */

export const PARTY_ROLES = [
  "client",
  "supplier",
  "authority",
  "subcontractor",
  "partner",
  "prospect",
] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

/** The code prefix follows the role the company was first entered as. */
const CODE_PREFIX: Record<PartyRole, string> = {
  client: "CL",
  supplier: "SU",
  authority: "AU",
  subcontractor: "ST",
  partner: "PA",
  prospect: "PR",
};

/**
 * Only `legalName` and one role are required.
 *
 * The décret 05-468 fields are deliberately optional here. A company arrives
 * from an email long before anyone has its NIF, and refusing to record it until
 * the paperwork is complete is how people end up keeping a second list in
 * Excel. The rule bites at invoice time instead — `blocking_rule` already
 * carries `invoice.client_nif_missing`, which explains itself and names the
 * décret rather than silently blocking a form.
 */
export const partyInput = z.object({
  legalName: z.string().trim().min(2, "legalNameTooShort"),
  tradeName: z.string().trim().optional().or(z.literal("")),
  roles: z.array(z.enum(PARTY_ROLES)).min(1, "roleRequired"),
  nif: z
    .string()
    .trim()
    .regex(/^\d{15}$/, "nifFifteenDigits")
    .optional()
    .or(z.literal("")),
  nis: z.string().trim().optional().or(z.literal("")),
  rc: z.string().trim().optional().or(z.literal("")),
  ai: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email("emailInvalid").optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  address: z.string().trim().optional().or(z.literal("")),
  wilaya: z.string().trim().optional().or(z.literal("")),
  /** LAW 4 — documents follow the counterparty, and this is where that is set. */
  docLocale: z.enum(["fr", "en"]).default("fr"),
  emailLocale: z.enum(["fr", "en"]).default("fr"),
  currency: z.string().trim().default("DZD"),
  paymentTerms: z.string().trim().optional().or(z.literal("")),
});

export type PartyInput = z.infer<typeof partyInput>;

const blank = (v: string | undefined) => (v && v.length > 0 ? v : null);

/** CL-0001, SU-0011. Allocated inside the insert so two people cannot collide. */
async function nextCode(tx: typeof db, role: PartyRole): Promise<string> {
  const prefix = CODE_PREFIX[role];
  const rows = await tx.execute<{ next: number }>(sql`
    select coalesce(max(nullif(regexp_replace(code, '^' || ${prefix} || '-', ''), '')::int), 0) + 1 as next
    from party
    where code ~ ('^' || ${prefix} || '-[0-9]+$')
  `);
  const next = rows[0]?.next ?? 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

export async function createParty(input: PartyInput, actorId: string) {
  const data = partyInput.parse(input);

  return db.transaction(async (tx) => {
    const code = await nextCode(tx as unknown as typeof db, data.roles[0] as PartyRole);

    const [created] = await tx
      .insert(party)
      .values({
        code,
        legalName: data.legalName,
        tradeName: blank(data.tradeName),
        nif: blank(data.nif),
        nis: blank(data.nis),
        rc: blank(data.rc),
        ai: blank(data.ai),
        email: blank(data.email),
        phone: blank(data.phone),
        address: blank(data.address),
        wilaya: blank(data.wilaya),
        docLocale: data.docLocale,
        emailLocale: data.emailLocale,
        currency: data.currency,
        paymentTerms: blank(data.paymentTerms),
      })
      .returning({ id: party.id, code: party.code });

    if (!created) throw new Error("Could not create the company");

    await tx
      .insert(partyRole)
      .values(data.roles.map((role) => ({ partyId: created.id, role })))
      .onConflictDoNothing();

    // The trade name is a spelling people will search by, so it is an alias
    // from the start rather than something screen 84 has to discover later.
    if (data.tradeName && data.tradeName.toLowerCase() !== data.legalName.toLowerCase()) {
      await tx
        .insert(partyAlias)
        .values({ partyId: created.id, alias: data.tradeName, source: "typed" })
        .onConflictDoNothing();
    }

    await tx.insert(auditEntry).values({
      actorId,
      entity: "party",
      entityId: created.id,
      action: "create",
      after: { code: created.code, legalName: data.legalName },
      sourceScreen: "22",
    });

    return created;
  });
}

export async function updateParty(id: string, input: PartyInput, actorId: string) {
  const data = partyInput.parse(input);

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(party).where(eq(party.id, id)).limit(1);
    if (!before) throw new Error("No such company");
    if (before.supersededBy) throw new Error("This company was merged into another");

    await tx
      .update(party)
      .set({
        legalName: data.legalName,
        tradeName: blank(data.tradeName),
        nif: blank(data.nif),
        nis: blank(data.nis),
        rc: blank(data.rc),
        ai: blank(data.ai),
        email: blank(data.email),
        phone: blank(data.phone),
        address: blank(data.address),
        wilaya: blank(data.wilaya),
        docLocale: data.docLocale,
        emailLocale: data.emailLocale,
        currency: data.currency,
        paymentTerms: blank(data.paymentTerms),
      })
      .where(eq(party.id, id));

    await tx.delete(partyRole).where(eq(partyRole.partyId, id));
    await tx
      .insert(partyRole)
      .values(data.roles.map((role) => ({ partyId: id, role })))
      .onConflictDoNothing();

    await tx.insert(auditEntry).values({
      actorId,
      entity: "party",
      entityId: id,
      action: "update",
      before: { legalName: before.legalName, nif: before.nif },
      after: { legalName: data.legalName, nif: blank(data.nif) },
      sourceScreen: "22",
    });
  });
}

/** Screen 82 — one company, many spellings. Adding one is a one-line action. */
export async function addAlias(partyId: string, alias: string, actorId: string) {
  const clean = alias.trim();
  if (clean.length < 2) return;
  await db
    .insert(partyAlias)
    .values({ partyId, alias: clean, source: "typed" })
    .onConflictDoNothing();
  await db.insert(auditEntry).values({
    actorId,
    entity: "party",
    entityId: partyId,
    action: "alias.add",
    after: { alias: clean },
    sourceScreen: "22",
  });
}

/** A company, with everything screen 22 shows that actually exists yet. */
export async function getParty(id: string) {
  const [row] = await db.select().from(party).where(eq(party.id, id)).limit(1);
  if (!row) return null;

  const roles = (
    await db.select({ role: partyRole.role }).from(partyRole).where(eq(partyRole.partyId, id))
  ).map((r) => r.role);

  const aliases = (
    await db.select({ alias: partyAlias.alias }).from(partyAlias).where(eq(partyAlias.partyId, id))
  ).map((r) => r.alias);

  // A merged company must still resolve — old links land on the survivor.
  let survivor: { id: string; code: string; legalName: string } | null = null;
  if (row.supersededBy) {
    const [s] = await db
      .select({ id: party.id, code: party.code, legalName: party.legalName })
      .from(party)
      .where(eq(party.id, row.supersededBy))
      .limit(1);
    survivor = s ?? null;
  }

  return { ...row, roles, aliases, survivor };
}

export async function listContacts(partyId: string) {
  const { person } = await import("@/db/schema/party");
  return db
    .select({
      id: person.id,
      fullName: person.fullName,
      trade: person.trade,
      email: person.email,
      phone: person.phone,
    })
    .from(person)
    .where(and(eq(person.employerPartyId, partyId), isNull(person.deletedAt)));
}

/**
 * ONE QUERY FOR EVERY LIST OF COMPANIES, AND FOR EVERY COUNT OF THEM.
 *
 * T9. Companies said two. "New deal" offered five in its client selector. Both
 * numbers were honest reports of what their own query asked, and the queries
 * did not agree: screen 21 asks `liveParty`, which is three clauses — not
 * binned, not archived, not merged away — and `deals/new` asked one of them,
 * `deleted_at is null`. So the archived company and the two merged into
 * survivors were offered as clients on a screen that creates real work, while
 * the directory correctly refused to list them.
 *
 * `liveParty` was already the shared contract and was already documented as
 * "the cost paid once instead of everywhere". It only works if everybody uses
 * it, and a constant cannot make anybody. A shared FUNCTION can: a screen that
 * calls this cannot half-remember the predicate, and a count taken with
 * `liveCompanyCount` cannot disagree with a list taken with `liveCompanies`
 * because there is one `where` between them.
 *
 * The rule this serves is the owner's, and it is general: *every count must
 * reconcile with the list it leads to.*
 */
export type CompanyOption = {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  wilaya: string | null;
  nif: string | null;
  docLocale: string;
  currency: string;
};

const COMPANY_COLUMNS = {
  id: party.id,
  code: party.code,
  legalName: party.legalName,
  tradeName: party.tradeName,
  wilaya: party.wilaya,
  nif: party.nif,
  docLocale: party.docLocale,
  currency: party.currency,
};

export async function liveCompanies(
  opts: { role?: PartyRole; limit?: number } = {},
): Promise<CompanyOption[]> {
  const limit = opts.limit ?? 500;

  // `selectDistinct` because the role join can only ever widen the row set, and
  // a company listed twice in a selector is the same bug wearing a different
  // hat: the list and its count stop agreeing.
  if (opts.role) {
    return db
      .selectDistinct(COMPANY_COLUMNS)
      .from(party)
      .innerJoin(partyRole, eq(partyRole.partyId, party.id))
      .where(and(eq(partyRole.role, opts.role), liveParty))
      .orderBy(asc(party.legalName))
      .limit(limit);
  }

  return db
    .select(COMPANY_COLUMNS)
    .from(party)
    .where(liveParty)
    .orderBy(asc(party.legalName))
    .limit(limit);
}

/**
 * How many there are, under exactly the same rule.
 *
 * Not `liveCompanies().length`: the list is capped, and a screen that says
 * "showing 100 of 100" when there are 150 is the same lie in miniature. The
 * cap belongs to the page, the total does not.
 */
export async function liveCompanyCount(opts: { role?: PartyRole } = {}): Promise<number> {
  if (opts.role) {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${party.id})::int` })
      .from(party)
      .innerJoin(partyRole, eq(partyRole.partyId, party.id))
      .where(and(eq(partyRole.role, opts.role), liveParty));
    return row?.n ?? 0;
  }

  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(party).where(liveParty);
  return row?.n ?? 0;
}
