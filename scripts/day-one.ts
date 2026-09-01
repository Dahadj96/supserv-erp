import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { user } from "../src/db/schema/auth";
import { addSeries, addVatRate, listSeries, saveIdentity, setLogo } from "../src/domain/company";
import { setupState } from "../src/domain/setup";
import { storageFor } from "../src/storage";

/**
 * Day one, from the company's own papers.
 *
 * Every value below was read from a document SUPSERV itself issued or holds:
 * the company profile of June 2026, the proforma templates of 2025 and August
 * 2026, a bon de livraison of July 2026, and the brand folder. The sources are
 * named beside each value so a wrong one can be traced to the paper it came
 * from, not to a guess.
 *
 * Written through the domain functions, never with SQL, so each step carries
 * the same audit entry it would if the Gérant had typed it on screen 85.
 *
 *   pnpm exec tsx --env-file=.env scripts/day-one.ts
 */

const GERANT_EMAIL = "abderrahmane.dahadj@supserv.dz";

const LOGO =
  "C:\\Users\\Abderrahmane\\OneDrive - supserv\\SUPSERV\\11 - Marketing and Website\\Legacy Brand Assets\\BRAND\\design\\Logo\\logo supserv loong.png";

async function main() {
  const [actor] = await db.select({ id: user.id }).from(user).where(eq(user.email, GERANT_EMAIL));
  if (!actor) throw new Error(`no user ${GERANT_EMAIL} — sign in once first`);
  const actorId = actor.id;

  // ── 1. Identity — décret 05-468 ────────────────────────────────────────
  await saveIdentity(
    {
      // Profil d'Entreprise, June 2026: "Raison Sociale : SARL SUP SERV".
      legalName: "SARL SUP SERV",
      tradeName: "SUPSERV",
      legalForm: "SARL",
      // FACTURE PROFORMA SUPSERV 2025.xlsx: "Capital : 6 000 000,00 DA".
      capital: "6 000 000,00 DA",
      // Profile + every proforma since 2023.
      rc: "01/00-0883062 B19",
      nif: "001901088306288",
      // BON DE LIVRAISON UCC.docx, 15/07/2026: "NIS: 0 019 0101 00002 82".
      nis: "001901010000282",
      // Proforma 2025 and 2023: "N° ART: 01011120488".
      ai: "01011120488",
      // Profile: "N°19, Cité 67 Logements, Adrar, 01000".
      address: "N°19, Cité 67 Logements, 01000 Adrar",
      wilaya: "Adrar",
      // Profile: 0663000065 (direction); template 2026: 0556 44 11 08.
      phone: "0663 00 00 65 / 0556 44 11 08",
      email: "contact@supserv.dz",
      website: "www.supserv.dz",
    },
    actorId,
  );
  console.log("identity   written");

  // ── 2. Logo — the long colour mark from the brand folder ───────────────
  const body = readFileSync(LOGO);
  const stored = await storageFor("working").put({
    path: `company/logo-${Date.now()}-logo-supserv.png`,
    body,
    mime: "image/png",
  });
  // The id is the path relative to the storage root — what `/api/files/[id]`
  // serves and what the engine reads. `stored.path` is where it landed on disk.
  await setLogo(stored.id, actorId);
  console.log(`logo       ${body.length} bytes → ${stored.id}`);

  // ── 3. VAT — the three Algerian rates ──────────────────────────────────
  // Code des taxes sur le chiffre d'affaires, art. 21 (19 %) and art. 23
  // (9 %). Exempt is a rate of nought carried for the franchise case: UCC buys
  // under an attestation d'achat en franchise de TVA (see the mail of 27 Aug).
  for (const [rate, kind] of [
    ["19", "normal"],
    ["9", "reduced"],
    ["0", "exempt"],
  ] as const) {
    await addVatRate(
      { rate, kind, startsOn: "2026-01-01", authority: "CTCA art. 21 et 23" },
      actorId,
    );
  }
  console.log("vat        19 % normal, 9 % reduced, 0 % exempt");

  // ── 4. Numbering — the shape the August 2026 template chose ────────────
  // SUPSERV_Proforma_Template_v2.xlsx numbers proformas PF-2026-0001. The same
  // shape for everything else, so a client sees one convention. A kind that
  // already has a series is left alone — a second series for invoices would
  // be two shapes in one year, which is what the screen warns against.
  const existing = new Set((await listSeries()).map((s) => s.kind));
  for (const [kind, pattern] of [
    ["quotation", "DEV-{YYYY}-{####}"],
    ["proforma", "PF-{YYYY}-{####}"],
    ["invoice", "FA-{YYYY}-{####}"],
    ["advance_invoice", "ACC-{YYYY}-{####}"],
    ["situation", "SIT-{YYYY}-{###}"],
    ["credit_note", "AV-{YYYY}-{####}"],
    ["delivery_note", "BL-{YYYY}-{####}"],
    ["statement", "REL-{YYYY}-{###}"],
    ["purchase_order", "PO-{YYYY}-{####}"],
    ["goods_receipt", "BR-{YYYY}-{####}"],
    ["comparison_sheet", "CS-{YYYY}-{####}"],
    ["work_order", "WO-{YYYY}-{####}"],
  ] as const) {
    if (existing.has(kind)) continue;
    await addSeries({ kind, pattern, reset: "yearly" }, actorId);
  }
  console.log("numbering  12 series, yearly reset");

  const state = await setupState();
  console.log(
    `\n${state.done}/${state.total} steps done · canIssue=${state.canIssue}` +
      (state.missing.length ? ` · missing: ${state.missing.join(", ")}` : ""),
  );
  for (const step of state.steps) console.log(`  ${step.done ? "✓" : "·"} ${step.key}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
