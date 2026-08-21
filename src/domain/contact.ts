import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { party, partyRole, person } from "@/db/schema/party";
import { liveParty } from "./deletion";

/**
 * Screen 76 — Contacts.
 *
 * "A contact belongs to a company, but you deal with people. When a deadline is
 * in six hours you search a name, not a company."
 *
 * A contact is a person whose employer is somebody else. SUPSERV's own staff
 * have no employer here (`employer_party_id is null`) and belong to screen 51.
 * That one column is the whole difference between the two screens.
 */

export type ContactStatus = "active" | "unverified" | "bouncing";

/**
 * LAW 1 — computed, never stored.
 *
 * Bouncing wins over everything: an address that came back is the one fact that
 * matters, whatever we believed about it yesterday. Then unverified, which is
 * the honest default — nobody has confirmed this reaches them. Active is what is
 * left, and it means something precise: somebody checked.
 */
export function contactStatus(p: {
  verifiedAt: Date | null;
  bouncedAt: Date | null;
}): ContactStatus {
  if (p.bouncedAt) return "bouncing";
  if (!p.verifiedAt) return "unverified";
  return "active";
}

export const CONTACT_FACETS = [
  "all",
  "clients",
  "suppliers",
  "authorities",
  "unverified",
  "bouncing",
] as const;
export type ContactFacet = (typeof CONTACT_FACETS)[number];

export function isContactFacet(value: string | undefined): value is ContactFacet {
  return CONTACT_FACETS.includes(value as ContactFacet);
}

export type ContactRow = {
  id: string;
  fullName: string;
  job: string;
  companyId: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  prefers: string | null;
  lastContactAt: Date | null;
  status: ContactStatus;
};

/** A contact is live, and so is the company they belong to. */
const liveContact = and(isNull(person.deletedAt), isNull(person.supersededBy), liveParty);

const employerHasRole = (role: string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(partyRole)
      .where(and(eq(partyRole.partyId, party.id), eq(partyRole.role, role))),
  );

export async function listContactRows(facet: ContactFacet = "all", limit = 200) {
  const facetFilter =
    facet === "clients"
      ? employerHasRole("client")
      : facet === "suppliers"
        ? employerHasRole("supplier")
        : facet === "authorities"
          ? employerHasRole("authority")
          : facet === "unverified"
            ? and(isNull(person.verifiedAt), isNull(person.bouncedAt))
            : facet === "bouncing"
              ? sql`${person.bouncedAt} is not null`
              : undefined;

  const rows = await db
    .select({
      id: person.id,
      fullName: person.fullName,
      job: person.trade,
      email: person.email,
      phone: person.phone,
      prefers: person.prefers,
      verifiedAt: person.verifiedAt,
      bouncedAt: person.bouncedAt,
      lastContactAt: person.lastContactAt,
      companyId: party.id,
      companyName: party.legalName,
    })
    .from(person)
    .innerJoin(party, eq(person.employerPartyId, party.id))
    .where(facetFilter ? and(liveContact, facetFilter) : liveContact)
    .orderBy(asc(person.fullName))
    .limit(limit);

  return rows.map(
    ({ verifiedAt, bouncedAt, ...rest }): ContactRow => ({
      ...rest,
      status: contactStatus({ verifiedAt, bouncedAt }),
    }),
  );
}

export type ContactCounts = Record<ContactFacet, number>;

/**
 * The chips across the top. One pass over the table rather than six queries —
 * and every number on this screen comes from the same pass, so the chips can
 * never disagree with the rows underneath them.
 */
export async function contactCounts(): Promise<ContactCounts> {
  const rows = await db.execute<{
    all: number;
    clients: number;
    suppliers: number;
    authorities: number;
    unverified: number;
    bouncing: number;
  }>(sql`
    with live as (
      select p.id, p.verified_at, p.bounced_at, p.employer_party_id
      from person p
      join party c on c.id = p.employer_party_id
      where p.deleted_at is null and p.superseded_by is null
        and c.deleted_at is null and c.archived_at is null and c.superseded_by is null
    ),
    roles as (
      select party_id, array_agg(role) as roles from party_role group by party_id
    )
    select
      count(*)::int as all,
      count(*) filter (where 'client' = any(r.roles))::int as clients,
      count(*) filter (where 'supplier' = any(r.roles))::int as suppliers,
      count(*) filter (where 'authority' = any(r.roles))::int as authorities,
      count(*) filter (where l.verified_at is null and l.bounced_at is null)::int as unverified,
      count(*) filter (where l.bounced_at is not null)::int as bouncing
    from live l
    left join roles r on r.party_id = l.employer_party_id
  `);

  const r = rows[0];
  return {
    all: r?.all ?? 0,
    clients: r?.clients ?? 0,
    suppliers: r?.suppliers ?? 0,
    authorities: r?.authorities ?? 0,
    unverified: r?.unverified ?? 0,
    bouncing: r?.bouncing ?? 0,
  };
}

