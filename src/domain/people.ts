import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import { party, person, personCertification } from "@/db/schema/party";
import { CONTACT_RELATIONSHIP } from "./contact";

/**
 * Screen 51 — People.
 *
 * "The candidate bank is one source of people, not the definition of one. A
 * person exists in their own right; a CV, a certification and an ID copy are
 * documents attached to them."
 *
 * That sentence is the whole design. `source` records how somebody arrived and
 * is never a gate: a name and a trade is enough, and a day labourer who will
 * never send a CV is as real here as an engineer who did.
 */

/** How somebody arrived. All four are equal — the screen says so twice. */
export const PERSON_SOURCES = ["cv", "direct", "subcontractor", "import"] as const;
export type PersonSource = (typeof PERSON_SOURCES)[number];

export const PEOPLE_FACETS = ["all", ...PERSON_SOURCES] as const;
export type PeopleFacet = (typeof PEOPLE_FACETS)[number];

export function isPeopleFacet(value: string | undefined): value is PeopleFacet {
  return PEOPLE_FACETS.includes(value as PeopleFacet);
}

export const PERSON_RELATIONSHIPS = [
  "candidate",
  "employee",
  "temporary",
  "daily",
  "subcontractor",
] as const;
export type PersonRelationship = (typeof PERSON_RELATIONSHIPS)[number];

export type PersonRow = {
  id: string;
  fullName: string;
  trade: string;
  source: string;
  relationship: string;
  /** null = SUPSERV. A name here means the person works for somebody else. */
  employerName: string | null;
  wilaya: string | null;
  /** The certification that expires first — the one worth putting on a row. */
  certification: { kind: string; expiresOn: string | null } | null;
};

/**
 * Everybody except contacts. Screen 76 owns `external`; this screen owns the
 * rest, including a subcontractor's welder who has an employer of his own.
 */
const livePerson = and(
  ne(person.relationship, CONTACT_RELATIONSHIP),
  isNull(person.deletedAt),
  isNull(person.supersededBy),
);

export async function listPeople(facet: PeopleFacet = "all", limit = 200): Promise<PersonRow[]> {
  const where = facet === "all" ? livePerson : and(livePerson, eq(person.source, facet));

  const rows = await db
    .select({
      id: person.id,
      fullName: person.fullName,
      trade: person.trade,
      source: person.source,
      relationship: person.relationship,
      wilaya: person.wilaya,
      employerName: party.legalName,
    })
    .from(person)
    .leftJoin(party, eq(person.employerPartyId, party.id))
    .where(where)
    .orderBy(asc(person.fullName))
    .limit(limit);

  if (rows.length === 0) return [];

  // The soonest expiry per person, in one pass. A certification with no expiry
  // date sorts last: it is real, but it is not the one that needs watching.
  const certs = await db
    .select({
      personId: personCertification.personId,
      kind: personCertification.kind,
      expiresOn: personCertification.expiresOn,
    })
    .from(personCertification)
    .orderBy(asc(personCertification.expiresOn), desc(personCertification.kind));

  const soonest = new Map<string, { kind: string; expiresOn: string | null }>();
  for (const c of certs) {
    if (!soonest.has(c.personId)) soonest.set(c.personId, { kind: c.kind, expiresOn: c.expiresOn });
  }

  return rows.map((r) => ({ ...r, certification: soonest.get(r.id) ?? null }));
}

export type PeopleCounts = Record<PeopleFacet, number>;

/** The chips, and the "Where people come from" card. Same numbers, one query. */
export async function peopleCounts(): Promise<PeopleCounts> {
  const rows = await db.execute<Record<string, number>>(sql`
    select
      count(*)::int as all,
      count(*) filter (where source = 'cv')::int as cv,
      count(*) filter (where source = 'direct')::int as direct,
      count(*) filter (where source = 'subcontractor')::int as subcontractor,
      count(*) filter (where source = 'import')::int as import
    from person
    where relationship <> ${CONTACT_RELATIONSHIP}
      and deleted_at is null and superseded_by is null
  `);

  const r = rows[0] ?? {};
  return {
    all: r.all ?? 0,
    cv: r.cv ?? 0,
    direct: r.direct ?? 0,
    subcontractor: r.subcontractor ?? 0,
    import: r.import ?? 0,
  };
}

/**
 * "only two fields are required" — and that is not a shortcut, it is the point.
 * A driver hired for a week has a name and a trade. Demanding an ID number or a
 * wilaya is how he ends up written on the back of a delivery note instead.
 */
export const personInput = z.object({
  fullName: z.string().trim().min(2, "nameTooShort"),
  trade: z.string().trim().min(1, "tradeRequired"),
  phone: z.string().trim().optional().or(z.literal("")),
  nationalId: z.string().trim().optional().or(z.literal("")),
  wilaya: z.string().trim().optional().or(z.literal("")),
  relationship: z.enum(PERSON_RELATIONSHIPS).default("daily"),
  /** Blank means SUPSERV. A subcontractor's staff carry their employer. */
  employerPartyId: z.string().uuid().optional().or(z.literal("")),
  dailyRate: z.string().trim().optional().or(z.literal("")),
});

