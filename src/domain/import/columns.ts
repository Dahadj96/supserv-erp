import { normaliseWording } from "../designation";

/**
 * Screen 62, step 2 — "check the columns · 11 of 14 mapped · the rest are
 * ignored".
 *
 * The mapping is PROPOSED here and confirmed by a person on the screen. That
 * order matters: a column called "Montant" could be a value, a price or a
 * balance, and guessing silently is how an import quietly puts the wrong number
 * in eighty-eight invoices.
 *
 * Every synonym below is a real column heading from a real Algerian
 * spreadsheet, in French, in English, or in the mixture people actually type.
 */

export type Target =
  | "legalName"
  | "tradeName"
  | "nif"
  | "nis"
  | "rc"
  | "ai"
  | "email"
  | "phone"
  | "address"
  | "wilaya"
  | "paymentTerms"
  | "docLocale"
  | "contactName"
  | "contactJob"
  | "contactEmail"
  | "contactPhone"
  | "fullName"
  | "trade"
  | "nationalId";

/** What a sheet can become. Only what has a table to land in. */
export const IMPORTABLE = ["party", "contact", "person"] as const;
export type Importable = (typeof IMPORTABLE)[number];

export const TARGETS_FOR: Record<Importable, Target[]> = {
  party: [
    "legalName",
    "tradeName",
    "nif",
    "nis",
    "rc",
    "ai",
    "email",
    "phone",
    "address",
    "wilaya",
    "paymentTerms",
    "docLocale",
    // A clients sheet almost always has the buyer's name in it too, so a party
    // import can bring a contact along in the same pass.
    "contactName",
    "contactJob",
    "contactEmail",
    "contactPhone",
  ],
  contact: ["contactName", "contactJob", "contactEmail", "contactPhone", "legalName"],
  person: ["fullName", "trade", "phone", "wilaya", "nationalId"],
};

const SYNONYMS: Record<Target, string[]> = {
  legalName: [
    "raison sociale",
    "client",
    "societe",
    "société",
    "nom societe",
    "nom de la societe",
    "company",
    "company name",
    "fournisseur",
    "denomination",
    "dénomination",
    "nom",
  ],
  tradeName: ["nom commercial", "enseigne", "trade name", "sigle", "abreviation", "abréviation"],
  nif: ["nif", "n if", "numero identification fiscale", "identifiant fiscal", "tax id"],
  nis: ["nis", "n is", "numero identification statistique"],
  rc: ["rc", "registre de commerce", "registre commerce", "n rc", "numero rc", "trade register"],
  ai: ["ai", "article imposition", "article d imposition", "art imposition"],
  email: ["email", "e mail", "mail", "courriel", "adresse email", "adresse mail"],
  phone: ["telephone", "téléphone", "tel", "phone", "mobile", "portable", "gsm", "fixe"],
  address: ["adresse", "address", "siege", "siège", "siege social", "localisation"],
  wilaya: ["wilaya", "ville", "city", "region", "région", "departement"],
  paymentTerms: [
    "conditions de paiement",
    "delai de paiement",
    "délai de paiement",
    "paiement",
    "payment terms",
    "modalite de paiement",
  ],
  docLocale: ["langue", "language", "langue documents", "langue des documents"],
  contactName: [
    "contact",
    "nom contact",
    "personne a contacter",
    "personne à contacter",
    "interlocuteur",
    "contact name",
    "acheteur",
    "commercial client",
  ],
  contactJob: ["fonction", "poste", "job", "titre", "qualite", "qualité", "service"],
  contactEmail: ["email contact", "mail contact", "email interlocuteur", "contact email"],
  contactPhone: ["tel contact", "telephone contact", "mobile contact", "contact phone"],
  fullName: ["nom et prenom", "nom et prénom", "nom prenom", "full name", "nom complet"],
  trade: ["metier", "métier", "specialite", "spécialité", "trade", "qualification", "poste"],
  nationalId: [
    "cin",
    "carte identite",
    "carte d identite",
    "national id",
    "nin",
    "numero identite",
  ],
};

/**
 * A header matches a target when its normalised form equals a synonym, or
 * contains one as a whole word.
 *
 * Substring matching alone is wrong here: "Nom" is inside "Nom commercial", and
 * a clients sheet with both columns would map them to the same field. Exact
 * first, then longest synonym, so the more specific heading wins.
 */
export function proposeTarget(header: string, allowed: Target[]): Target | null {
  const h = normaliseWording(header);
  if (!h) return null;

  let best: { target: Target; length: number } | null = null;

  for (const target of allowed) {
    for (const synonym of SYNONYMS[target]) {
      const s = normaliseWording(synonym);
      if (h === s) return target;
      // Whole-word containment, so "tel" does not match "telecom".
      const asWord = new RegExp(`(^| )${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
      if (asWord.test(h) && (!best || s.length > best.length)) {
        best = { target, length: s.length };
      }
    }
  }

  return best?.target ?? null;
}

export type Mapping = Record<string, Target | null>;

/**
 * Propose a mapping for a whole sheet.
 *
 * A target is used once. If two columns both look like the legal name, the
 * first wins and the second is left ignored for a person to sort out — silently
 * overwriting one with the other is the kind of thing nobody notices until an
 * invoice goes out with the wrong name on it.
 */
export function proposeMapping(headers: string[], becomes: Importable): Mapping {
  const allowed = TARGETS_FOR[becomes];
  const taken = new Set<Target>();
  const mapping: Mapping = {};

  for (const header of headers) {
    const target = proposeTarget(header, allowed);
    if (target && !taken.has(target)) {
      taken.add(target);
      mapping[header] = target;
    } else {
      mapping[header] = null;
    }
  }
  return mapping;
}

export function mappedCount(mapping: Mapping): { mapped: number; total: number } {
  const entries = Object.values(mapping);
  return { mapped: entries.filter(Boolean).length, total: entries.length };
}

/**
 * What a sheet most likely is, from its headers alone.
 *
 * Screen 62's "Becomes" column. A sheet with a trade and no company is a staff
 * list; one with a company name is clients or suppliers.
 */
export function guessImportable(headers: string[]): Importable {
  // Against ALL targets at once, never one at a time. "Nom et prénom" contains
  // "Nom", so asking "does this look like a legal name?" in isolation says yes
  // and turns a staff list into a list of companies. The competition between
  // targets is the whole point of proposeTarget.
  const all = [...new Set([...TARGETS_FOR.party, ...TARGETS_FOR.person])];
  const found = new Set(headers.map((h) => proposeTarget(h, all)).filter(Boolean));

  if (found.has("trade") && !found.has("legalName")) return "person";
  if (found.has("fullName") && !found.has("legalName")) return "person";
  if (found.has("legalName")) return "party";
  return "contact";
}
