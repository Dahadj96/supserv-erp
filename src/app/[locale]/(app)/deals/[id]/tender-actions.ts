"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { isProcedure } from "@/domain/tender/dossier";
import { makeTender, TenderRefused, unmakeTender } from "@/domain/tender/store";

/**
 * "Make this a tender", and the undo — screen 06's two presses about what a
 * deal IS.
 *
 * The owner's sentence, and the reason this file exists: "some clients send an
 * RFQ, but when it's a ZIP file with a lot of files it means it's a tender —
 * we need a way to turn an RFQ into a tender, because it needs that tender
 * pipeline." `makeTender` had been written, transactional and tested since the
 * module was built, and had no caller outside `tests/`. This is the caller.
 *
 * PERMISSION: `offers.issue`, the same as `decideAction` and `lostAction` next
 * door in `actions.ts`. Deciding that a deal is answering a formal procedure is
 * the same kind of act as deciding to pursue it or writing down that it was
 * lost: a judgement about what we are going to do about this client's request,
 * made by whoever answers clients. It is deliberately NOT `records.delete`,
 * even for the undo — nothing is being taken out of the world, the deal and
 * every document on it survive untouched, and gating the undo harder than the
 * press that caused it would leave a Commercial in Adrar waiting for the office
 * to correct a classification he made himself two minutes ago. It is
 * deliberately not `settings.company` either: this is not configuration, it is
 * one deal.
 */

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const orNull = (value: string) => (value ? value : null);

/** `84 200,00` and `84200.00` are both what somebody reads off a cahier des charges. */
const decimal = (form: FormData, key: string) =>
  str(form, key).replace(/[\s ]/g, "").replace(",", ".");

const LOOKS_NUMERIC = /^\d+(\.\d+)?$/;

function back(locale: string, id: string, error?: string): never {
  revalidatePath(`/${locale}/deals/${id}`);
  revalidatePath(`/${locale}/tenders`);
  redirect(error ? `/${locale}/deals/${id}?error=${error}` : `/${locale}/deals/${id}`);
}

async function tenderSession(locale: string, id: string) {
  const session = await getSession();
  if (!session) redirect(`/${locale}/sign-in`);
  if (!can(session.role, "offers.issue")) back(locale, id, "notAllowed");
  return session;
}

export async function makeTenderAction(locale: string, id: string, form: FormData): Promise<void> {
  const session = await tenderSession(locale, id);

  // The five values come from `PROCEDURES` in `dossier.ts` and are checked
  // against it, not against a list retyped here. A sixth arriving one day must
  // reach the seed and the label at the same time or not at all.
  const procedure = str(form, "procedure");
  if (!isProcedure(procedure)) back(locale, id, "unknownProcedure");

  const cautionAmount = decimal(form, "cautionAmount");
  const cautionPct = decimal(form, "cautionPct");
  // Refused here rather than let through to Postgres, which would answer with
  // an invalid-input-syntax stack trace on a screen where somebody typed
  // "environ 2%" into a box.
  if (cautionAmount && !LOOKS_NUMERIC.test(cautionAmount)) back(locale, id, "cautionNotANumber");
  if (cautionPct && !LOOKS_NUMERIC.test(cautionPct)) back(locale, id, "cautionNotANumber");

  const validity = str(form, "offerValidityDays");
  if (validity && !/^\d{1,4}$/.test(validity)) back(locale, id, "validityNotANumber");

  const opensAt = str(form, "opensAt");

  try {
    await makeTender({
      dealId: id,
      procedure,
      submissionPlace: orNull(str(form, "submissionPlace")),
      opensAt: opensAt ? new Date(opensAt) : null,
      cautionAmount: orNull(cautionAmount),
      cautionPct: orNull(cautionPct),
      offerValidityDays: validity ? Number(validity) : null,
      actorId: session.userId,
    });
  } catch (error) {
    if (error instanceof TenderRefused) back(locale, id, error.reason);
    throw error;
  }

  // Straight to the folder it just seeded. The point of the press is the
  // pipeline on the other side of it, and landing back on the deal would leave
  // a person hunting the rail for where their tender went.
  revalidatePath(`/${locale}/deals/${id}`);
  revalidatePath(`/${locale}/tenders`);
  redirect(`/${locale}/tenders/${id}`);
}

export async function unmakeTenderAction(
  locale: string,
  id: string,
  form: FormData,
): Promise<void> {
  const session = await tenderSession(locale, id);
  try {
    await unmakeTender({
      dealId: id,
      reason: orNull(str(form, "reason")),
      actorId: session.userId,
    });
  } catch (error) {
    // `alreadySubmitted`, `cautionRecorded`, `bpuImported`, `folderStarted` —
    // each is a sentence on screen 06, and each is also why the button was
    // already grey. It is checked twice on purpose: `disabledReason` sets
    // `aria-disabled`, so a greyed submit still submits.
    if (error instanceof TenderRefused) back(locale, id, error.reason);
    throw error;
  }
  back(locale, id);
}
