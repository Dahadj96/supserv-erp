import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { deal } from "@/db/schema/deal";
import { document } from "@/db/schema/document";
import { blockingRule } from "@/db/schema/interface";
import { person, personCertification } from "@/db/schema/party";
import { project, projectCaution, projectCrew } from "@/db/schema/project";
import { companyCredential, tender, tenderPiece } from "@/db/schema/tender";
import { EXPIRING_WITHIN_DAYS } from "@/domain/tender/dossier";

/**
 * Task U2 — everything that expires, in one place.
 *
 * WHY THIS EXISTS. Expiry is what decides whether SUPSERV can bid, and it was
 * scattered across four tables and visible on four unrelated screens: a CNAS
 * attestation on a tender's folder, a bank guarantee inside one site, a
 * welder's habilitation on one man's page, an offer's validity nowhere at all.
 * Nothing anywhere answered "what expires next, and what breaks when it does".
 *
 * COMPUTED, NEVER STORED (LAW 1). Every state here is `expires_on` against
 * `now`, and — for a tender piece — against that tender's own closing time. A
 * folder that was complete in July is not complete in September because the
 * CASNOS attestation expired in August, and no column anywhere claims
 * otherwise. `src/domain/tender/dossier.ts` makes exactly that argument for one
 * tender; this is the same argument for the whole company.
 *
 * WHAT IS DELIBERATELY NOT HERE is as important as what is, because a screen
 * called "everything that expires" that quietly omits something teaches people
 * it is complete. Four things carry a duration and no date, so there is nothing
 * to count down and this module refuses to invent one:
 *
 *   deal.required_validity_days      how long the CLIENT requires our offer to
 *                                    stand. A requirement in days, checked
 *                                    against a supplier's answer on screen 67.
 *   sourcing_response.validity_days  the same shape from the other side.
 *   tender.caution_*                 the bid bond records requested and
 *                                    received, and no expiry at all.
 *   proforma.validityPeriod          a blocking rule, and until an accountant
 *                                    confirms it the system holds no default —
 *                                    so a proforma with no `valid_days` typed
 *                                    has no expiry, and this will not guess one.
 *
 * `price_quote.valid_until` is real and is left out on a different ground: a
 * stale price expires a COSTING, not a commitment, and it already has a home on
 * the deal's price panel. Putting it here would bury nine papers under three
 * hundred prices.
 */

export const EXPIRY_KINDS = ["credential", "caution", "certification", "offer"] as const;
export type ExpiryKind = (typeof EXPIRY_KINDS)[number];

/**
 * Worst first, and the order is the design — the same decision `PIECE_STATES`
 * makes. `beforeDeposit` sits above `soon` because a paper that dies two days
 * before a deposit is not "expiring soon": it is already useless for that
 * tender, and nobody can renew a CNAS attestation in an afternoon.
 */
export const EXPIRY_STATES = ["expired", "beforeDeposit", "soon", "later"] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

/** One thing this expiry stops working, and where to look at it. */
export type Consequence = {
  href: string;
  label: string;
  /**
   * True when this is a tender whose envelope is deposited AFTER the paper
   * dies. The state the whole tender module exists for.
   */
  beforeDeposit: boolean;
};

export type ExpiringRow = {
  /** Stable across renders: `<kind>:<row id>`. */
  id: string;
  kind: ExpiryKind;
  /** A message key under `expiring.what.*` when there is one, else free text. */
  what: string;
  /** The reference, the person's name, the document number — whatever names it. */
  detail: string | null;
  /** yyyy-mm-dd. */
  expiresOn: string;
  /** Whole days from now. Negative when it has already gone. */
  daysLeft: number;
  state: ExpiryState;
  /** The screen that renews it. Null when nothing in the ERP owns that act. */
  renewHref: string | null;
  /** What stops working. Empty means nothing open depends on it today. */
  breaks: Consequence[];
};

export type ExpiryReport = {
  /** Soonest first, as the task asks: ordered by date. */
  rows: ExpiringRow[];
  expired: number;
  beforeDeposit: number;
  /** Within the warning window and not yet gone. */
  soon: number;
  total: number;
  /**
   * Whether an accountant has confirmed `proforma.validityPeriod`. Read live,
   * so the sentence about what cannot be known stops being printed the day it
   * stops being true.
   */
  proformaValidityConfirmed: boolean;
};

const DAY = 86_400_000;

/** Calendar days, not elapsed hours — the same arithmetic `dossier.ts` uses. */
export function daysUntil(expiresOn: string, now: Date): number {
  const to = new Date(`${expiresOn}T00:00:00Z`);
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((to.getTime() - a) / DAY);
}

/**
 * Pure, and the whole verdict. Kept apart from every query so the one case that
 * matters — valid today, dead on the morning of the deposit — can be proved
 * against a date in September without a database.
 */
