# A screen the design never drew: one message, readable

**Raised and decided** 27 August 2026, an hour after the first real mail synced.

## What the frames assume

Screen 02 is triage from the row: sender, subject, type, deadline, and a button
that turns the thing into a record. There is no frame for opening a message.
`docs/SCREENS.md` lists 02 Inbox, 38 Channels, 39 Dossier intake, 40 Extraction
review, 41 Scan station — a message view is in none of them.

That is a coherent design, and it survives a demo mailbox: if the router is
right, nobody needs to read anything.

## What the first real sync did to that assumption

39 messages. **31 of them classified `needsReview`** — the bucket whose entire
meaning is *a person has to look at this*. There was nowhere to look.

The remaining eight were mostly right, which is the point: the router is good at
the shapes it knows and silent about everything else, and everything else is the
majority of a real mailbox. `contact@` is the company's oldest address. It
receives enquiries, CVs, invoices, cold sales approaches and spam, and no rule
set separates those on the strength of a subject line.

So the screen exists. `/inbox/[id]`.

## What it shows, and one thing it refuses to

Sender, subject, when it arrived, the body, the attachments, what the router
thought and how sure it was, the deadline it read and whether anybody has
confirmed it. Reclassify and dismiss from the same page. Newer/older buttons,
because triage is a run of thirty-one, not a visit.

**The body is rendered as text, never as HTML.** Not sanitised HTML — text.
`src/domain/intake/body.ts` carries the reasoning: the markup in that column was
written by whoever sent the email, half the mailbox is unsolicited, and
`dangerouslySetInnerHTML` would hand a stranger a script tag inside the Gérant's
session. Sanitising is the usual answer and it is a permanent commitment to
being right about every attribute and URL scheme forever. Text cannot execute.

The cost is real: an HTML newsletter loses its layout. The original is in
Outlook with its formatting intact and every message links straight to it.

## What it does not do yet

- **Attachments are named, not readable.** The rows exist — filename, size, what
  the file looks like — but `storage_path` is null because the bytes were never
  fetched. That waits on real file storage, screens 60 and 66. The screen says
  "in Outlook only" rather than offering a link that 404s.
- **The commit buttons are still greyed** for enquiry, tender, supplier quote
  and payment. `COMMIT_PHASE` gates them on phases 4 and 5, both of which have
  since closed — the table was written in phase 2 and never revisited. Un-gating
  is the next piece of work and it is a real one: creating a deal from a message
  means deciding what to do about the client, the lines and the deadline.
