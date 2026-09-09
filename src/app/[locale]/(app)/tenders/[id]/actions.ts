"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { SECTIONS, type Section } from "@/domain/tender/dossier";
import { CREDENTIAL_KEYS } from "@/domain/tender/pieces";
import {
  addPiece,
  markSubmitted,
  recordCaution,
  removePiece,
  saveCredential,
  TenderRefused,
  tenderSubmittedAt,
} from "@/domain/tender/store";
import { storageFor } from "@/storage";

/**
 * Screen 08's presses.
 *
 * Everything here was written, transactional and tested when the tender module
 * was built, and had no caller outside `tests/`. `markSubmitted` refuses an
 * incomplete folder and takes a `force` with a reason; `recordCaution` holds
 * the two dates the bank decides; `addPiece` and `removePiece` make the folder
 * this cahier des charges' list rather than a template's. And `saveCredential`
 * is the one that mattered: a piece backed by a company paper is `missing`
 * until that paper has a scan on file, so without a way to file one the screen
 * reads all red the day it first has data, for a reason nobody can act on.
 *
 * PERMISSIONS, and they are not all the same question.
 *
 * The four that are about THIS tender — depositing it, recording its bond,
 * adding and removing the pieces its dossier asks for — are `offers.issue`,
 * the same as "Make this a tender" next door on screen 06. Assembling a folder
 * is the work of whoever answers clients, and a Commercial in Adrar who cannot
 * tick off the pieces of the tender he is depositing is a Commercial who keeps
 * the list on paper instead.
 *
 * Filing a company paper is `settings.company`, and deliberately narrower. The
 * CNAS attestation is not this tender's — it is the company's, held once, read
 * by every open folder at once, and a wrong expiry date typed here quietly
 * turns nine folders green. It is the same class of fact as the RC and the NIF
 * on screen 85, behind the same permission. The screen greys the form and names
 * the permission rather than hiding it, so somebody who may not file it can
 * still see that it is what the folder is waiting for.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const orNull = (value: string) => (value ? value : null);

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/tenders/${id}`);
  revalidatePath(`/${locale}/tenders`);
  revalidatePath(`/${locale}/deals/${id}`);
  redirect(`/${locale}/tenders/${id}${query}`);
}

async function folderSession(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) back(locale, id, "?error=notAllowed");
  return session;
}

/**
 * Working the folder, on a tender that has not been deposited.
 *
 * Checked here as well as on the screen, because `Button`'s `disabledReason`
 * sets `aria-disabled` and not `disabled` — a greyed submit still submits —
 * and because between drawing the button and pressing it somebody in the next
 * room can deposit the envelope.
 */
async function openFolderSession(locale: string, id: string) {
  // The two lines above, repeated rather than delegated to `folderSession`.
  // `scripts/lib/action-permissions.mjs` folds a helper's body into the action
  // that calls it, ONE layer deep and deliberately so — a chain it followed
  // any further would be a chain nobody reading the action can follow either.
  // An action whose only check sits two hops away reads to that script as an
  // action with no check at all, which is the right answer to give: this is
  // the file where somebody looks to see who may press the button.
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) back(locale, id, "?error=notAllowed");
  if (await tenderSubmittedAt(id)) back(locale, id, "?error=alreadySubmitted");
  return session;
}

async function companySession(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "settings.company")) back(locale, id, "?error=notAllowed");
  return session;
}

/**
 * A date input gives back "" when somebody empties it, and the form is
 * PREFILLED with what is already recorded — so an empty box means "take this
 * date off", not "leave it alone". `recordCaution` distinguishes the two by
 * `undefined` against `null`, and this is the side of that distinction a
 * prefilled form is on.
 */
function dateOrNull(form: FormData, key: string): Date | null {
  const raw = str(form, key);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The company's papers. The one press that takes a folder piece off red. */
export async function saveCredentialAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await companySession(locale, id);

  const key = str(form, "key");
  // Checked against the list in `pieces.ts`, not against a list retyped here.
  // A tenth company paper reaches the seed, the label and this form together or
  // it reaches none of them.
  if (!(CREDENTIAL_KEYS as readonly string[]).includes(key)) {
    back(locale, id, "?error=unknownCredential");
  }

  const issuedOn = str(form, "issuedOn");
  const expiresOn = str(form, "expiresOn");
  // Postgres would answer a mistyped date with an invalid-input-syntax stack
  // trace on the screen where somebody is assembling a folder at eight in the
  // morning. The browser's own date input gives ISO or nothing; a phone with a
  // locale keyboard does not always.
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (issuedOn && !ISO_DAY.test(issuedOn)) back(locale, id, "?error=notADate");
  if (expiresOn && !ISO_DAY.test(expiresOn)) back(locale, id, "?error=notADate");
  if (issuedOn && expiresOn && expiresOn < issuedOn) back(locale, id, "?error=expiryBeforeIssue");

  /**
   * Three states, not two: a new scan replaces, an empty file input keeps what
   * is filed, and the checkbox takes it off. Omitting the third would leave no
   * way to correct a paper filed against the wrong key; conflating the second
   * with the third — passing `null` whenever no file was chosen — would take
   * every folder this credential backs from ready to missing because somebody
   * fixed a typo in a reference number.
   */
  const upload = form.get("file");
  const removing = form.get("removeFile") === "on";
  let file: { fileId: string | null; fileName: string | null; fileType: string | null } | null =
    null;

  if (upload instanceof File && upload.size > 0) {
    const safe = upload.name.replace(/[^\w.-]+/g, "_");
    const path = `company/credential/${key}-${Date.now()}-${safe}`;
    await storageFor("working").put({
      path,
      body: Buffer.from(await upload.arrayBuffer()),
      mime: upload.type || "application/octet-stream",
    });
    file = { fileId: path, fileName: upload.name, fileType: upload.type || null };
  } else if (removing) {
    file = { fileId: null, fileName: null, fileType: null };
  }

  await saveCredential({
    key,
    reference: orNull(str(form, "reference")),
    issuedOn: orNull(issuedOn),
    expiresOn: orNull(expiresOn),
    note: orNull(str(form, "note")),
    // Spread rather than three `?? undefined`s: `saveCredential` reads
    // "was `fileId` passed at all", so the keys must be absent, not undefined.
    ...(file ?? {}),
    actorId: session.userId,
  });

  back(locale, id, "?saved=credential");
}