export function expiryState(daysLeft: number, breaks: Consequence[]): ExpiryState {
  if (daysLeft < 0) return "expired";
  if (breaks.some((b) => b.beforeDeposit)) return "beforeDeposit";
  if (daysLeft <= EXPIRING_WITHIN_DAYS) return "soon";
  return "later";
}

/** yyyy-mm-dd, `date` columns' own shape, from a date plus a number of days. */
export function addDays(from: string, days: number): string {
  const at = new Date(`${from}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function summarise(rows: ExpiringRow[], proformaValidityConfirmed: boolean): ExpiryReport {
  const ordered = [...rows].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  return {
    rows: ordered,
    expired: ordered.filter((r) => r.state === "expired").length,
    beforeDeposit: ordered.filter((r) => r.state === "beforeDeposit").length,
    soon: ordered.filter((r) => r.state === "soon").length,
    total: ordered.length,
    proformaValidityConfirmed,
  };
}

/**
 * A tender still worth breaking: not deposited, not lost, not binned.
 *
 * A deposited tender's folder is what was handed over — screen 08 already reads
 * it that way — so a paper expiring afterwards breaks nothing that can still be
 * fixed, and listing it would put a permanent red row on this screen.
 */
const OPEN_TENDER = and(isNull(tender.submittedAt), isNull(deal.lostAt), isNull(deal.deletedAt));

export async function expiringReport(now = new Date()): Promise<ExpiryReport> {
  const [credentials, cautions, certifications, offers, proformaRule] = await Promise.all([
    db.select().from(companyCredential).where(isNotNull(companyCredential.expiresOn)),

    db
      .select({
        id: projectCaution.id,
        kind: projectCaution.kind,
        reference: projectCaution.reference,
        bankName: projectCaution.bankName,
        expiresOn: projectCaution.expiresOn,
        projectId: project.id,
        code: project.code,
        object: project.object,
      })
      .from(projectCaution)
      .innerJoin(project, eq(project.id, projectCaution.projectId))
      .where(
        and(
          isNotNull(projectCaution.expiresOn),
          // Given back by the client: it guarantees nothing any more.
          isNull(projectCaution.releasedOn),
          isNull(project.deletedAt),
          /*
            A CLOSED site is not filtered out here, and that is the point of the
            row. A retention guarantee that nobody went back for outlives the
            work by a year — `docs/SCREENS.md` names it as one of the reasons
            screen 16 exists — and the bank keeps charging for it.
          */
        ),
      ),

    db
      .select({
        id: personCertification.id,
        kind: personCertification.kind,
        number: personCertification.number,
        expiresOn: personCertification.expiresOn,
        personId: person.id,
        fullName: person.fullName,
      })
      .from(personCertification)
      .innerJoin(person, eq(person.id, personCertification.personId))
      .where(and(isNotNull(personCertification.expiresOn), isNull(person.deletedAt))),

    /*
      An offer's own validity: the days it was issued with, counted from the day
      it was issued. Both columns are on the document and neither is inferred.
      Lost and binned deals are left out — an offer on a deal the client already
      awarded elsewhere expires nothing anybody can act on.
    */
    db
      .select({
        id: document.id,
        number: document.number,
        kind: document.kind,
        issuedOn: document.issuedOn,
        validDays: document.validDays,
        dealId: deal.id,
        ref: deal.ref,
        subject: deal.subject,
      })
      .from(document)
      .innerJoin(deal, eq(deal.id, document.dealId))
      .where(
        and(
          inArray(document.kind, ["quotation", "proforma"]),
          eq(document.status, "issued"),
          isNotNull(document.issuedOn),
          isNotNull(document.validDays),
          isNull(document.deletedAt),
          isNull(deal.lostAt),
          isNull(deal.deletedAt),
        ),
      ),

    db
      .select({ confirmedOn: blockingRule.confirmedOn })
      .from(blockingRule)
      .where(eq(blockingRule.code, "proforma.validityPeriod"))
      .limit(1),
  ]);

  /*
    Which open tenders ask for which company paper. One query for all of them,
    the same reason `foldersFor` batches: a screen that ran a query per
    credential would run nine on a quiet morning and ninety on a busy one.
  */
  const keys = credentials.map((c) => c.key);
  const asking = keys.length
    ? await db
        .select({
          credentialKey: tenderPiece.credentialKey,
          dealId: deal.id,
          ref: deal.ref,
          subject: deal.subject,
          closesAt: deal.deadlineAt,
        })
        .from(tenderPiece)
        .innerJoin(tender, eq(tender.dealId, tenderPiece.dealId))
        .innerJoin(deal, eq(deal.id, tenderPiece.dealId))
        .where(and(inArray(tenderPiece.credentialKey, keys), OPEN_TENDER))
        .orderBy(asc(deal.deadlineAt))
    : [];

  /* Who is on a site today, so a ticket can name the sites it would empty. */
  const crews = certifications.length
    ? await db
        .select({
          personId: projectCrew.personId,
          projectId: project.id,
          code: project.code,
          object: project.object,
        })
        .from(projectCrew)
        .innerJoin(project, eq(project.id, projectCrew.projectId))
        .where(
          and(
            isNull(projectCrew.leftOn),
            isNotNull(projectCrew.onSiteSince),
            isNull(project.deletedAt),
            isNull(project.closedAt),
          ),
        )
    : [];

  const rows: ExpiringRow[] = [];

  for (const credential of credentials) {
    const expiresOn = credential.expiresOn as string;
    const expires = new Date(`${expiresOn}T00:00:00Z`);
    const mine = asking.filter((a) => a.credentialKey === credential.key);

    const breaks: Consequence[] = mine.map((a) => ({
      href: `/tenders/${a.dealId}`,
      label: `${a.ref} · ${a.subject}`,
      // THE ONE THAT MATTERS. Valid today, invalid on the day it is deposited.
      beforeDeposit: a.closesAt !== null && expires.getTime() < a.closesAt.getTime(),
    }));

    const daysLeft = daysUntil(expiresOn, now);
    rows.push({
      id: `credential:${credential.key}`,
      kind: "credential",
      what: credential.key,
      detail: credential.reference,
      expiresOn,
      daysLeft,
      state: expiryState(daysLeft, breaks),
      /*
        A company paper is filed from a tender's folder and from nowhere else —
        `saveCredentialAction` lives on screen 08 and has no other caller — so
        the renew link is the soonest-closing open tender that asks for it. When
        no open tender asks, there is no screen in this ERP that renews it, and
        the row says so rather than pointing somewhere that cannot help.
      */
      renewHref: mine[0] ? `/tenders/${mine[0].dealId}` : null,
      breaks,
    });
  }

  for (const caution of cautions) {
    const expiresOn = caution.expiresOn as string;
    const daysLeft = daysUntil(expiresOn, now);
    const breaks: Consequence[] = [
      {
        href: `/projects/${caution.projectId}`,
        label: `${caution.code} · ${caution.object}`,
        beforeDeposit: false,
      },
    ];
    rows.push({
      id: `caution:${caution.id}`,
      kind: "caution",
      what: caution.kind,
      detail: [caution.bankName, caution.reference].filter(Boolean).join(" · ") || null,
      expiresOn,
      daysLeft,
      state: expiryState(daysLeft, breaks),
      renewHref: `/projects/${caution.projectId}`,
      breaks,
    });
  }

  for (const cert of certifications) {
    const expiresOn = cert.expiresOn as string;
    const daysLeft = daysUntil(expiresOn, now);
    const breaks: Consequence[] = crews
      .filter((c) => c.personId === cert.personId)
      .map((c) => ({
        href: `/projects/${c.projectId}`,
        label: `${c.code} · ${c.object}`,
        beforeDeposit: false,
      }));
    rows.push({
      id: `certification:${cert.id}`,
      kind: "certification",
      what: cert.kind,
      detail: [cert.fullName, cert.number].filter(Boolean).join(" · ") || null,
      expiresOn,
      daysLeft,
      state: expiryState(daysLeft, breaks),
      renewHref: `/candidates/${cert.personId}`,
      breaks,
    });
  }

  for (const offer of offers) {
    const expiresOn = addDays(offer.issuedOn as string, offer.validDays as number);
    const daysLeft = daysUntil(expiresOn, now);
    const breaks: Consequence[] = [
      {
        href: `/deals/${offer.dealId}`,
        label: `${offer.ref} · ${offer.subject}`,
        beforeDeposit: false,
      },
    ];
    rows.push({
      id: `offer:${offer.id}`,
      kind: "offer",
      what: offer.kind,
      detail: offer.number,
      expiresOn,
      daysLeft,
      state: expiryState(daysLeft, breaks),
      // The document itself. Nothing renews an offer — a new one is built on
      // the deal — so this opens what was promised rather than pretending.
      renewHref: `/documents/${offer.id}`,
      breaks,
    });
  }

  return summarise(rows, Boolean(proformaRule[0]?.confirmedOn));
}

/**
 * The three numbers screen 27 puts above everything else, without pulling every
 * row across. It runs the same query — there is no cheaper honest version,
 * because "expires before a deposit" cannot be answered without the deposits —
 * and it exists so the caller reads one shape rather than counting rows itself.
 */
export type ExpirySummary = {
  expired: number;
  beforeDeposit: number;
  soon: number;
  total: number;
};

export async function expirySummary(now = new Date()): Promise<ExpirySummary> {
  const { expired, beforeDeposit, soon, total } = await expiringReport(now);
  return { expired, beforeDeposit, soon, total };
}
