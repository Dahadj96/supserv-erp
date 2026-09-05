import { ensureTypesExist } from "../src/domain/document-types";
import { ensureTemplatesExist } from "../src/documents/templates";

/**
 * Write the document catalogue down, in whichever database `.env` points at.
 *
 * Exactly what screen 50's "Seed types" button does, and idempotent: both
 * functions insert only what is missing and touch nothing that is there. Run
 * it after a document kind is added to `SEED_TYPES` — until the row exists,
 * `issuingRules` returns null for that kind and the engine falls back to
 * "we allocate the number", which on a kind numbered by the counterparty (a
 * client's order, an avenant) would print a reference of ours over theirs.
 *
 *   pnpm catalogue
 */
async function main() {
  const types = await ensureTypesExist();
  const templates = await ensureTemplatesExist();
  console.log(`types written: ${types}, templates written: ${templates}`);
  process.exit(0);
}

main();