/** The two dates the bank decides, and nobody can infer. */
export async function recordCautionAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await folderSession(locale, id);

  const requestedAt = dateOrNull(form, "requestedAt");
  const receivedAt = dateOrNull(form, "receivedAt");
  // Received before requested is somebody typing in the wrong box. Refused
  // rather than stored, because the pair is read as a lead time later.
  if (requestedAt && receivedAt && receivedAt.getTime() < requestedAt.getTime()) {
    back(locale, id, "?error=receivedBeforeRequested");
  }

  await recordCaution({ dealId: id, requestedAt, receivedAt, actorId: session.userId });
  back(locale, id, "?saved=caution");
}

/** A piece this cahier des charges asks for and the seed did not. */
export async function addPieceAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await openFolderSession(locale, id);

  const section = str(form, "section");
  if (!(SECTIONS as readonly string[]).includes(section)) back(locale, id, "?error=unknownSection");

  const label = str(form, "label");
  if (!label) back(locale, id, "?error=labelRequired");

  const credentialKey = str(form, "credentialKey");
  if (credentialKey && !(CREDENTIAL_KEYS as readonly string[]).includes(credentialKey)) {
    back(locale, id, "?error=unknownCredential");
  }

  /**
   * The key is derived from what somebody typed rather than asked for.
   *
   * A seeded piece's key is stable because a message file names it; a piece
   * added here has a label and no translation, and the screen already prints
   * `label ?? t(piece.<key>)`. Asking for a key as well would be asking a
   * person to invent an identifier for a row they can already see, and the
   * two would drift the first time somebody corrected the label. Keys do not
   * have to be unique — `id` is the primary key — so a collision costs
   * nothing.
   */
  const key =
    label
      .toLowerCase()
      .normalize("NFD")
      // `\p{M}` rather than a literal U+0300–U+036F range: the range is
      // invisible in a diff, and biome refuses a character class that mixes a
      // character with a combining one. Decompose, drop the marks, and
      // "Attestation de bonne exécution" keys as `..._execution`.
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "piece";

  try {
    await addPiece({
      dealId: id,
      section: section as Section,
      key,
      label,
      credentialKey: orNull(credentialKey),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof TenderRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }

  back(locale, id, "?saved=piece");
}

/** What this tender does not ask for. The audit entry keeps what it was. */
export async function removePieceAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await openFolderSession(locale, id);

  const pieceId = str(form, "pieceId");
  if (!pieceId) back(locale, id, "?error=noSuchPiece");

  try {
    await removePiece({ dealId: id, pieceId, actorId: session.userId });
  } catch (error) {
    if (error instanceof TenderRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }

  back(locale, id, "?saved=removed");
}

/**
 * That the envelope was deposited.
 *
 * The refusal is the point of this one. `markSubmitted` says no while a piece
 * is missing, expired, or valid today and dead on the day of the deposit — and
 * `force` exists because depositing an incomplete folder deliberately, to be
 * seen to have bid, is a real thing a company does. It takes a reason and the
 * reason goes in the audit entry beside the list of what was blocking at the
 * moment it was pressed.
 */
export async function markSubmittedAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await folderSession(locale, id);

  try {
    await markSubmitted({
      dealId: id,
      depositReceiptRef: orNull(str(form, "depositReceiptRef")),
      force: form.get("force") === "on",
      reason: orNull(str(form, "reason")),
      actorId: session.userId,
    });
  } catch (error) {
    // `dossierIncomplete`, `reasonRequired`, `alreadySubmitted` — each is a
    // sentence on the screen, and each is also why the button was already
    // grey. Checked twice on purpose: `disabledReason` sets `aria-disabled`,
    // not `disabled`, so a greyed submit still submits.
    if (error instanceof TenderRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }

  back(locale, id, "?saved=submitted");
}
