"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, canAny } from "@/auth/can";
import { getSession } from "@/auth/session";
import { saveFinalAccount } from "@/domain/project/final";
import {
  recordSituationApproved,
  recordSituationSubmitted,
  saveAmendment,
  saveSituation,
} from "@/domain/project/situations";
import {
  addCrew,
  ProjectRefused,
  recordReception,
  releaseCaution,
  saveCaution,
  setPhysicalProgress,
  updateCrew,
  updateProjectTerms,
} from "@/domain/project/store";

/**
 * Screen 16's writes — the facts a site produces, each posted by its own
 * small form. The situation itself is a document and goes to screen 18 as a
 * draft; everything else is a date or a figure a person read off a paper.
 *
 * `works.issue` is the site's permission. The two dates the client controls
 * on a situation may also be recorded by compta (`invoices.issue`), because
 * the approved paper often reaches the office before it reaches the site.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => str(form, key).replace(/[\s ]/g, "").replace(",", ".");
const orNull = (value: string) => (value ? value : null);
const today = () => new Date().toISOString().slice(0, 10);

function back(locale: string, id: string, query = ""): never {
  revalidatePath(`/${locale}/projects/${id}`);
  revalidatePath(`/${locale}/projects`);
  redirect(`/${locale}/projects/${id}${query}`);
}

/**
 * The site's permission, named here and nowhere else. It used to be a
 * parameter with a default, which meant `siteSession(locale, id)` at eight
 * call sites said nothing about what it was enforcing — and a permission you
 * cannot see at the call site is one nobody re-reads.
 */
async function siteSession(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "works.issue")) back(locale, id, "?error=notAllowed");
  return session;
}

/** `qty:<contractLineId>` fields → { lineId: qty }; blanks and zeros dropped. */
function quantities(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("qty:")) continue;
    const qty = String(value).trim().replace(/[\s ]/g, "").replace(",", ".");
    if (qty && Number(qty) > 0) out[key.slice(4)] = qty;
  }
  return out;
}

