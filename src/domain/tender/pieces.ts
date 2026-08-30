import type { Section } from "./dossier";

/**
 * THE LIST A NEW TENDER STARTS FROM, and what it is not.
 *
 * It is not what Algerian law requires. PLAN §8 rule 5: "No legal claim in UI
 * copy. It goes in `blocking_rule` with an authority and a confirmer, or it is
 * not asserted." — and "a tender requires an attestation CNAS" is exactly such
 * a claim.
 *
 * It is also not reliably true. What is required is whatever THIS buyer wrote
 * in THIS cahier des charges, and SADEG and ANBT ask for different folders for
 * the same kind of work. A system that hard-coded one of them would be wrong on
 * the other and would be wrong silently.
 *
 * So this is a starting point, copied into `tender_piece` when a tender is
 * created and owned by that tender from then on. A person adds what the dossier
 * asks for and removes what it does not, and `added_by` records who said so.
 * The screen never says "required"; it says "asked for", and the rows are the
 * office's own reading of the document.
 *
 * The default is the folder SUPSERV has carried to every marché in Adrar. That
 * is a good starting point and it is not authority.
 */

export type Seed = {
  key: string;
  section: Section;
  /**
   * Which company paper satisfies it, when one does. Null means the piece is
   * written for this tender and cannot be held once.
   */
  credentialKey: string | null;
};

/** Company papers with one expiry each, held once and pointed at from here. */
export const CREDENTIAL_KEYS = [
  "rc_copy",
  "statuts",
  "cnas",
  "casnos",
  "extrait_role",
  "casier_judiciaire",
  "comptes_sociaux",
  "qualification",
  "references",
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

export const SEED_PIECES: Seed[] = [
  // ── dossier administratif ────────────────────────────────────────────────
  // The declarations are written per tender: they name this consultation, this
  // buyer and this amount, and are signed for it.
  { key: "declaration_souscrire", section: "administratif", credentialKey: null },
  { key: "declaration_probite", section: "administratif", credentialKey: null },
  { key: "rc_copy", section: "administratif", credentialKey: "rc_copy" },
  { key: "cnas", section: "administratif", credentialKey: "cnas" },
  { key: "casnos", section: "administratif", credentialKey: "casnos" },
  { key: "extrait_role", section: "administratif", credentialKey: "extrait_role" },
  { key: "casier_judiciaire", section: "administratif", credentialKey: "casier_judiciaire" },
  { key: "statuts", section: "administratif", credentialKey: "statuts" },
  { key: "comptes_sociaux", section: "administratif", credentialKey: "comptes_sociaux" },

  // ── dossier technique ────────────────────────────────────────────────────
  { key: "qualification", section: "technique", credentialKey: "qualification" },
  { key: "references", section: "technique", credentialKey: "references" },
  // Pulled from People and from the item catalogue, and rebuilt per tender
  // because a buyer asks for the means committed to THIS job.
  { key: "moyens_humains", section: "technique", credentialKey: null },
  { key: "moyens_materiels", section: "technique", credentialKey: null },
  { key: "planning", section: "technique", credentialKey: null },

  // ── dossier financier ────────────────────────────────────────────────────
  { key: "lettre_soumission", section: "financier", credentialKey: null },
  { key: "bpu", section: "financier", credentialKey: null },
  { key: "dqe", section: "financier", credentialKey: null },
  { key: "caution", section: "financier", credentialKey: null },
];

/**
 * What a consultation usually does NOT ask for.
 *
 * Same caveat, and it is the reason this is a subtraction rather than a second
 * list: a consultation is an ordinary buyer asking three companies for a price,
 * not a public procedure, and carrying a bid bond and a qualification
 * certificate into one puts four permanent red rows on a screen where nothing
 * is wrong. Anybody can add them back.
 */
export const NOT_IN_A_CONSULTATION = new Set(["caution", "qualification", "casier_judiciaire"]);

export function seedFor(procedure: string): Seed[] {
  if (procedure === "consultation" || procedure === "rfq") {
    return SEED_PIECES.filter((piece) => !NOT_IN_A_CONSULTATION.has(piece.key));
  }
  return SEED_PIECES;
}
