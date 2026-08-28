/**
 * Screen 57 — "everything said to a client or a supplier, in one place".
 *
 * There is no conversation table and there will not be one. A thread is a way
 * of LOOKING at messages that already exist, exactly as the deal timeline is a
 * way of looking at six other tables. Storing threads would mean a second
 * opinion about which messages belong together, and the day it disagrees with
 * the messages, nobody can tell which is right.
 *
 * What the frame shows and this cannot yet do is in
 * docs/DECISIONS/2026-08-27-conversations-are-read-only.md: the ERP holds
 * `Mail.Read`, scoped to one mailbox, and read means read.
 */

/**
 * The reply prefixes that turn one conversation into six rows.
 *
 * Every mail client writes its own, in the language of its interface, and a
 * French thread routinely carries all of `Re:`, `RE:`, `TR:` and `Fwd:` by the
 * time it has been round a purchasing department twice. `Rép.:` is Outlook in
 * French; `AW:`/`WG:` arrive from German suppliers, of which there are several.
 */
const REPLY_PREFIX =
  /^\s*(?:(?:re|ré|rép|rep|aw|antw|sv|vs|tr|fw|fwd|wg|doorst|enc|rv)\s*(?:\[\d+\])?\s*:\s*)+/i;

/**
 * What two messages have to share to be the same conversation.
 *
 * Subject only, deliberately — not the Graph conversationId, which is the
 * obvious answer and the wrong one here. A client who replies by writing a NEW
 * email with the same subject (which purchasing departments do constantly,
 * because they forward from a colleague rather than reply) gets a different
 * conversationId and would sit in its own thread. Subject survives that.
 *
 * The cost is real and worth naming: two unrelated enquiries both called
 * "Demande de prix" from the same client will merge. That is the less harmful
 * error — a thread with one extra message in it can be read and understood; a
 * conversation split across four rows cannot be read at all.
 */
export function normaliseSubject(subject: string | null): string {
  if (!subject) return "";
  let text = subject;
  // Repeatedly, because `Re: TR: Re: ...` is one match per pass at best.
  for (let i = 0; i < 8; i += 1) {
    const stripped = text.replace(REPLY_PREFIX, "");
    if (stripped === text) break;
    text = stripped;
  }
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

/**
 * The other half of a thread's identity: who it is with.
 *
 * A matched party when there is one, so that three people at URBACON writing
 * about the same enquiry are one conversation with URBACON rather than three.
 * That is the whole point of the screen — "everything said to a client", not
 * "everything said by one person at a client".
 *
 * Falling back to the address, lower-cased, when nobody has been matched. Not
 * the display name: senders change how they spell their own name, and
 * "A. Himer" and "Ahmed HIMER" are the same purchasing manager.
 */
export function counterpartyKey(partyId: string | null, fromAddress: string | null): string {
  if (partyId) return `party:${partyId}`;
  return `address:${(fromAddress ?? "").trim().toLocaleLowerCase()}`;
}

export function threadKey(
  partyId: string | null,
  fromAddress: string | null,
  subject: string | null,
): string {
  return `${counterpartyKey(partyId, fromAddress)}|${normaliseSubject(subject)}`;
}

/**
 * Which of screen 57's states a thread is in.
 *
 * The frame draws four: Needs your reply, Waiting on them, Answered, Closed.
 * Only two of them can be true today, and pretending otherwise would be the
 * same mistake as a chip that can only ever read zero.
 *
 * `Waiting on them` and `Answered` both mean "we replied" — and the ERP has
 * never sent anything. It reads one mailbox with `Mail.Read`. Until it can
 * send, or until sent mail is captured, every thread here is inbound-only, and
 * saying "waiting on them" about a message nobody has answered would be a
 * comfortable lie on a screen whose whole job is to stop things going quiet.
 */
export type ThreadState = "needsReply" | "closed";

export type ThreadMessage = {
  /** committed | dismissed | anything else */
  status: string;
  committedAt: Date | null;
};

export function stateOf(messages: readonly ThreadMessage[]): ThreadState {
  if (messages.length === 0) return "closed";
  // Dealt with = it became a record, or somebody said it needed nothing. Both
  // are decisions; neither is a delete (screen 83).
  const outstanding = messages.some(
    (message) => message.committedAt === null && message.status !== "dismissed",
  );
  return outstanding ? "needsReply" : "closed";
}

/**
 * The subject a thread is TITLED with, as opposed to the one it is keyed by.
 *
 * Keying lower-cases and strips, which is right for matching and wrong for
 * reading. The title is the earliest message's subject with its reply prefixes
 * removed — the earliest, because that is the one somebody chose deliberately,
 * before it accumulated `TR:` on its way round the building.
 */
export function titleOf(subjects: readonly (string | null)[]): string {
  for (const subject of subjects) {
    if (!subject) continue;
    let text = subject;
    for (let i = 0; i < 8; i += 1) {
      const stripped = text.replace(REPLY_PREFIX, "");
      if (stripped === text) break;
      text = stripped;
    }
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed) return trimmed;
  }
  return "";
}