export async function saveSituationAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await siteSession(locale, id);
  let documentId: string;
  try {
    documentId = await saveSituation({
      projectId: id,
      quantities: quantities(form),
      periodFrom: orNull(str(form, "periodFrom")),
      periodTo: orNull(str(form, "periodTo")),
      workDone: orNull(str(form, "workDone")),
      advanceRecovered: num(form, "advanceRecovered") || "0",
      issuedOn: orNull(str(form, "issuedOn")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) {
      revalidatePath(`/${locale}/projects/${id}/situation`);
      redirect(`/${locale}/projects/${id}/situation?error=${error.reason}`);
    }
    throw error;
  }
  revalidatePath(`/${locale}/projects/${id}`);
  redirect(`/${locale}/documents/${documentId}?created=1`);
}

export async function situationSubmittedAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canAny(session.role, ["works.issue", "invoices.issue"])) {
    back(locale, id, "?error=notAllowed");
  }
  try {
    await recordSituationSubmitted({
      documentId: str(form, "documentId"),
      on: str(form, "on") || today(),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=submitted");
}

export async function situationApprovedAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!canAny(session.role, ["works.issue", "invoices.issue"])) {
    back(locale, id, "?error=notAllowed");
  }
  try {
    await recordSituationApproved({
      documentId: str(form, "documentId"),
      on: str(form, "on") || today(),
      by: orNull(str(form, "by")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=approved");
}

export async function physicalAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await siteSession(locale, id);
  const percent = Number(num(form, "percent"));
  try {
    await setPhysicalProgress({ projectId: id, percent, actorId: session.userId });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=physical");
}

export async function receptionAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await siteSession(locale, id);
  const which = str(form, "which");
  try {
    await recordReception({
      projectId: id,
      pvProvisoirePlanned: which === "planned" ? orNull(str(form, "on")) : undefined,
      pvProvisoireOn: which === "provisoire" ? orNull(str(form, "on")) : undefined,
      pvDefinitiveOn: which === "definitive" ? orNull(str(form, "on")) : undefined,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=reception");
}

export async function termsAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await siteSession(locale, id);
  const warranty = str(form, "warrantyMonths");
  try {
    await updateProjectTerms({
      projectId: id,
      contractRef: orNull(str(form, "contractRef")),
      wilaya: orNull(str(form, "wilaya")),
      amountExcl: orNull(num(form, "amountExcl")),
      startedOn: orNull(str(form, "startedOn")),
      contractualEnd: orNull(str(form, "contractualEnd")),
      retentionPct: num(form, "retentionPct") || "0",
      retentionBase: orNull(str(form, "retentionBase")),
      // The pénalités clause. Blank stays blank: a rate this system invented
      // would be a claim against the company with nothing behind it.
      penaltyPerMille: orNull(num(form, "penaltyPerMille")),
      penaltyCapPct: orNull(num(form, "penaltyCapPct")),
      penaltyBase: orNull(str(form, "penaltyBase")),
      warrantyMonths: warranty ? Number(warranty) : null,
      contractDocumentId: orNull(str(form, "contractDocumentId")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=terms");
}

export async function cautionAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await siteSession(locale, id);
  const kind = str(form, "kind");
  if (!kind) back(locale, id, "?error=kindRequired");
  await saveCaution({
    projectId: id,
    kind,
    pct: orNull(num(form, "pct")),
    amount: orNull(num(form, "amount")),
    bankName: orNull(str(form, "bankName")),
    reference: orNull(str(form, "reference")),
    issuedOn: orNull(str(form, "issuedOn")),
    expiresOn: orNull(str(form, "expiresOn")),
    actorId: session.userId,
  });
  back(locale, id, "?recorded=caution");
}

export async function releaseCautionAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await siteSession(locale, id);
  const cautionId = str(form, "cautionId");
  if (!cautionId) back(locale, id, "?error=noSuchCaution");
  await releaseCaution({ cautionId, on: str(form, "on") || today(), actorId: session.userId });
  back(locale, id, "?recorded=released");
}

export async function crewAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await siteSession(locale, id);
  const personId = str(form, "personId");
  if (!personId) back(locale, id, "?error=personRequired");
  try {
    await addCrew({
      projectId: id,
      personId,
      role: orNull(str(form, "role")),
      onSiteSince: orNull(str(form, "onSiteSince")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=crew");
}

export async function crewUpdateAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await siteSession(locale, id);
  const which = str(form, "which");
  try {
    await updateCrew({
      crewId: str(form, "crewId"),
      onSiteSince: which === "arrived" ? str(form, "on") || today() : undefined,
      leftOn: which === "left" ? str(form, "on") || today() : undefined,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  back(locale, id, "?recorded=crew");
}

/**
 * Draw the décompte final, from what the marché's own documents say.
 *
 * `invoices.issue`: it is money owed and money received, added up, and the
 * document catalogue gives the kind the same permission for the same reason.
 * The form carries one field — the date on the paper. Everything else would be
 * a figure somebody could type differently from the situations behind it.
 */
export async function saveFinalAccountAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "invoices.issue")) back(locale, id, "?error=notAllowed");

  let documentId: string;
  try {
    documentId = await saveFinalAccount({
      projectId: id,
      issuedOn: orNull(str(form, "issuedOn")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) back(locale, id, `?error=${error.reason}`);
    throw error;
  }
  revalidatePath(`/${locale}/projects/${id}`);
  redirect(`/${locale}/documents/${documentId}?created=1`);
}

/**
 * `newQty:<lineId>` / `newPrice:<lineId>` → what the avenant makes of each
 * line. A field left blank is not a change; "0" is — a quantity cancelled.
 */
function changes(form: FormData): Record<string, { qty?: string; unitPrice?: string }> {
  const out: Record<string, { qty?: string; unitPrice?: string }> = {};
  const clean = (value: FormDataEntryValue) =>
    String(value)
      .trim()
      .replace(/[\s  ]/g, "")
      .replace(",", ".");
  for (const [key, value] of form.entries()) {
    const which = key.startsWith("newQty:")
      ? "qty"
      : key.startsWith("newPrice:")
        ? "unitPrice"
        : null;
    if (!which) continue;
    const typed = clean(value);
    if (!typed) continue;
    const lineId = key.slice(key.indexOf(":") + 1);
    out[lineId] = { ...out[lineId], [which]: typed };
  }
  return out;
}

/** `add.designation.<n>` … → the prix nouveaux block, blank rows and all. */
function additions(form: FormData) {
  const rows = new Map<string, Record<string, string>>();
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("add.")) continue;
    const [, field, index] = key.split(".");
    if (!field || index === undefined) continue;
    const row = rows.get(index) ?? {};
    row[field] = String(value).trim();
    rows.set(index, row);
  }
  const clean = (value: string | undefined) =>
    (value ?? "").replace(/[\s  ]/g, "").replace(",", ".");
  return [...rows.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, row]) => ({
      reference: row.reference ?? null,
      designation: row.designation ?? null,
      unit: row.unit ?? null,
      qty: clean(row.qty),
      unitPrice: clean(row.unitPrice),
    }));
}

/**
 * Write the avenant, as a draft, from what the signed paper says.
 *
 * `offers.issue`, not `works.issue`: an avenant changes what the client
 * committed to, which is the same act as recording their order, and the
 * document catalogue gives the kind the same permission for the same reason.
 */
export async function saveAmendmentAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) back(locale, id, "?error=notAllowed");

  let documentId: string;
  try {
    documentId = await saveAmendment({
      projectId: id,
      changes: changes(form),
      additions: additions(form),
      theirNumber: orNull(str(form, "theirNumber")),
      signedOn: orNull(str(form, "signedOn")),
      newContractualEnd: orNull(str(form, "newContractualEnd")),
      reason: orNull(str(form, "reason")),
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof ProjectRefused) {
      revalidatePath(`/${locale}/projects/${id}/amendment`);
      redirect(`/${locale}/projects/${id}/amendment?error=${error.reason}`);
    }
    throw error;
  }
  revalidatePath(`/${locale}/projects/${id}`);
  redirect(`/${locale}/documents/${documentId}?created=1`);
}
