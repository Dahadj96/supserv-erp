# Screen 57 has no composer, and two states instead of four

**Decided** 27 August 2026, building Conversations.

## What the frame draws

A reply box at the bottom of every thread: **Template · Attach · Français — this
client · Remind me in 2 days**, and a **Send** button beside a **Draft only**
toggle. Four thread states across the list — *Needs your reply*, *Waiting on
them*, *Answered*, *Closed*. A **New message** button in the header.

## What is true

The ERP holds **`Mail.Read`**, scoped in Exchange to one mailbox. It cannot
send. That is not an unfinished feature — it is the fence built the same day,
deliberately, and `docs/MAILBOX-ACCESS.md` explains at length why sending is a
separate grant that has to be argued for separately rather than picked up on the
way past.

Three of the four states depend on sending. *Waiting on them* and *Answered*
both mean "we replied". *Needs your reply* is the only inbound-only state, and
*Closed* can be read from what the ERP already knows — every message in the
thread became a record or was dismissed.

## The decision

**No composer.** In its place, a plain sentence saying replies are sent from
Outlook, and a link that opens the last message there.

A reply box that opened Outlook when you pressed Send would be worse than
nothing: it would look like the ERP sent the mail, and six weeks later somebody
would swear they had replied because they remembered typing into this screen.

**Two states, not four.** `needsReply` and `closed`. This follows a rule the
inbox already set for itself — screen 02 refuses to draw an "Admin" chip whose
count can only ever be zero, because a chip that always reads zero teaches
people to stop reading the chips. A thread marked *Waiting on them* when nobody
has replied is the same failure with worse consequences, on a screen whose whole
purpose is to stop things going quiet.

**No New message button**, for the same reason as the composer.

## What the screen does instead, and why it still earns its place

It answers "what has this client actually said to us?" — which today means
opening Outlook and searching, then finding that three people at URBACON wrote
about the same enquiry from three addresses.

Threads are grouped by **counterparty and subject**, not by Graph's
`conversationId`. That is deliberate: purchasing departments reply by forwarding
from a colleague, which starts a new conversationId with the same subject and
would put one negotiation in four rows. Subject survives that. The cost is that
two unrelated enquiries both called "Demande de prix" from the same client will
merge — the less harmful error, because a thread with one extra message can be
read, and a conversation split four ways cannot.

Nothing is stored. A thread is a way of looking at `intake_message`, exactly as
the deal timeline is a way of looking at six other tables.

## What changes this

Either of:

- **`Mail.Send`, scoped the same way** — argued for on its own terms, with its
  own line in `docs/MAILBOX-ACCESS.md` and its own test that the app cannot send
  as anybody but the shared mailbox.
- **Capturing Sent Items** — which would give *Answered* and *Waiting on them*
  honestly, without the ERP sending anything at all. Cheaper, and probably
  first. Note the sync deliberately reads the Inbox folder only today, so this
  is a decision to reverse in one specific place, not an accident to fix.
