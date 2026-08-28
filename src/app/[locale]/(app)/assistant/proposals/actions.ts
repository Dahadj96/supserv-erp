"use server";

import { revalidatePath } from "next/cache";
import { CannotDraft, draftRelanceFor } from "@/assistant/draft-relance";
import { ProposalRefused, propose } from "@/assistant/proposals";
import { getSession } from "@/auth/session";
import { ApplyRefused, decideProposal } from "@/domain/assistant/apply";
import { redirect } from "@/i18n/navigation";

const HERE = "/assistant/proposals";

async function requireSession(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  return session;
}

/**
 * Ask the assistant to draft a chase for one invoice.
 *
 * The drafting reads; the proposing writes a proposal and an audit entry. The
 * invoice is untouched either way — that only happens if somebody approves.
 */
export async function proposeRelanceAction(locale: string, form: FormData) {
  const session = await requireSession(locale);
  const documentId = String(form.get("documentId") ?? "");

  try {
    const drafted = await draftRelanceFor({
      documentId,
      me: { name: session.displayName, email: session.email },
    });

    await propose({
      tool: "draftRelance",
      role: session.role,
      requestedBy: session.userId,
      entity: "document",
      entityId: drafted.documentId,
      title: drafted.title,
      body: drafted.subject ? `${drafted.subject}\n\n${drafted.body}` : drafted.body,
      citations: drafted.citations,
    });

    revalidatePath(`/${locale}${HERE}`);
    redirect({ href: `${HERE}?proposed=1`, locale });
  } catch (error) {
    if (error instanceof CannotDraft) {
      redirect({ href: `${HERE}?error=${error.reason}`, locale });
      return;
    }
    if (error instanceof ProposalRefused) {
      redirect({ href: `${HERE}?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }
}

export async function decideAction(locale: string, form: FormData) {
  const session = await requireSession(locale);

  try {
    const result = await decideProposal({
      proposalId: String(form.get("id") ?? ""),
      approve: String(form.get("decision") ?? "") === "approve",
      note: String(form.get("note") ?? ""),
      role: session.role,
      actorId: session.userId,
    });

    revalidatePath(`/${locale}${HERE}`);
    redirect({
      href: result.appliedEntityId
        ? `${HERE}?decided=1&created=${result.appliedEntity}`
        : `${HERE}?decided=1`,
      locale,
    });
  } catch (error) {
    if (error instanceof ApplyRefused) {
      redirect({ href: `${HERE}?error=${error.reason}`, locale });
      return;
    }
    throw error;
  }
}