export type PersonInput = z.infer<typeof personInput>;

const blank = (v: string | undefined) => (v && v.length > 0 ? v : null);

export async function createPerson(input: PersonInput, actorId: string) {
  const data = personInput.parse(input);

  // `source` is not asked for on the form — it is observed. Somebody typing
  // into this box is, by definition, "typed in directly", unless they are
  // entering a subcontractor's staff, which the employer field already says.
  const employerPartyId = blank(data.employerPartyId);
  const source: PersonSource =
    data.relationship === "subcontractor" && employerPartyId ? "subcontractor" : "direct";

  const [created] = await db
    .insert(person)
    .values({
      fullName: data.fullName,
      trade: data.trade,
      phone: blank(data.phone),
      nationalId: blank(data.nationalId),
      wilaya: blank(data.wilaya),
      relationship: data.relationship,
      employerPartyId,
      dailyRate: blank(data.dailyRate),
      source,
    })
    .returning({ id: person.id });

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "person",
    entityId: created?.id ?? "",
    action: "create",
    after: { fullName: data.fullName, trade: data.trade, source },
    sourceScreen: "51",
  });

  return created?.id as string;
}

/* ── A man's tickets ─────────────────────────────────────────────────────── */

/**
 * Screen 25's certifications, which nothing in this ERP could write.
 *
 * `person_certification` has been read since screen 25 was built — the table on
 * the candidate, the soonest-expiring ticket on every row of screen 51, and the
 * crew panel on screen 16 that says whether a man may work tomorrow. There was
 * no insert anywhere in the application. Every one of those reads was against a
 * table only a test fixture had ever written to, which is to say: the company's
 * welders had habilitations and the ERP had nowhere to type them.
 */
export class CertificationRefused extends Error {
  constructor(readonly reason: "noSuchCertification" | "expiresBeforeIssued") {
    super(reason);
    this.name = "CertificationRefused";
  }
}

export const certificationInput = z.object({
  kind: z.string().trim().min(2, "kindRequired"),
  number: z.string().trim().optional().or(z.literal("")),
  issuedBy: z.string().trim().optional().or(z.literal("")),
  issuedOn: z.string().trim().optional().or(z.literal("")),
  /**
   * Blank is allowed and MEANS SOMETHING: a diploma does not expire. Screen 25
   * says "n'expire pas" for it rather than leaving the cell empty, because an
   * empty cell reads as a date nobody has typed yet.
   */
  expiresOn: z.string().trim().optional().or(z.literal("")),
});

export type CertificationInput = z.infer<typeof certificationInput>;

export async function saveCertification(
  personId: string,
  input: CertificationInput,
  actorId: string,
): Promise<string> {
  const data = certificationInput.parse(input);
  const issuedOn = blank(data.issuedOn);
  const expiresOn = blank(data.expiresOn);

  // A ticket that expired before it was issued is a typo, and one the screen
  // would otherwise render as a man permanently barred from site.
  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    throw new CertificationRefused("expiresBeforeIssued");
  }

  const [created] = await db
    .insert(personCertification)
    .values({
      personId,
      kind: data.kind,
      number: blank(data.number),
      issuedBy: blank(data.issuedBy),
      issuedOn,
      expiresOn,
      recordedBy: actorId,
    })
    .returning({ id: personCertification.id });

  await db.insert(auditEntry).values({
    actorId,
    actorKind: "user",
    entity: "person_certification",
    entityId: created?.id ?? "",
    action: "create",
    after: { personId, kind: data.kind, number: blank(data.number), expiresOn },
    sourceScreen: "25",
  });

  return created?.id as string;
}

/**
 * "I have seen the original." — or the withdrawal of it.
 *
 * Not a boolean somebody sets: the row keeps who said so and when, and the
 * screen computes "checked" from the date. Withdrawable, because a confirmation
 * given in error with no way back is how a wrong fact becomes permanent — and
 * both directions are in the audit trail.
 */
export async function setCertificationVerified(opts: {
  certificationId: string;
  verified: boolean;
  actorId: string;
  now?: Date;
}): Promise<void> {
  const [before] = await db
    .select({ id: personCertification.id, verifiedAt: personCertification.verifiedAt })
    .from(personCertification)
    .where(eq(personCertification.id, opts.certificationId))
    .limit(1);
  if (!before) throw new CertificationRefused("noSuchCertification");

  await db.transaction(async (tx) => {
    await tx
      .update(personCertification)
      .set(
        opts.verified
          ? { verifiedBy: opts.actorId, verifiedAt: opts.now ?? new Date() }
          : { verifiedBy: null, verifiedAt: null },
      )
      .where(eq(personCertification.id, opts.certificationId));

    await tx.insert(auditEntry).values({
      actorId: opts.actorId,
      actorKind: "user",
      entity: "person_certification",
      entityId: opts.certificationId,
      action: "update",
      before: { verifiedAt: before.verifiedAt?.toISOString() ?? null },
      after: { verified: opts.verified },
      sourceScreen: "25",
    });
  });
}
