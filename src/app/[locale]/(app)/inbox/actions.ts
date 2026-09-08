"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { MailboxNotScoped } from "@/capture/mail/graph";
import {
  attachSenderCompany,
  commitCandidate,
  commitContact,
  commitEnquiry,
} from "@/domain/intake/commit";
import { dismiss, markRead, reclassify } from "@/domain/intake/inbox";
import { pollMailbox } from "@/domain/intake/mailbox";
import { ROUTED_TO, type RoutedTo } from "@/domain/intake/routing";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 02. Triage needs no permission beyond seeing the inbox at all —
 * anybody who can read a message can say what it is. What it BECOMES is gated
 * by the permission on that record type, checked where the record is created.
 *
 * But seeing the inbox is itself a permission now, and it is checked HERE and
 * not only on the page. A server action is a public HTTP endpoint: gating the
 * page without gating the action means the buttons are hidden and the endpoint
 * they posted to still answers.
 */
async function requireInbox(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "inbox.view")) {
    redirect({ href: "/today?denied=inbox", locale });
    throw new Error("unreachable");
  }
  return session;
}

/** "Sync now". The only button on the screen that reaches outside the building. */
export async function syncMailbox(locale: string) {
  await requireInbox(locale);
  try {
    const result = await pollMailbox("mailbox-poll");
    revalidatePath(`/${locale}/inbox`);
    redirect({ href: `/inbox?synced=${result.stored}`, locale });
  } catch (error) {
    if (error instanceof MailboxNotScoped) {
      // Never the detail in a URL — it names the mailbox. The banner on the
      // channels screen carries the full explanation.
      redirect({ href: "/inbox?error=mailboxNotScoped", locale });
      return;
    }
    throw error;
  }
}

export async function dismissMessage(locale: string, id: string, formData: FormData) {
  const session = await requireInbox(locale);
  await dismiss(id, session.userId, String(formData.get("reason") ?? "") || undefined);
  revalidatePath(`/${locale}/inbox`);
}

export async function openMessage(locale: string, id: string) {
  await requireInbox(locale);
  await markRead(id);
  revalidatePath(`/${locale}/inbox`);
}

export async function setClassification(locale: string, id: string, formData: FormData) {
  const session = await requireInbox(locale);
  const to = String(formData.get("to") ?? "");
  if (!ROUTED_TO.includes(to as RoutedTo)) throw new Error("unknownClassification");
  await reclassify(id, to as RoutedTo, session.userId);
  revalidatePath(`/${locale}/inbox`);
}

export async function createCandidateFrom(locale: string, id: string, formData: FormData) {
  const session = await requireInbox(locale);
  const trade = String(formData.get("trade") ?? "").trim();
  if (!trade) {
    // Screen 51 makes trade required because it is what people search by. A
    // trade guessed from a subject line is worse than one somebody types.
    redirect({ href: `/inbox?error=tradeRequired&message=${id}`, locale });
    return;
  }
  const personId = await commitCandidate({ messageId: id, actorId: session.userId, trade });
  revalidatePath(`/${locale}/inbox`);
  redirect({ href: `/people?created=${personId}`, locale });
}

/**
 * An enquiry or a tender invitation becomes a deal.
 *
 * The one failure worth handling by name is `companyRequired`: the sender was
 * never matched to a party, and a deal has no meaning without a client. The
 * screen answers that one step earlier — link the sender as a contact under a
 * company first — so the message says that rather than "something went wrong".
 */
export async function createEnquiryFrom(
  locale: string,
  id: string,
  kind: "enquiry" | "tender",
  formData: FormData,
) {
  const session = await requireInbox(locale);
  let dealId: string;
  try {
    dealId = await commitEnquiry({
      messageId: id,
      actorId: session.userId,
      kind,
      subject: String(formData.get("subject") ?? "").trim() || undefined,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "companyRequired" || reason === "subjectRequired") {
      redirect({ href: `/inbox/${id}?error=${reason}`, locale });
      return;
    }
    throw error;
  }
  revalidatePath(`/${locale}/inbox`);
  redirect({ href: `/deals/${dealId}`, locale });
}

/**
 * The same button, for a sender attached to no company yet.
 *
 * One press does both halves — name the company, then open the enquiry —
 * because they are one decision. Splitting them is what the screen used to do
 * by saying "link them to a company first", and the step it sent people to did
 * not exist.
 *
 * `partyId` when the person picked one of the look-alikes the screen offered;
 * `legalName` when they typed a name instead. Never both, and the screen only
 * ever sends one.
 */
export async function startEnquiryWithCompany(
  locale: string,
  id: string,
  kind: "enquiry" | "tender",
  formData: FormData,
) {
  const session = await requireInbox(locale);
  let dealId: string;
  try {
    const partyId = await attachSenderCompany({
      messageId: id,
      actorId: session.userId,
      partyId: String(formData.get("partyId") ?? "").trim() || undefined,
      legalName: String(formData.get("legalName") ?? "").trim() || undefined,
    });

    dealId = await commitEnquiry({
      messageId: id,
      actorId: session.userId,
      kind,
      partyId,
      subject: String(formData.get("subject") ?? "").trim() || undefined,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    // Every one of these has a sentence on the screen. Anything else is a bug
    // and is allowed to throw, because a 500 that gets fixed beats a form that
    // quietly does nothing.
    if (
      reason === "companyNameRequired" ||
      reason === "legalNameTooShort" ||
      reason === "subjectRequired" ||
      reason === "noSuchCompany"
    ) {
      redirect({ href: `/inbox/${id}?error=${reason}`, locale });
      return;
    }
    throw error;
  }
  revalidatePath(`/${locale}/inbox`);
  redirect({ href: `/deals/${dealId}`, locale });
}

export async function createContactFrom(locale: string, id: string, formData: FormData) {
  const session = await requireInbox(locale);
  await commitContact({
    messageId: id,
    actorId: session.userId,
    job: String(formData.get("job") ?? ""),
    partyId: String(formData.get("partyId") ?? "") || undefined,
  });
  revalidatePath(`/${locale}/inbox`);
  redirect({ href: "/contacts", locale });
}