export type ContactQuality = {
  total: number;
  companies: number;
  withEmail: number;
  withPhone: number;
  neither: number;
  unverified: number;
  bouncing: number;
  neverContacted: number;
};

/**
 * The Quality panel. Not a score out of ten — six plain counts, each of which
 * names a specific thing somebody can go and fix this afternoon.
 */
export async function contactQuality(): Promise<ContactQuality> {
  const rows = await db.execute<ContactQuality>(sql`
    with live as (
      select p.*
      from person p
      join party c on c.id = p.employer_party_id
      where p.deleted_at is null and p.superseded_by is null
        and c.deleted_at is null and c.archived_at is null and c.superseded_by is null
    )
    select
      count(*)::int as total,
      count(distinct employer_party_id)::int as companies,
      count(*) filter (where nullif(btrim(email), '') is not null)::int as "withEmail",
      count(*) filter (where nullif(btrim(phone), '') is not null)::int as "withPhone",
      count(*) filter (where nullif(btrim(email), '') is null
                         and nullif(btrim(phone), '') is null)::int as neither,
      count(*) filter (where verified_at is null and bounced_at is null)::int as unverified,
      count(*) filter (where bounced_at is not null)::int as bouncing,
      count(*) filter (where last_contact_at is null)::int as "neverContacted"
    from live
  `);

  return (
    rows[0] ?? {
      total: 0,
      companies: 0,
      withEmail: 0,
      withPhone: 0,
      neither: 0,
      unverified: 0,
      bouncing: 0,
      neverContacted: 0,
    }
  );
}

/**
 * Screen 76's banner names the company, not the address: "Techno Fluides has
 * never replied to a request — not because they are slow, but because nothing
 * has ever reached them." The point of the sentence is the consequence, so the
 * banner needs the company and whether anyone ever got through.
 */
export async function bouncingContacts(limit = 5) {
  const rows = await db
    .select({
      id: person.id,
      fullName: person.fullName,
      companyName: party.legalName,
      lastContactAt: person.lastContactAt,
    })
    .from(person)
    .innerJoin(party, eq(person.employerPartyId, party.id))
    .where(and(liveContact, sql`${person.bouncedAt} is not null`))
    .orderBy(asc(party.legalName))
    .limit(limit);
  return rows;
}

/**
 * A contact needs a name, a job and an employer. Everything else is optional,
 * because half of them arrive as a name written on a delivery note and get
 * filled in later — a form that demands an email address is a form people work
 * around by inventing one.
 */
export const contactInput = z.object({
  fullName: z.string().trim().min(2, "nameTooShort"),
  job: z.string().trim().min(1, "jobRequired"),
  companyId: z.string().uuid("companyRequired"),
  email: z.string().trim().email("emailInvalid").optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  prefers: z.enum(["email", "phone", "whatsapp"]).optional().or(z.literal("")),
});

export type ContactInput = z.infer<typeof contactInput>;

const blank = (v: string | undefined) => (v && v.length > 0 ? v : null);

export async function createContact(input: ContactInput, actorId: string) {
  const data = contactInput.parse(input);

  const [created] = await db
    .insert(person)
    .values({
      fullName: data.fullName,
      trade: data.job,
      employerPartyId: data.companyId,
      email: blank(data.email),
      phone: blank(data.phone),
      prefers: blank(data.prefers),
      // Typed by hand, from outside, and nobody has checked the address yet —
      // which is exactly what "unverified" means on screen 76.
      source: "direct",
      relationship: "external",
    })
    .returning({ id: person.id });

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "person",
    entityId: created?.id ?? "",
    action: "create",
    after: { fullName: data.fullName, companyId: data.companyId },
    sourceScreen: "76",
  });

  return created?.id as string;
}

/** Somebody replied, so we know the address reaches them. */
export async function markContactVerified(id: string, actorId: string) {
  await db.update(person).set({ verifiedAt: new Date(), bouncedAt: null }).where(eq(person.id, id));
  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "person",
    entityId: id,
    action: "verify",
    sourceScreen: "76",
  });
}

/** Mail came back. Recorded as a fact and a time, not as a status. */
export async function markContactBounced(id: string, actorId: string) {
  await db.update(person).set({ bouncedAt: new Date() }).where(eq(person.id, id));
  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "person",
    entityId: id,
    action: "bounce",
    sourceScreen: "76",
  });
}
